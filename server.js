const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { RULES, PLAYERS, MODES, SPORTS } = require('./data');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { perMessageDeflate: { threshold: 2048 } }); // the player catalogue is large; compress it
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

// ---------- helpers ----------
// Money: lakhs for cricket (100 = ₹1 cr), €M for football.
const fmtINR = l => (l >= 100 ? `₹${+(l / 100).toFixed(2)} cr` : l ? `₹${l} L` : '₹0');
const fmtEUR = m => `€${m}M`;
const money = room => (room.sport === 'football' ? fmtEUR : fmtINR);
const increment = (l, sport) => sport === 'football'
  ? (l < 20 ? 1 : l < 50 ? 2 : l < 100 ? 5 : 10)
  : (l < 100 ? 5 : l < 200 ? 10 : l < 500 ? 20 : 25);
const nextBid = room => (room.bid == null ? room.lot.base : room.bid + increment(room.bid, room.sport));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (s, n = 20) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const teamsOf = room => SPORTS[room.sport].teams;
const teamName = (room, id) => teamsOf(room).find(t => t.id === id).name;

// Sent once per connection: everything the client needs that never changes during a room.
const META = {
  rules: RULES, players: PLAYERS,
  sports: Object.fromEntries(Object.entries(SPORTS).map(([k, s]) => [k, { name: s.name, tag: s.tag, teams: s.teams, defaultMode: s.defaultMode }])),
  modes: Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, { name: m.name, desc: m.desc, purse: m.purse, maxSquad: m.maxSquad, maxOverseas: m.maxOverseas, size: m.size, retentions: !!m.retentions, sport: m.sport, rtm: m.rtm != null }]))
};

function newCode() {
  let c;
  do { c = crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase(); } while (rooms.has(c));
  return c;
}

function rulesFor(room) {
  const m = MODES[room.mode];
  return { ...RULES, mode: room.mode, purse: m.purse, maxSquad: m.maxSquad, maxOverseas: m.maxOverseas, bidSeconds: room.bidSeconds, rtmCards: room.rtmCards };
}

function createRoom(sport) {
  const room = {
    code: newCode(), hostId: null, phase: 'lobby', // lobby | auction | finished
    sport, mode: SPORTS[sport].defaultMode, bidSeconds: RULES.bidSeconds,
    members: new Map(), purse: {}, startPurse: {}, squads: {}, xi: {},
    queue: [], unsold: [], unsoldFinal: [], unsoldRound: false, soldLog: [],
    rtmCards: 0, rtmLeft: {}, rtm: null, // Right to Match: cards per team, cards left, decision in progress
    lot: null, bid: null, leader: null, timeLeft: 0, status: 'idle', // live | rtm | closed
    result: null, paused: false, log: [], interval: null, nextTimer: null, cleanupTimer: null
  };
  resetTeams(room);
  rooms.set(room.code, room);
  return room;
}

// Fresh purses and squads for the room's mode. In the mock auction teams start with their real retentions.
function resetTeams(room) {
  const mode = MODES[room.mode];
  room.purse = {}; room.startPurse = {}; room.squads = {}; room.xi = {}; room.rtmLeft = {};
  room.rtmCards = mode.rtm || 0;
  teamsOf(room).forEach(t => {
    const kept = mode.retentions?.[t.id];
    room.purse[t.id] = room.startPurse[t.id] = kept ? kept.purse : mode.purse;
    room.squads[t.id] = kept ? kept.players.map(p => ({ ...p })) : [];
    room.xi[t.id] = { xi: [], impact: null };
    room.rtmLeft[t.id] = room.rtmCards;
  });
}

// kind: info | join | team | bid | sold | unsold | rtm | chat | host
function addLog(room, text, kind = 'info', extra = {}) {
  room.log.push({ text, kind, t: Date.now(), ...extra });
  if (room.log.length > 300) room.log.shift();
}

// The remaining queue grouped into its sets, in auction order.
function upcomingSets(room) {
  const sets = [];
  room.queue.forEach(p => {
    const last = sets[sets.length - 1];
    if (last && last.name === p.set) last.ids.push(p.id);
    else sets.push({ name: p.set, ids: [p.id] });
  });
  return sets;
}

