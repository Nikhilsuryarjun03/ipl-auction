const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { RULES, TEAMS, PLAYERS } = require('./data');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

// ---------- helpers ----------
const fmt = l => (l >= 100 ? `₹${+(l / 100).toFixed(2)} cr` : `₹${l} L`);
const increment = l => (l < 100 ? 5 : l < 200 ? 10 : l < 500 ? 20 : 25);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (s, n = 20) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

function newCode() {
  let c;
  do { c = crypto.randomBytes(3).toString('hex').slice(0, 5).toUpperCase(); } while (rooms.has(c));
  return c;
}

function createRoom() {
  const room = {
    code: newCode(), hostId: null, phase: 'lobby', // lobby | auction | finished
    members: new Map(), purse: {}, squads: {}, xi: {}, bidSeconds: RULES.bidSeconds,
    queue: [], unsold: [], unsoldRound: false,
    lot: null, bid: null, leader: null, timeLeft: 0, status: 'idle', // live | closed
    result: null, paused: false, log: [], interval: null, nextTimer: null, cleanupTimer: null
  };
  TEAMS.forEach(t => { room.purse[t.id] = RULES.purse; room.squads[t.id] = []; room.xi[t.id] = { xi: [], impact: null }; });
  rooms.set(room.code, room);
  return room;
}

function addLog(room, text, kind = 'info') {
  room.log.push({ text, kind, t: Date.now() });
  if (room.log.length > 60) room.log.shift();
}

function publicState(room) {
  const owners = {};
  room.members.forEach(m => { if (m.teamId) owners[m.teamId] = m.name; });
  return {
    code: room.code, hostId: room.hostId, phase: room.phase, rules: { ...RULES, bidSeconds: room.bidSeconds },
    members: [...room.members.values()].map(({ id, name, teamId, online }) => ({ id, name, teamId, online })),
    teams: TEAMS.map(t => ({ ...t, owner: owners[t.id] || null, purse: room.purse[t.id], squad: room.squads[t.id], xi: room.xi[t.id] })),
    lot: room.lot, bid: room.bid, leader: room.leader, timeLeft: room.timeLeft,
    status: room.status, result: room.result, paused: room.paused,
    nextBid: room.lot ? (room.bid == null ? room.lot.base : room.bid + increment(room.bid)) : null,
    remaining: room.queue.length, unsoldCount: room.unsold.length, unsoldRound: room.unsoldRound,
    log: room.log.slice(-25)
  };
}

const broadcast = room => io.to(room.code).emit('state', publicState(room));

// ---------- auction flow ----------
function buildQueue() {
  // marquee (highest base) first, shuffled within each price band
  const bands = {};
  PLAYERS.forEach(p => (bands[p.base] ||= []).push({ ...p }));
  return Object.keys(bands).map(Number).sort((a, b) => b - a).flatMap(b => shuffle(bands[b]));
}

function startAuction(room) {
  room.phase = 'auction';
  room.queue = buildQueue();
  addLog(room, `Auction started with ${room.queue.length} players.`);
  room.interval = setInterval(() => tick(room), 1000);
  nextLot(room);
}

function nextLot(room) {
  clearTimeout(room.nextTimer);
  if (!room.queue.length && room.unsold.length && !room.unsoldRound) {
    room.unsoldRound = true;
    room.queue = room.unsold.splice(0);
    addLog(room, `Unsold players are back for a second round.`);
  }
  if (!room.queue.length) return finish(room);
  room.lot = room.queue.shift();
  room.bid = null; room.leader = null; room.result = null;
  room.timeLeft = room.bidSeconds; room.status = 'live';
  broadcast(room);
}

function tick(room) {
  if (room.phase !== 'auction' || room.status !== 'live' || room.paused) return;
  room.timeLeft -= 1;
  if (room.timeLeft <= 0) closeLot(room);
  else broadcast(room);
}

function closeLot(room) {
  const p = room.lot;
  if (room.leader) {
    room.squads[room.leader].push({ ...p, price: room.bid });
    room.purse[room.leader] -= room.bid;
    room.result = { sold: true, teamId: room.leader, price: room.bid };
    addLog(room, `${p.name} sold to ${TEAMS.find(t => t.id === room.leader).name} for ${fmt(room.bid)}.`, 'sold');
  } else {
    if (!room.unsoldRound) room.unsold.push(p);
    room.result = { sold: false };
    addLog(room, `${p.name} went unsold.`, 'unsold');
  }
  room.status = 'closed'; room.timeLeft = 0;
  broadcast(room);
  room.nextTimer = setTimeout(() => nextLot(room), RULES.breakSeconds * 1000);
}

function finish(room) {
  clearInterval(room.interval);
  room.phase = 'finished'; room.lot = null; room.status = 'idle';
  addLog(room, 'Auction finished.');
  broadcast(room);
}

// Returns an error message, or null if the Playing XI is allowed.
function checkXI(squad, xi, impact) {
  const byId = new Map(squad.map(p => [p.id, p]));
  if (xi.length > RULES.xiSize) return `Pick at most ${RULES.xiSize} players.`;
  if (xi.some(id => !byId.has(id))) return 'You can only pick players from your squad.';
  if (impact != null && !byId.has(impact)) return 'The Impact Player must be in your squad.';
  if (impact != null && xi.includes(impact)) return 'The Impact Player can’t also be in the XI.';
  const overseas = [...xi, impact].filter(id => byId.get(id)?.overseas).length;
  if (overseas > RULES.xiMaxOverseas) return `Only ${RULES.xiMaxOverseas} overseas players allowed, counting the Impact Player.`;
  return null;
}

