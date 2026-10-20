const app = document.getElementById('app');
const socket = io();
const KEY = 'auction-session';

let state = null;
let session = load();
let view = 'board';       // board | squads | xi | xi-edit
let lastKey = '';
let meta = null;          // { teams, rules } sent on connect, used before joining a room
let draft = null;         // Playing XI being edited: { xi: [ids in batting order], impact }
let lastSold = '';
let lastBid = null;

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save(s) { session = s; try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = l => (l >= 100 ? `₹${+(l / 100).toFixed(2)} cr` : `₹${l} L`);
const ROLE = { BAT: 'Batter', BOWL: 'Bowler', AR: 'All-rounder', WK: 'Wicket-keeper' };
const SET = { 200: 'Marquee set', 150: 'Capped · Set 2', 100: 'Capped · Set 3', 75: 'Capped · Set 4', 50: 'Capped · Set 5', 30: 'Uncapped set' };
const me = () => state?.members.find(m => m.id === session?.memberId);
const team = id => state?.teams.find(t => t.id === id);
const isHost = () => state && session && state.hostId === session.memberId;
const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// Dark or light text, whichever reads better on the team colour.
function ink(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#0B1230' : '#FFFFFF';
}
const teamVars = t => `--c:${t.color};--c2:${t.alt || t.color};--ink:${ink(t.color)}`;
const badge = (t, size = '') => `<span class="badge ${size}" style="${teamVars(t)}">${esc(t.id)}${t.logo
  ? `<img src="${esc(t.logo)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}</span>`;
// A logo that fails to load is removed, leaving the team code underneath.
document.addEventListener('error', e => { if (e.target.matches?.('.badge img')) e.target.remove(); }, true);

// ---------- player photos (Wikipedia, cached per browser) ----------
const IMG_KEY = 'player-img-v1';
const imgCache = (() => { try { return JSON.parse(localStorage.getItem(IMG_KEY)) || {}; } catch { return {}; } })();
const imgPending = {};
const imgQueue = [];
let imgActive = 0;

function lookupImg(name) {
  return new Promise(resolve => { imgQueue.push({ name, resolve }); pumpImgQueue(); });
}
function pumpImgQueue() {
  while (imgActive < 4 && imgQueue.length) {
    const { name, resolve } = imgQueue.shift();
    imgActive++;
    fetchWikiImg(name).then(resolve, () => resolve(null)).finally(() => { imgActive--; pumpImgQueue(); });
  }
}
async function fetchWikiImg(name) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search',
    gsrsearch: `${name} cricketer`, gsrlimit: '5', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '480'
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${q}`);
  if (!res.ok) throw new Error('lookup failed');
  const pages = Object.values((await res.json()).query?.pages || {}).sort((a, b) => a.index - b.index);
  const words = name.toLowerCase().split(/[\s.]+/).filter(w => w.length > 2);
  const hit = pages.find(p => p.thumbnail && words.every(w => p.title.toLowerCase().replace(/\./g, '').includes(w)));
  return hit ? hit.thumbnail.source : '';
}
function playerImg(name, own) {
  if (own) return Promise.resolve(own);
  if (name in imgCache) return Promise.resolve(imgCache[name]);
  return (imgPending[name] ||= lookupImg(name).then(url => {
    delete imgPending[name];
    if (url !== null) { // only cache real answers, not network failures
      imgCache[name] = url;
      try { localStorage.setItem(IMG_KEY, JSON.stringify(imgCache)); } catch {}
    }
    return url;
  }));
}
// Photos already known are drawn straight away so re-renders don't flicker; others load in hydrateImages().
function avatar(p, size = '') {
  const url = p.img || imgCache[p.name];
  const known = p.img || p.name in imgCache;
  return `<span class="avatar ${size} ${url ? 'has-img' : ''}" data-pimg="${esc(p.name)}" data-own="${esc(p.img || '')}" ${known ? 'data-done="1"' : ''}>
    <span>${esc(initials(p.name))}</span>${url ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : ''}</span>`;
}
document.addEventListener('error', e => {
  if (e.target.matches?.('.avatar img')) { e.target.parentElement.classList.remove('has-img'); e.target.remove(); }
}, true);

function hydrateImages() {
  document.querySelectorAll('[data-pimg]:not([data-done])').forEach(el => {
    el.dataset.done = '1';
    playerImg(el.dataset.pimg, el.dataset.own).then(url => {
      if (!url || !el.isConnected) return;
      const img = new Image();
      img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = url;
      img.onload = () => el.classList.add('has-img');
      img.onerror = () => img.remove();
      el.append(img);
    });
  });
}

// ---------- socket ----------
socket.on('connect', () => {
  if (session) socket.emit('rejoin', session, res => { if (!res?.ok) { save(null); state = null; render(true); } });
  else render(true);
});
socket.on('meta', m => {
  meta = m;
  // Fill in the home screen's team row without wiping anything typed into the forms.
  const row = document.querySelector('.hero-teams');
  if (row) row.innerHTML = m.teams.map(t => badge(t, 'lg')).join('');
});
socket.on('state', s => { state = s; celebrate(); render(); });
socket.on('toast', toast);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- render ----------
// Full re-render only when something other than the clock changes,
// so buttons are not replaced under the pointer every second.
function render(force) {
  if (!state) { lastKey = ''; return homeView(); }
  const { timeLeft, ...rest } = state;
  const key = JSON.stringify(rest) + view;
  if (!force && key === lastKey) return updateClock();
  lastKey = key;
  if (state.phase === 'lobby') lobbyView();
  else if (state.phase === 'auction') auctionView();
  else resultsView();
  hydrateImages();
}

function topBar() {
  const t = me()?.teamId && team(me().teamId);
  return `<header class="bar">
    <div class="brand"><span class="brand-mark" aria-hidden="true">🏏</span>Auction Night <em>IPL edition</em></div>
    <div class="actions">
      ${t ? `<span class="you">${badge(t, 'sm')} You’re ${esc(t.id)}</span>` : ''}
      <span class="room"><span class="muted small">Room</span><span class="roomcode">${esc(state.code)}</span></span>
      <button class="btn ghost sm" data-act="copy">Copy invite link</button>
      <button class="link" data-act="leave">Leave</button>
    </div>
  </header>`;
}

function homeView() {
  const preset = new URLSearchParams(location.search).get('room') || '';
  app.innerHTML = `<div class="wrap home">
    <div class="hero">
      <div class="eyebrow">T20 franchise auction · live with friends</div>
      <h1>Auction <span>Night</span></h1>
      <p class="lede">Ten franchises. ₹120 crore each. One gavel. Start a room, send the code to up to nine friends,
        claim your franchise and outbid everyone for the stars before the clock runs out.</p>
      <div class="hero-teams" aria-hidden="true">${(meta?.teams || []).map(t => badge(t, 'lg')).join('')}</div>
    </div>
    <div class="forms">
      <form class="panel glass" id="createForm">
        <h2>Host an auction</h2>
        <p class="small muted">You’ll get a room code to share.</p>
        <label for="cName">Your name</label>
        <input id="cName" maxlength="20" required autocomplete="nickname" />
        <button class="btn primary block" type="submit">Create room</button>
        <div class="error" id="cErr"></div>
      </form>
      <form class="panel glass" id="joinForm">
        <h2>Join a room</h2>
        <p class="small muted">Up to 10 players per room.</p>
        <label for="jName">Your name</label>
        <input id="jName" maxlength="20" required autocomplete="nickname" />
        <label for="jCode">Room code</label>
        <input id="jCode" class="code" maxlength="5" required value="${esc(preset)}" placeholder="ABCDE" />
        <button class="btn secondary block" type="submit">Join room</button>
        <div class="error" id="jErr"></div>
      </form>
    </div>
  </div>`;
  document.getElementById('createForm').onsubmit = e => {
    e.preventDefault();
    socket.emit('create', { name: cName.value }, res => res.ok ? save(res) : (cErr.textContent = res.error));
  };
  document.getElementById('joinForm').onsubmit = e => {
    e.preventDefault();
    socket.emit('join', { name: jName.value, code: jCode.value }, res => res.ok ? save(res) : (jErr.textContent = res.error));
  };
}

function lobbyView() {
  const mine = me()?.teamId;
  const claimed = state.teams.filter(t => t.owner).length;
  const r = state.rules;
  app.innerHTML = `<div class="wrap">${topBar()}
    <div class="lobby-grid">
      <section>
        <div class="eyebrow">Step 1 · Pick a side</div>
        <h2 class="page-title">Claim your franchise</h2>
        <p class="muted">Each person runs one team. Unclaimed teams sit out the auction.</p>
        <div class="team-grid">
          ${state.teams.map(t => {
            const taken = t.owner && t.id !== mine;
            return `<button class="team-card ${t.id === mine ? 'mine' : ''}" style="${teamVars(t)}"
              data-act="pick" data-team="${t.id}" ${taken ? 'disabled' : ''}>
              ${badge(t, 'lg')}
              <span class="team-text">
                <strong>${esc(t.name)}</strong>
                <span class="small">${t.id === mine ? 'Your team · tap to release' : t.owner ? `Owned by ${esc(t.owner)}` : 'Available'}</span>
              </span>
            </button>`;
          }).join('')}
        </div>
      </section>
      <aside class="panel glass">
        <h3>In the room <span class="count">${state.members.length}/${r.maxMembers}</span></h3>
        <ul class="people">
          ${state.members.map(m => {
            const t = m.teamId && team(m.teamId);
            return `<li><span class="who"><span class="dot ${m.online ? '' : 'off'}"></span>${esc(m.name)}${m.id === state.hostId ? ' <span class="host-tag">Host</span>' : ''}</span>
              ${t ? badge(t, 'sm') : '<span class="small muted">No team</span>'}</li>`;
          }).join('')}
        </ul>
        <div class="rules">
          <div><b>${fmt(r.purse)}</b><span>Purse</span></div>
          <div><b>${r.maxSquad}</b><span>Max squad</span></div>
          <div><b>${r.maxOverseas}</b><span>Overseas</span></div>
          <div><b>${r.bidSeconds}s</b><span>Bid clock</span></div>
        </div>
        ${isHost()
          ? `<button class="btn primary block" data-act="start" ${claimed ? '' : 'disabled'}>Start the auction</button>
             ${claimed ? '' : '<p class="small muted">Claim at least one team to start.</p>'}
             ${claimed && !mine ? '<p class="small warn-text">You haven’t claimed a team yourself. Pick one above if you want to bid.</p>' : ''}`
          : '<p class="muted waiting">Waiting for the host to start the auction…</p>'}
      </aside>
    </div>
  </div>`;
}

// Shown on the auction board to anyone without a team, so late joiners can still play.
function joinStrip() {
  const free = state.teams.filter(t => !t.owner);
  return `<div class="join-strip">
    <strong>You don’t have a team yet</strong>
    ${free.length
      ? `<span class="small muted">Pick a free franchise to start bidding. You get the full ${fmt(state.rules.purse)} purse.</span>
         <div class="join-teams">${free.map(t => `<button class="join-team" data-act="pick" data-team="${t.id}" style="${teamVars(t)}" title="${esc(t.name)}">${badge(t)}<span>${esc(t.id)}</span></button>`).join('')}</div>`
      : '<span class="small muted">All 10 franchises are taken, so you’re watching this one.</span>'}
  </div>`;
}

function bidState() {
  const m = me(), t = m?.teamId && team(m.teamId);
  if (!t) return { ok: false, hint: 'Pick a free franchise to start bidding.' };
  if (state.paused) return { ok: false, hint: 'The host has paused the auction.' };
  if (state.status !== 'live') return { ok: false, hint: 'Next player coming up.' };
  if (state.leader === t.id) return { ok: false, hint: 'You hold the top bid.' };
  if (t.purse < state.nextBid) return { ok: false, hint: 'Not enough left in your purse.' };
  if (t.squad.length >= state.rules.maxSquad) return { ok: false, hint: 'Your squad is full.' };
  if (state.lot.overseas && t.squad.filter(p => p.overseas).length >= state.rules.maxOverseas) return { ok: false, hint: 'Overseas limit reached.' };
  return { ok: true, hint: `${fmt(t.purse)} left in your purse · press Space to bid` };
}

function auctionView() {
  if (view === 'squads') return squadsPage(false);
  if (view === 'xi') return xiPage();
  if (view === 'xi-edit') return xiEditPage();
  const lot = state.lot, lead = team(state.leader), b = bidState(), r = state.result;
  const bump = state.bid != null && state.bid !== lastBid;
  lastBid = state.bid;
  const soldTo = r?.sold && team(r.teamId);
  const glow = soldTo || lead;
  app.innerHTML = `<div class="wrap">${topBar()}
    <div class="stage">
      <section class="board" ${glow ? `style="${teamVars(glow)}"` : ''}>
        ${lot ? `
          <div class="board-head">
            <span class="set">${state.unsoldRound ? 'Unsold round' : SET[lot.base] || 'Auction set'}</span>
            <span class="muted small">${state.remaining} players left after this one</span>
          </div>
          <div class="lot">
            <div class="portrait">${avatar(lot, 'xl')}</div>
            <div class="lot-info">
              <div class="lot-meta">
                <span class="tag">${ROLE[lot.role]}</span>
                <span class="tag ${lot.overseas ? 'os' : ''}">${esc(lot.country)}${lot.overseas ? ' · Overseas' : ' · Indian'}</span>
              </div>
              <h1 class="lot-name">${esc(lot.name)}</h1>
              <div class="base">Base price <b>${fmt(lot.base)}</b></div>
            </div>
          </div>
          <div class="scoreboard">
            <div>
              <div class="label">${state.bid == null ? 'Opening bid' : 'Current bid'}</div>
              <div class="amount ${bump ? 'bump' : ''}">${state.bid == null ? fmt(lot.base) : fmt(state.bid)}</div>
              <div class="leader">${lead ? `${badge(lead, 'sm')}<span>${esc(lead.name)}</span>` : '<span class="muted">No bids yet</span>'}</div>
            </div>
            <div class="clock" id="clock"><span id="clockNum"></span></div>
          </div>
          ${me()?.teamId ? `
            <button class="bid-btn" data-act="bid" ${b.ok ? '' : 'disabled'}>
              <span>Raise paddle</span><b>${fmt(state.nextBid)}</b>
            </button>
            <div class="bid-hint">${esc(b.hint)}</div>`
          : joinStrip()}
          ${r ? `<div class="stamp ${r.sold ? 'sold' : 'unsold'}">${r.sold ? `Sold<small>${esc(soldTo.id)} · ${fmt(r.price)}</small>` : 'Unsold'}</div>` : ''}
          ${state.paused ? '<div class="paused">Paused</div>' : ''}
          ${isHost() ? `<div class="host-ctrl">
            <span class="small muted">Host controls</span>
            <button class="btn ghost sm" data-act="pause">${state.paused ? 'Resume' : 'Pause'}</button>
            <button class="btn ghost sm" data-act="skip" ${state.status === 'live' ? '' : 'disabled'}>Close lot now</button>
            <button class="btn ghost sm" data-act="end">End auction</button>
          </div>` : ''}
        ` : '<p>Loading next player…</p>'}
      </section>
      <aside class="side">
        <div class="panel glass">
          <h3>Purse remaining</h3>
          <ul class="purses">
            ${state.teams.filter(t => t.owner).map(t => `<li class="${t.id === state.leader ? 'lead' : ''}" style="${teamVars(t)}">
                ${badge(t, 'sm')}
                <span class="p-info">
                  <span class="p-top"><strong>${esc(t.owner)}</strong><span class="money">${fmt(t.purse)}</span></span>
                  <span class="meter"><span style="width:${(t.purse / state.rules.purse) * 100}%"></span></span>
                  <span class="small muted">${t.squad.length}/${state.rules.maxSquad} players · ${t.squad.filter(p => p.overseas).length}/${state.rules.maxOverseas} overseas</span>
                </span>
              </li>`).join('')}
          </ul>
          <div class="side-links">
            <button class="btn ghost sm" data-act="squads">All squads</button>
            <button class="btn ghost sm" data-act="xi">Playing XIs</button>
          </div>
        </div>
        <div class="panel glass">
          <h3>Auction feed</h3>
          <ul class="log">${state.log.slice().reverse().map(l => `<li class="${l.kind}">${esc(l.text)}</li>`).join('')}</ul>
        </div>
      </aside>
    </div>
  </div>`;
  updateClock();
}

function updateClock() {
  const c = document.getElementById('clock'); if (!c || !state) return;
  const t = Math.max(0, state.timeLeft);
  c.style.setProperty('--p', (t / state.rules.bidSeconds) * 100);
  c.classList.toggle('urgent', t <= 3 && state.status === 'live');
  document.getElementById('clockNum').textContent = state.status === 'live' ? t : '–';
}

function subNav() {
  const cur = view === 'board' ? 'squads' : view === 'xi-edit' ? 'xi' : view; // after the auction, 'board' shows squads
  const tab = (v, label) => `<button class="tab ${cur === v ? 'on' : ''}" data-act="${v}">${label}</button>`;
  return `<nav class="tabs">
    ${state.phase === 'auction' ? '<button class="btn secondary sm" data-act="board">← Back to the auction</button>' : ''}
    ${tab('squads', 'Squads')}${tab('xi', 'Playing XIs')}
  </nav>`;
}

const playerLine = p => `${avatar(p, 'sm')}<span class="r-name">${esc(p.name)}<span class="small muted">${ROLE[p.role]}${p.overseas ? ' · Overseas' : ''}</span></span>`;

function squadsPage(final) {
  const teams = state.teams.filter(t => t.owner);
  const mine = me()?.teamId;
  app.innerHTML = `<div class="wrap">${topBar()}
    <div class="eyebrow">${final ? 'Auction complete' : 'Live'}</div>
    <h2 class="page-title">${final ? 'Final squads' : 'Squads so far'}</h2>
    ${subNav()}
    <div class="squads">
      ${teams.map(t => `<section class="squad" style="${teamVars(t)}">
          <header>
            ${badge(t, 'lg')}
            <div><h3>${esc(t.name)}</h3><div class="small">${esc(t.owner)}</div></div>
            ${t.id === mine && t.squad.length ? '<button class="btn ghost sm" data-act="xi-edit">Pick XI</button>' : ''}
          </header>
          <div class="squad-stats">
            <div><b>${t.squad.length}</b><span>Players</span></div>
            <div><b>${fmt(state.rules.purse - t.purse)}</b><span>Spent</span></div>
            <div><b>${fmt(t.purse)}</b><span>Left</span></div>
          </div>
          ${t.squad.length ? `<ul class="roster">${t.squad.slice().sort((a, b) => b.price - a.price).map(p =>
            `<li>${avatar(p, 'sm')}<span class="r-name">${esc(p.name)}<span class="small muted">${ROLE[p.role]}${p.overseas ? ' · Overseas' : ''}</span></span><b>${fmt(p.price)}</b></li>`).join('')}</ul>`
            : '<p class="small muted empty">No players bought yet.</p>'}
        </section>`).join('')}
    </div>
    ${final ? '<div class="tabs"><button class="btn primary" data-act="leave">Start a new auction</button></div>' : ''}
  </div>`;
}

function resultsView() {
  if (view === 'xi') xiPage();
  else if (view === 'xi-edit') xiEditPage();
  else squadsPage(true);
}

// ---------- Playing XI ----------
const ROLE_ORDER = { WK: 0, BAT: 1, AR: 2, BOWL: 3 };
const impactSlot = p => `<div class="impact"><span class="ip-tag">Impact Player</span>${p ? playerLine(p) : '<span class="small muted">Not chosen</span>'}</div>`;

function xiPage() {
  const mine = me()?.teamId;
  app.innerHTML = `<div class="wrap">${topBar()}
    <div class="eyebrow">${state.phase === 'finished' ? 'Auction complete' : 'Live'}</div>
    <h2 class="page-title">Playing XIs</h2>
    ${subNav()}
    <div class="xis">
      ${state.teams.filter(t => t.owner).map(t => {
        const byId = new Map(t.squad.map(p => [p.id, p]));
        const xi = t.xi.xi.map(id => byId.get(id)).filter(Boolean);
        return `<section class="xi-card" style="${teamVars(t)}">
          <header>
            ${badge(t, 'lg')}
            <div><h3>${esc(t.name)}</h3><div class="small">${esc(t.owner)}</div></div>
            ${t.id === mine && t.squad.length ? `<button class="btn ghost sm" data-act="xi-edit">${xi.length ? 'Edit XI' : 'Pick XI'}</button>` : ''}
          </header>
          <div class="pitch">
            ${xi.length
              ? `<ol class="xi-list">${xi.map((p, i) => `<li><span class="no">${i + 1}</span>${playerLine(p)}</li>`).join('')}</ol>
                 ${xi.length < state.rules.xiSize ? `<p class="small warn">${xi.length}/${state.rules.xiSize} picked so far</p>` : ''}`
              : `<p class="xi-empty">${t.id === mine ? 'You haven’t picked your XI yet.' : 'XI not announced yet.'}</p>`}
          </div>
          ${impactSlot(byId.get(t.xi.impact))}
        </section>`;
      }).join('')}
    </div>
  </div>`;
}

function xiCheck(t, d) {
  const byId = new Map(t.squad.map(p => [p.id, p])), r = state.rules;
  const xi = d.xi.map(id => byId.get(id));
  const os = [...d.xi, d.impact].filter(id => byId.get(id)?.overseas).length;
  const errors = [], notes = [];
  if (os > r.xiMaxOverseas) errors.push(`Too many overseas players: ${os} picked, ${r.xiMaxOverseas} allowed including the Impact Player.`);
  if (d.xi.length < r.xiSize) notes.push(`${r.xiSize - d.xi.length} more player${r.xiSize - d.xi.length === 1 ? '' : 's'} to pick.`);
  if (d.xi.length && !xi.some(p => p.role === 'WK')) notes.push('No wicket-keeper in the XI.');
  if (d.xi.length === r.xiSize && xi.filter(p => p.role === 'BOWL' || p.role === 'AR').length < 5) notes.push('Fewer than 5 bowling options.');
  if (d.impact == null) notes.push('No Impact Player chosen yet.');
  return { errors, notes, os };
}

function xiEditPage() {
  const t = team(me()?.teamId);
  if (!t) { view = 'xi'; return xiPage(); }
  const r = state.rules;
  draft ||= { xi: [...t.xi.xi], impact: t.xi.impact };
  const byId = new Map(t.squad.map(p => [p.id, p]));
  const { errors, notes, os } = xiCheck(t, draft);
  const pool = t.squad.slice().sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.price - a.price);
  app.innerHTML = `<div class="wrap">${topBar()}
    <div class="eyebrow">${esc(t.name)}</div>
    <h2 class="page-title">Pick your Playing XI</h2>
    ${subNav()}
    <div class="xi-editor" style="${teamVars(t)}">
      <section class="panel glass">
        <h3>Your squad <span class="count">${t.squad.length}</span></h3>
        <p class="small muted">Tap <b>XI</b> to add a player to the batting order, or <b>Impact</b> to make them your Impact Player.</p>
        ${t.squad.length ? `<ul class="pool">${pool.map(p => {
          const inXI = draft.xi.includes(p.id), isIP = draft.impact === p.id;
          return `<li class="${inXI || isIP ? 'picked' : ''}">${playerLine(p)}
            <button class="chip ${inXI ? 'on' : ''}" data-act="xi-toggle" data-id="${p.id}" aria-pressed="${inXI}">XI</button>
            <button class="chip ip ${isIP ? 'on' : ''}" data-act="xi-impact" data-id="${p.id}" aria-pressed="${isIP}">Impact</button>
          </li>`;
        }).join('')}</ul>` : '<p class="muted">Buy some players first.</p>'}
      </section>
      <section class="panel glass">
        <h3>Batting order</h3>
        <div class="xi-meter">
          <span><b>${draft.xi.length}</b>/${r.xiSize} players</span>
          <span class="${os > r.xiMaxOverseas ? 'bad' : ''}"><b>${os}</b>/${r.xiMaxOverseas} overseas</span>
        </div>
        ${draft.xi.length ? `<ol class="order">${draft.xi.map((id, i) => {
          const p = byId.get(id);
          return `<li><span class="no">${i + 1}</span>${playerLine(p)}
            <button class="icon" data-act="xi-up" data-id="${id}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} up">↑</button>
            <button class="icon" data-act="xi-down" data-id="${id}" ${i === draft.xi.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} down">↓</button>
            <button class="icon" data-act="xi-toggle" data-id="${id}" aria-label="Remove ${esc(p.name)}">✕</button>
          </li>`;
        }).join('')}</ol>` : '<p class="small muted">No players picked yet.</p>'}
        ${impactSlot(byId.get(draft.impact))}
        ${errors.map(m => `<p class="msg bad">${esc(m)}</p>`).join('')}
        ${notes.map(m => `<p class="msg">${esc(m)}</p>`).join('')}
        <div class="xi-actions">
          <button class="btn primary" data-act="xi-save" ${errors.length ? 'disabled' : ''}>Announce XI</button>
          <button class="btn ghost" data-act="xi-cancel">Cancel</button>
        </div>
      </section>
    </div>
  </div>`;
}

function editXI(act, id) {
  const r = state.rules;
  if (act === 'xi-toggle') {
    if (draft.xi.includes(id)) draft.xi = draft.xi.filter(x => x !== id);
    else if (draft.xi.length >= r.xiSize) return toast(`Your XI already has ${r.xiSize} players. Remove one first.`);
    else { draft.xi.push(id); if (draft.impact === id) draft.impact = null; }
  } else if (act === 'xi-impact') {
    draft.impact = draft.impact === id ? null : id;
    draft.xi = draft.xi.filter(x => x !== id);
  } else {
    const i = draft.xi.indexOf(id), j = act === 'xi-up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= draft.xi.length) return;
    [draft.xi[i], draft.xi[j]] = [draft.xi[j], draft.xi[i]];
  }
  render(true);
}

// ---------- celebrations ----------
function celebrate() {
  const r = state.result;
  const key = r?.sold ? `${state.lot?.id}-${r.teamId}` : '';
  if (key && key !== lastSold && state.phase === 'auction') {
    const t = team(r.teamId);
    confetti([t.color, t.alt || t.color, '#FFC93C', '#FFFFFF']);
  }
  lastSold = key;
}

function confetti(colors) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.getElementById('confetti'), ctx = c.getContext('2d'), dpr = devicePixelRatio || 1;
  const W = (c.width = innerWidth * dpr), H = (c.height = innerHeight * dpr);
  const parts = Array.from({ length: 170 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.4,
    vx: (Math.random() - 0.5) * W * 0.022, vy: -(Math.random() * 0.024 + 0.006) * H,
    s: (6 + Math.random() * 8) * dpr, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0]
  }));
  let frame = 0;
  cancelAnimationFrame(confetti.raf);
  (function step() {
    ctx.clearRect(0, 0, W, H);
    parts.forEach(p => {
      p.vy += H * 0.0009; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    });
    if (++frame < 200) confetti.raf = requestAnimationFrame(step);
    else ctx.clearRect(0, 0, W, H);
  })();
}

// Drifting sparks and camera flashes in the stadium background.
(function stadium() {
  const box = document.getElementById('sparks'); if (!box) return;
  const rand = (a, b) => a + Math.random() * (b - a);
  box.innerHTML =
    Array.from({ length: 36 }, () => `<i class="spark" style="left:${rand(0, 100)}%;--d:${rand(9, 20)}s;--delay:-${rand(0, 20)}s;--dx:${rand(-60, 60)}px;--sz:${rand(2, 4)}px"></i>`).join('') +
    Array.from({ length: 14 }, () => `<i class="flash" style="left:${rand(2, 98)}%;bottom:${rand(10, 70)}px;--d:${rand(3, 8)}s;--delay:-${rand(0, 8)}s"></i>`).join('');
})();

// ---------- actions (delegated) ----------
app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'pick') socket.emit('pickTeam', { teamId: me()?.teamId === el.dataset.team ? null : el.dataset.team });
  else if (act === 'copy') {
    const url = `${location.origin}/?room=${state.code}`;
    navigator.clipboard?.writeText(url).then(() => toast('Invite link copied.'), () => toast(url));
  }
  else if (act === 'leave') { socket.emit('leave'); save(null); state = null; view = 'board'; draft = null; history.replaceState(null, '', '/'); render(true); }
  else if (['squads', 'board', 'xi', 'xi-edit'].includes(act)) { view = act; draft = null; render(true); }
  else if (['xi-toggle', 'xi-impact', 'xi-up', 'xi-down'].includes(act)) editXI(act, Number(el.dataset.id));
  else if (act === 'xi-cancel') { view = 'xi'; draft = null; render(true); }
  else if (act === 'xi-save') {
    socket.emit('setXI', draft, res => {
      if (!res?.ok) return toast(res?.error || 'Could not save your XI.');
      toast('Playing XI announced.'); view = 'xi'; draft = null; render(true);
    });
  }
  else socket.emit(act); // start, bid, pause, skip, end
});

// Spacebar bids during the auction
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && state?.phase === 'auction' && view === 'board' && !['INPUT', 'BUTTON'].includes(document.activeElement.tagName)) {
    e.preventDefault(); if (bidState().ok) socket.emit('bid');
  }
});