function publicState(room) {
  const owners = {};
  room.members.forEach(m => { if (m.teamId) owners[m.teamId] = m.name; });
  return {
    code: room.code, hostId: room.hostId, phase: room.phase, sport: room.sport, mode: room.mode, rules: rulesFor(room),
    members: [...room.members.values()].map(({ id, name, teamId, online }) => ({ id, name, teamId, online })),
    teams: teamsOf(room).map(t => ({ ...t, owner: owners[t.id] || null, purse: room.purse[t.id], startPurse: room.startPurse[t.id], squad: room.squads[t.id], xi: room.xi[t.id], rtmLeft: room.rtmLeft[t.id] })),
    lot: room.lot, bid: room.bid, leader: room.leader, timeLeft: room.timeLeft,
    status: room.status, result: room.result, paused: room.paused, rtm: room.rtm,
    nextBid: room.lot ? nextBid(room) : null,
    remaining: room.queue.length, unsoldRound: room.unsoldRound,
    upcoming: upcomingSets(room),
    sold: room.soldLog,
    unsold: [...room.unsold.map(p => p.id), ...room.unsoldFinal],
    log: room.log.slice(-150)
  };
}

const broadcast = room => io.to(room.code).emit('state', publicState(room));

// ---------- auction flow ----------
// Sets come from the player lists and run in list order; the order inside each set is random.
function buildQueue(pool) {
  const sets = new Map();
  pool.forEach(p => { if (!sets.has(p.set)) sets.set(p.set, []); sets.get(p.set).push({ ...p }); });
  return [...sets.values()].flatMap(shuffle);
}

function startAuction(room) {
  room.phase = 'auction';
  room.queue = buildQueue(MODES[room.mode].pool());
  addLog(room, `${MODES[room.mode].name} started with ${room.queue.length} players.`, 'host');
  room.interval = setInterval(() => tick(room), 1000);
  nextLot(room);
}

function nextLot(room) {
  clearTimeout(room.nextTimer);
  if (!room.queue.length && room.unsold.length && !room.unsoldRound) {
    room.unsoldRound = true;
    room.queue = room.unsold.splice(0).map(p => ({ ...p, set: 'Unsold round' }));
    addLog(room, 'Unsold players are back for a second round.', 'host');
  }
  if (!room.queue.length) return finish(room);
  room.lot = room.queue.shift();
  room.bid = null; room.leader = null; room.result = null;
  room.timeLeft = room.bidSeconds; room.status = 'live';
  broadcast(room);
}

// The clock only sends the seconds left; everything else goes out with full state updates.
function tick(room) {
  if (room.phase !== 'auction' || room.paused || (room.status !== 'live' && room.status !== 'rtm')) return;
  room.timeLeft -= 1;
  if (room.timeLeft > 0) return io.to(room.code).emit('tick', room.timeLeft);
  if (room.status === 'live') closeLot(room);
  else rtmTimeout(room);
}

function closeLot(room) {
  const p = room.lot;
  if (room.leader) {
    const rtmTeam = rtmTeamFor(room);
    return rtmTeam ? startRtm(room, rtmTeam) : sell(room, room.leader, room.bid);
  }
  if (room.unsoldRound) room.unsoldFinal.push(p.id);
  else room.unsold.push(p);
  room.result = { sold: false };
  addLog(room, `${p.name} went unsold`, 'unsold');
  endLot(room);
}

function sell(room, teamId, price, viaRtm = false) {
  const p = room.lot;
  room.squads[teamId].push({ ...p, price, ...(viaRtm ? { rtm: true } : {}) });
  room.purse[teamId] -= price;
  room.soldLog.push({ id: p.id, teamId, price, ...(viaRtm ? { rtm: true } : {}) });
  room.result = { sold: true, teamId, price, rtm: viaRtm };
  room.bid = price; room.leader = teamId;
  addLog(room, `${p.name} sold to ${teamName(room, teamId)} for ${money(room)(price)}${viaRtm ? ' using RTM' : ''}`, 'sold', { teamId });
  endLot(room);
}

function endLot(room) {
  room.rtm = null; room.status = 'closed'; room.timeLeft = 0;
  broadcast(room);
  room.nextTimer = setTimeout(() => nextLot(room), RULES.breakSeconds * 1000);
}

// ---------- Right to Match ----------
// The player's previous team (from the latest season data) may match the winning bid if a person owns that
// team, it has RTM cards left and it could afford the player. The winner then gets one final raise, and the
// previous team can match that too. A card is only used when the previous team actually takes the player.
function cannotBuy(room, teamId, amount) {
  const rules = rulesFor(room), squad = room.squads[teamId];
  if (room.purse[teamId] < amount) return 'Not enough left in your purse.';
  if (squad.length >= rules.maxSquad) return 'Your squad is full.';
  if (rules.maxOverseas != null && room.lot.overseas && squad.filter(p => p.overseas).length >= rules.maxOverseas) return 'Overseas limit reached.';
  return null;
}
const ownerOf = (room, teamId) => [...room.members.values()].find(m => m.teamId === teamId);