function canBid(room, teamId) {
  if (room.phase !== 'auction' || room.status !== 'live' || room.paused) return 'Bidding is closed right now.';
  if (!teamId) return 'Pick a team to bid.';
  if (room.leader === teamId) return 'You already hold the top bid.';
  const amount = room.bid == null ? room.lot.base : room.bid + increment(room.bid);
  const squad = room.squads[teamId];
  if (room.purse[teamId] < amount) return 'Not enough left in your purse.';
  if (squad.length >= RULES.maxSquad) return 'Your squad is full.';
  if (room.lot.overseas && squad.filter(p => p.overseas).length >= RULES.maxOverseas) return 'Overseas limit reached.';
  return null;
}

// ---------- sockets ----------
io.on('connection', socket => {
  const room = () => rooms.get(socket.data.code);
  const member = () => room()?.members.get(socket.data.memberId);
  const isHost = () => room() && room().hostId === socket.data.memberId;
  socket.emit('meta', { teams: TEAMS, rules: RULES });

  function enter(r, m, cb) {
    m.online = true; m.socketId = socket.id;
    socket.data.code = r.code; socket.data.memberId = m.id;
    socket.join(r.code);
    clearTimeout(r.cleanupTimer);
    cb?.({ ok: true, code: r.code, memberId: m.id });
    broadcast(r);
  }

  socket.on('create', ({ name } = {}, cb) => {
    name = clean(name); if (!name) return cb?.({ ok: false, error: 'Enter your name.' });
    const r = createRoom();
    const m = { id: crypto.randomUUID(), name, teamId: null };
    r.members.set(m.id, m); r.hostId = m.id;
    enter(r, m, cb);
  });

  socket.on('join', ({ code, name } = {}, cb) => {
    name = clean(name); const r = rooms.get(clean(code, 8).toUpperCase());
    if (!name) return cb?.({ ok: false, error: 'Enter your name.' });
    if (!r) return cb?.({ ok: false, error: 'No room with that code. Check it and try again.' });
    if (r.members.size >= RULES.maxMembers) return cb?.({ ok: false, error: `This room is full (max ${RULES.maxMembers} players).` });
    const m = { id: crypto.randomUUID(), name, teamId: null };
    r.members.set(m.id, m);
    addLog(r, `${name} joined.`);
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
      m.teamId = null; return broadcast(r);
    }
    if (!TEAMS.some(t => t.id === teamId)) return;
    if ([...r.members.values()].some(x => x.teamId === teamId && x.id !== m.id)) return socket.emit('toast', 'That team is taken.');
    if (r.phase !== 'lobby' && m.teamId) return socket.emit('toast', 'Teams are locked once the auction starts.');
    m.teamId = teamId;
    if (r.phase === 'auction') addLog(r, `${m.name} joined the auction as ${TEAMS.find(t => t.id === teamId).name}.`);
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
    r.bid = r.bid == null ? r.lot.base : r.bid + increment(r.bid);
    r.leader = m.teamId; r.timeLeft = r.bidSeconds;
    broadcast(r);
  });

  socket.on('setXI', ({ xi, impact } = {}, cb) => {
    const r = room(), m = member();
    if (!r || !m?.teamId || r.phase === 'lobby') return cb?.({ ok: false, error: 'You need a team to pick a Playing XI.' });
    xi = Array.isArray(xi) ? [...new Set(xi.map(Number))] : [];
    impact = impact == null ? null : Number(impact);
    const err = checkXI(r.squads[m.teamId], xi, impact);
    if (err) return cb?.({ ok: false, error: err });
    r.xi[m.teamId] = { xi, impact };
    addLog(r, `${TEAMS.find(t => t.id === m.teamId).name} announced their Playing XI.`);
    broadcast(r);
    cb?.({ ok: true });
  });

  socket.on('setTimer', ({ seconds } = {}) => {
    const r = room(); if (!r || !isHost() || r.phase === 'finished') return;
    const s = Number(seconds);
    if (!RULES.timerOptions.includes(s) || s === r.bidSeconds) return;
    r.bidSeconds = s;
    if (r.status === 'live' && r.timeLeft > s) r.timeLeft = s;
    addLog(r, `Bid timer set to ${s} seconds.`);
    broadcast(r);
  });

  socket.on('pause', () => { const r = room(); if (r && isHost() && r.phase === 'auction') { r.paused = !r.paused; addLog(r, r.paused ? 'Auction paused.' : 'Auction resumed.'); broadcast(r); } });
  socket.on('skip',  () => { const r = room(); if (r && isHost() && r.status === 'live') closeLot(r); });
  socket.on('end',   () => { const r = room(); if (r && isHost() && r.phase === 'auction') { clearTimeout(r.nextTimer); finish(r); } });

  socket.on('leave', () => {
    const r = room(), m = member(); if (!r || !m) return;
    socket.leave(r.code);
    if (r.phase === 'lobby') { r.members.delete(m.id); addLog(r, `${m.name} left.`); } else m.online = false;
    if (r.hostId === m.id) { const next = [...r.members.values()].find(x => x.online); if (next) r.hostId = next.id; }
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