function rtmTeamFor(room) {
  const prev = room.lot.prevTeam;
  if (!room.rtmCards || !prev || prev === room.leader || !room.rtmLeft[prev]) return null;
  if (!ownerOf(room, prev) || cannotBuy(room, prev, room.bid)) return null;
  return prev;
}

function startRtm(room, team) {
  room.rtm = { team, winner: room.leader, price: room.bid, step: 'offer' };
  room.status = 'rtm'; room.timeLeft = RULES.rtmSeconds;
  addLog(room, `${team} can use Right to Match on ${room.lot.name} (${room.leader} won at ${money(room)(room.bid)})`, 'rtm', { teamId: team });
  broadcast(room);
}

// Time ran out (or the host closed the lot): the previous team declines, or the winner doesn't raise.
function rtmTimeout(room) {
  const { step, team, winner, price } = room.rtm;
  if (step === 'raise') {
    addLog(room, `${winner} didn't raise in time`, 'rtm', { teamId: winner });
    return rtmTake(room);
  }
  addLog(room, `${team} didn't use RTM in time`, 'rtm', { teamId: team });
  sell(room, winner, price);
}

// The previous team takes the player at the current RTM price, using a card.
function rtmTake(room) {
  const { team, price } = room.rtm;
  room.rtmLeft[team] -= 1;
  sell(room, team, price, true);
}

// Returns an error message, or null when the action went through.
function rtmAction(room, member, action, amount) {
  const r = room.rtm, f = money(room);
  if (!r || room.status !== 'rtm') return 'There is no Right to Match decision right now.';
  if (room.paused) return 'The auction is paused.';
  const mine = member.teamId;
  if (r.step === 'offer' || r.step === 'match') {
    if (mine !== r.team) return `Waiting for ${r.team} to decide.`;
    if (action === 'decline') {
      addLog(room, `${r.team} declined RTM`, 'rtm', { teamId: r.team });
      sell(room, r.winner, r.price);
      return null;
    }
    if (r.step === 'match' && action === 'match') {
      addLog(room, `${r.team} matched ${f(r.price)}`, 'rtm', { teamId: r.team });
      rtmTake(room);
      return null;
    }
    if (r.step === 'offer' && action === 'use') {
      r.step = 'raise'; room.timeLeft = RULES.rtmSeconds;
      addLog(room, `${r.team} used RTM. ${r.winner} gets one final raise.`, 'rtm', { teamId: r.team });
      broadcast(room);
      return null;
    }
    return 'That option is not available now.';
  }
  // step 'raise': the winning bidder raises once, or lets the previous team have the player.
  if (mine !== r.winner) return `Waiting for ${r.winner} to decide.`;
  if (action === 'noraise') {
    addLog(room, `${r.winner} won't raise, so ${r.team} gets ${room.lot.name}`, 'rtm', { teamId: r.winner });
    rtmTake(room);
    return null;
  }
  if (action !== 'raise') return 'That option is not available now.';
  amount = Number(amount);
  if (!Number.isFinite(amount) || amount <= r.price || amount % SPORTS[room.sport].purseStep) return `Raise above ${f(r.price)}.`;
  const blocked = cannotBuy(room, r.winner, amount);
  if (blocked) return blocked;
  r.price = amount;
  addLog(room, `${r.winner} raised to ${f(amount)} for ${room.lot.name}`, 'rtm', { teamId: r.winner });
  if (cannotBuy(room, r.team, amount)) {
    addLog(room, `${r.team} can't afford to match`, 'rtm', { teamId: r.team });
    sell(room, r.winner, amount);
    return null;
  }
  r.step = 'match'; room.timeLeft = RULES.rtmSeconds;
  broadcast(room);
  return null;
}

// ---------- players leaving mid-auction ----------
// Everything the team bought goes back into the auction (retained players stay) and the money is refunded.
function releaseTeam(room, teamId, who) {
  const bought = room.squads[teamId].filter(p => !p.retained);
  if (bought.length) {
    room.squads[teamId] = room.squads[teamId].filter(p => p.retained);
    room.purse[teamId] += bought.reduce((sum, p) => sum + p.price, 0);
    const ids = new Set(bought.map(p => p.id));
    room.soldLog = room.soldLog.filter(s => !ids.has(s.id));
    room.queue.push(...bought.map(({ price, rtm, ...p }) => ({ ...p, set: 'Returned players' })));
    addLog(room, `${who} left, so ${bought.length} player${bought.length === 1 ? '' : 's'} from ${teamName(room, teamId)} ${bought.length === 1 ? 'is' : 'are'} back in the auction`, 'host');
  }
  room.xi[teamId] = { xi: [], impact: null };
  room.rtmLeft[teamId] = room.rtmCards;
  if (room.status === 'live' && room.leader === teamId) {
    room.bid = null; room.leader = null; room.timeLeft = room.bidSeconds;
    addLog(room, `Bidding on ${room.lot.name} restarts because ${teamId} left`, 'host');
  } else if (room.status === 'rtm' && room.rtm.team === teamId) {
    addLog(room, `${teamId} left, so RTM is off`, 'rtm');
    sell(room, room.rtm.winner, room.rtm.price);
  } else if (room.status === 'rtm' && room.rtm.winner === teamId) {
    room.rtm = null; room.status = 'live'; room.bid = null; room.leader = null; room.timeLeft = room.bidSeconds;
    addLog(room, `Bidding on ${room.lot.name} restarts because ${teamId} left`, 'host');
  }
}

function finish(room) {
  clearInterval(room.interval);
  if (room.lot && room.status === 'live') room.unsoldFinal.push(room.lot.id);
  room.unsoldFinal.push(...room.queue.map(p => p.id), ...room.unsold.map(p => p.id));
  room.queue = []; room.unsold = [];
  room.phase = 'finished'; room.lot = null; room.status = 'idle';
  addLog(room, 'Auction finished.', 'host');
  broadcast(room);
}

// Returns an error message, or null if the Playing XI is allowed.
function checkXI(squad, xi, impact, maxOverseas) {
  const byId = new Map(squad.map(p => [p.id, p]));
  if (xi.length > RULES.xiSize) return `Pick at most ${RULES.xiSize} players.`;
  if (xi.some(id => !byId.has(id))) return 'You can only pick players from your squad.';
  if (impact != null && !byId.has(impact)) return 'The Impact Player must be in your squad.';
  if (impact != null && xi.includes(impact)) return 'The Impact Player can’t also be in the XI.';
  const overseas = [...xi, impact].filter(id => byId.get(id)?.overseas).length;
  if (maxOverseas != null && overseas > maxOverseas) return `Only ${maxOverseas} overseas players allowed, counting the Impact Player.`;
  return null;
}

function canBid(room, teamId) {
  if (room.phase !== 'auction' || room.status !== 'live' || room.paused) return 'Bidding is closed right now.';
  if (!teamId) return 'Pick a team to bid.';
  if (room.leader === teamId) return 'You already hold the top bid.';
  return cannotBuy(room, teamId, nextBid(room));
}

// ---------- sockets ----------
io.on('connection', socket => {
  const room = () => rooms.get(socket.data.code);
  const member = () => room()?.members.get(socket.data.memberId);
  const isHost = () => room() && room().hostId === socket.data.memberId;
  socket.emit('meta', META);

  function enter(r, m, cb) {
    m.online = true; m.socketId = socket.id;
    socket.data.code = r.code; socket.data.memberId = m.id;
    socket.join(r.code);
    clearTimeout(r.cleanupTimer);
    cb?.({ ok: true, code: r.code, memberId: m.id });
    broadcast(r);
  }

  socket.on('create', ({ name, sport } = {}, cb) => {
    name = clean(name); if (!name) return cb?.({ ok: false, error: 'Enter your name.' });
    const r = createRoom(SPORTS[sport] ? sport : 'cricket');
    const m = { id: crypto.randomUUID(), name, teamId: null };
    r.members.set(m.id, m); r.hostId = m.id;
    addLog(r, `${name} created the room`, 'join', { name });
    enter(r, m, cb);
  });

  socket.on('join', ({ code, name } = {}, cb) => {
    name = clean(name); const r = rooms.get(clean(code, 8).toUpperCase());
    if (!name) return cb?.({ ok: false, error: 'Enter your name.' });
    if (!r) return cb?.({ ok: false, error: 'No room with that code. Check it and try again.' });
    if (r.members.size >= RULES.maxMembers) return cb?.({ ok: false, error: `This room is full (max ${RULES.maxMembers} players).` });
    const m = { id: crypto.randomUUID(), name, teamId: null };
    r.members.set(m.id, m);
    addLog(r, `${name} joined the room`, 'join', { name });
    enter(r, m, cb);
  });

  socket.on('rejoin', ({ code, memberId } = {}, cb) => {
    const r = rooms.get(code); const m = r?.members.get(memberId);
    if (!m) return cb?.({ ok: false });
    enter(r, m, cb);
  });

  socket.on('pickTeam', ({ teamId } = {}) => {
    const r = room(), m = member(); if (!r || !m) return;
    if (r.phase === 'finished') return;
    if (teamId === null) {
      if (r.phase !== 'lobby') return socket.emit('toast', 'Teams are locked once the auction starts.');
      if (m.teamId) addLog(r, `${m.name} released ${teamName(r, m.teamId)}`, 'team', { name: m.name });
      m.teamId = null; return broadcast(r);
    }
    if (!teamsOf(r).some(t => t.id === teamId)) return;
    if ([...r.members.values()].some(x => x.teamId === teamId && x.id !== m.id)) return socket.emit('toast', 'That team is taken.');
    if (r.phase !== 'lobby' && m.teamId) return socket.emit('toast', 'Teams are locked once the auction starts.');
    m.teamId = teamId;
    addLog(r, r.phase === 'auction' ? `${m.name} joined the auction as ${teamName(r, teamId)}` : `${m.name} picked ${teamName(r, teamId)}`, 'team', { name: m.name, teamId });
    broadcast(r);
  });

  socket.on('setMode', ({ mode } = {}) => {
    const r = room(); if (!r || !isHost() || r.phase !== 'lobby' || !MODES[mode] || MODES[mode].sport !== r.sport || mode === r.mode) return;
    r.mode = mode;
    resetTeams(r);
    addLog(r, `Auction mode set to ${MODES[mode].name}`, 'host');
    broadcast(r);
  });

  socket.on('start', () => {
    const r = room(); if (!r || !isHost() || r.phase !== 'lobby') return;
    if (![...r.members.values()].some(m => m.teamId)) return socket.emit('toast', 'At least one team needs an owner.');
    startAuction(r);
  });

  socket.on('bid', () => {
    const r = room(), m = member(); if (!r || !m) return;
    const err = canBid(r, m.teamId); if (err) return socket.emit('toast', err);
    r.bid = nextBid(r);
    r.leader = m.teamId; r.timeLeft = r.bidSeconds;
    addLog(r, `${m.teamId} bid ${money(r)(r.bid)} for ${r.lot.name}`, 'bid', { teamId: m.teamId, name: m.name });
    broadcast(r);
  });

  socket.on('rtm', ({ action, amount } = {}) => {
    const r = room(), m = member(); if (!r || !m) return;
    const err = rtmAction(r, m, action, amount);
    if (err) socket.emit('toast', err);
  });

  socket.on('setRtm', ({ cards } = {}) => {
    const r = room(); if (!r || !isHost() || r.phase !== 'lobby' || MODES[r.mode].rtm == null) return;
    const n = Number(cards);
    if (!RULES.rtmOptions.includes(n) || n === r.rtmCards) return;
    r.rtmCards = n;
    Object.keys(r.rtmLeft).forEach(id => (r.rtmLeft[id] = n));
    addLog(r, n ? `Right to Match: ${n} card${n === 1 ? '' : 's'} per team` : 'Right to Match turned off', 'host');
    broadcast(r);
  });

  socket.on('chat', ({ text } = {}) => {
    const r = room(), m = member(); if (!r || !m) return;
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return;
    const now = Date.now();
    if (now - (m.lastChat || 0) < 700) return socket.emit('toast', 'Slow down a little.');
    m.lastChat = now;
    addLog(r, text, 'chat', { name: m.name, teamId: m.teamId, memberId: m.id });
    broadcast(r);
  });

  socket.on('setXI', ({ xi, impact } = {}, cb) => {
    const r = room(), m = member();
    if (!r || !m?.teamId || r.phase === 'lobby') return cb?.({ ok: false, error: 'You need a team to pick a Playing XI.' });
    xi = Array.isArray(xi) ? [...new Set(xi.map(Number))] : [];
    impact = impact == null ? null : Number(impact);
    if (r.sport === 'football') impact = null; // football has no Impact Player or overseas limit
    const err = checkXI(r.squads[m.teamId], xi, impact, r.sport === 'football' ? null : RULES.xiMaxOverseas);
    if (err) return cb?.({ ok: false, error: err });
    r.xi[m.teamId] = { xi, impact };
    addLog(r, `${teamName(r, m.teamId)} announced their ${r.sport === 'football' ? 'Starting' : 'Playing'} XI`, 'team', { teamId: m.teamId });
    broadcast(r);
    cb?.({ ok: true });
  });

  socket.on('setTimer', ({ seconds } = {}) => {
    const r = room(); if (!r || !isHost() || r.phase === 'finished') return;
    const s = Number(seconds);
    if (!RULES.timerOptions.includes(s) || s === r.bidSeconds) return;
    r.bidSeconds = s;
    if (r.status === 'live' && r.timeLeft > s) r.timeLeft = s;
    addLog(r, `Bid timer set to ${s} seconds`, 'host');
    broadcast(r);
  });

  // Host edits purses: { purses: { CSK: 12000, ... } } in lakhs. Works in the lobby and mid-auction;
  // the starting purse moves by the same amount so "spent" stays correct.
  socket.on('setPurses', ({ purses } = {}, cb) => {
    const r = room(); if (!r || !isHost() || r.phase === 'finished') return cb?.({ ok: false, error: 'Only the host can edit purses.' });
    const changes = [];
    const step = SPORTS[r.sport].purseStep;
    for (const t of teamsOf(r)) {
      const v = Number(purses?.[t.id]);
      if (purses?.[t.id] == null || !Number.isFinite(v)) continue;
      const amount = Math.round(v / step) * step; // cricket bids move in ₹5 L steps
      if (amount < 0 || amount > 100000) return cb?.({ ok: false, error: 'That purse is out of range.' });
      if (amount === r.purse[t.id]) continue;
      r.startPurse[t.id] += amount - r.purse[t.id];
      r.purse[t.id] = amount;
      changes.push([t.id, amount]);
    }
    if (!changes.length) return cb?.({ ok: true });
    const same = changes.length === teamsOf(r).length && changes.every(([, a]) => a === changes[0][1]);
    const f = money(r);
    addLog(r, same ? `Host set every team's purse to ${f(changes[0][1])}` : `Host changed purses: ${changes.map(([id, a]) => `${id} ${f(a)}`).join(', ')}`, 'host');
    broadcast(r);
    cb?.({ ok: true });
  });

  socket.on('pause', () => {
    const r = room(); if (!r || !isHost() || r.phase !== 'auction') return;
    r.paused = !r.paused;
    addLog(r, r.paused ? 'Auction paused by the host' : 'Auction resumed', 'host');
    broadcast(r);
  });
  // "Close lot" ends bidding, or settles a Right to Match decision with its default.
  socket.on('skip', () => {
    const r = room(); if (!r || !isHost()) return;
    if (r.status === 'live') closeLot(r);
    else if (r.status === 'rtm') rtmTimeout(r);
  });
  socket.on('end', () => {
    const r = room(); if (!r || !isHost() || r.phase !== 'auction') return;
    if (r.status === 'rtm') sell(r, r.rtm.winner, r.rtm.price);
    clearTimeout(r.nextTimer); finish(r);
  });

  socket.on('leave', () => {
    const r = room(), m = member(); if (!r || !m) return;
    socket.leave(r.code);
    addLog(r, `${m.name} left the room`, 'join', { name: m.name });
    // Mid-auction, a leaving player's team is freed and its players go back into the auction.
    if (r.phase === 'auction' && m.teamId) releaseTeam(r, m.teamId, m.name);
    if (r.phase === 'finished') m.online = false; else r.members.delete(m.id);
    if (!r.members.size) { clearInterval(r.interval); clearTimeout(r.nextTimer); rooms.delete(r.code); socket.data = {}; return; }
    if (r.hostId === m.id) {
      const next = [...r.members.values()].find(x => x.online);
      if (next) { r.hostId = next.id; addLog(r, `${next.name} is now the host`, 'host'); }
    }
    socket.data = {}; broadcast(r);
  });

  socket.on('disconnect', () => {
    const r = room(), m = member(); if (!r || !m || m.socketId !== socket.id) return;
    m.online = false; broadcast(r);
    if (![...r.members.values()].some(x => x.online)) {
      r.cleanupTimer = setTimeout(() => { clearInterval(r.interval); clearTimeout(r.nextTimer); rooms.delete(r.code); }, 30 * 60 * 1000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Auction game running on http://localhost:${PORT}`));
