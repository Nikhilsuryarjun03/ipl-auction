const app = document.getElementById('app');
const socket = io();
const KEY = 'auction-session';

let state = null;
let session = load();
let view = 'board';       // board | squads | xi | xi-edit
let lastKey = '';
let meta = null;          // { teams, rules } sent on connect, used before joining a room
let draft = null;         // Playing XI being edited: { xi: [ids in batting order], impact }
let homeTab = 'create';
let lastSold = '';
let lastBid = null;

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save(s) { session = s; try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = l => (l >= 100 ? `₹${+(l / 100).toFixed(2)} cr` : `₹${l} L`);
const ROLE = { BAT: 'Batter', BOWL: 'Bowler', AR: 'All-rounder', WK: 'Wicket-keeper' };
const SET = { 200: 'Marquee', 150: 'Capped · Set 2', 100: 'Capped · Set 3', 75: 'Capped · Set 4', 50: 'Capped · Set 5', 30: 'Uncapped' };
const me = () => state?.members.find(m => m.id === session?.memberId);
const team = id => state?.teams.find(t => t.id === id);
const isHost = () => state && session && state.hostId === session.memberId;
const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

const ICON = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>'
};

// Dark or light text, whichever reads better on the team colour.
function ink(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#0B1230' : '#FFFFFF';
}
const teamVars = t => `--c:${t.color};--c2:${t.alt || t.color};--ink:${ink(t.color)}`;
const badge = (t, size = '') => `<span class="badge ${size}" style="${teamVars(t)}">${esc(t.id)}${t.logo
  ? `<img src="${esc(t.logo)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}</span>`;

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

// Broken logos fall back to the team code; broken photos fall back to initials.
document.addEventListener('error', e => {
  if (e.target.matches?.('.badge img')) e.target.remove();
  if (e.target.matches?.('.avatar img')) { e.target.parentElement.classList.remove('has-img'); e.target.remove(); }
}, true);

// ---------- sound (Web Audio, no files needed) ----------
const sfx = {
  on: (() => { try { return localStorage.getItem('auction-sound') !== 'off'; } catch { return true; } })(),
  ctx: null,
  unlock() { // browsers only allow audio after the first tap or key press
    if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) this.ctx = new AC(); }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  },
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('auction-sound', this.on ? 'on' : 'off'); } catch {}
    if (this.on) { this.unlock(); this.bid(); }
  },
  tone(freq, start = 0, dur = 0.12, type = 'sine', vol = 0.15) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + start, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  tick() { this.tone(740, 0, 0.06, 'square', 0.04); },
  beep() { this.tone(1175, 0, 0.14, 'square', 0.07); },
  bid() { this.tone(587, 0, 0.07, 'triangle', 0.14); this.tone(880, 0.06, 0.1, 'triangle', 0.14); },
  sold() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.08, 0.28, 'triangle', 0.13)); },
  unsold() { this.tone(330, 0, 0.16, 'sine', 0.12); this.tone(247, 0.14, 0.3, 'sine', 0.12); }
};
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => sfx.unlock(), { capture: true }));

function playSounds(prev, s) {
  if (!prev || s.phase !== 'auction') return;
  const sameLot = s.lot && prev.lot && s.lot.id === prev.lot.id;
  if (sameLot && s.bid != null && s.bid !== prev.bid) sfx.bid();
  if (s.result && !prev.result) return s.result.sold ? sfx.sold() : sfx.unsold();
  if (sameLot && s.status === 'live' && !s.paused && s.timeLeft > 0 && s.timeLeft < prev.timeLeft) {
    if (s.timeLeft <= 3) sfx.beep();
    else if (s.timeLeft <= 5) sfx.tick();
  }
}

// ---------- socket ----------
socket.on('connect', () => {
  // An invite to a different room beats the room this browser was last in.
  const invite = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();
  if (session && invite && session.code !== invite) save(null);
  if (session) socket.emit('rejoin', session, res => { if (!res?.ok) { save(null); state = null; render(true); } });
  else render(true);
});
socket.on('meta', m => {
  meta = m;
  // Fill in the home screen's logo row without wiping anything typed into the forms.
  const row = document.querySelector('.logo-row');
  if (row) row.innerHTML = m.teams.map(t => badge(t)).join('');
});
socket.on('state', s => { const prev = state; state = s; playSounds(prev, s); celebrate(); render(); });
socket.on('toast', toast);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
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

const brand = `<div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>Auction Room</span><span class="brand-tag">IPL</span></div>`;

function topBar() {
  const t = me()?.teamId && team(me().teamId);
  return `<header class="topbar"><div class="topbar-in">
    ${brand}
    <div class="tb-right">
      <button class="room-chip" data-act="copy" title="Copy invite link">
        <span class="muted">Room</span><b>${esc(state.code)}</b>${ICON.copy}
      </button>
      ${t ? `<span class="me-chip">${badge(t, 'xs')}<span>${esc(me().name)}</span></span>` : ''}
      <button class="icon-btn" data-act="sound" title="${sfx.on ? 'Mute sounds' : 'Turn sounds on'}" aria-label="${sfx.on ? 'Mute sounds' : 'Turn sounds on'}">${sfx.on ? ICON.soundOn : ICON.soundOff}</button>
      <button class="icon-btn" data-act="leave" title="Leave room" aria-label="Leave room">${ICON.exit}</button>
    </div>
  </div></header>`;
}

// Invite links (/?room=CODE) only ask for a name; the code comes from the link.
function inviteCard(code) {
  return `<section class="card entry invite">
    <span class="label">You’re invited to join</span>
    <div class="invite-room">Room <b>${esc(code)}</b></div>
    <form id="inviteForm">
      <label for="iName">Your name</label>
      <input id="iName" maxlength="20" required autocomplete="nickname" placeholder="e.g. Prudhvi" autofocus />
      <button class="btn primary block" type="submit">Join room</button>
      <div class="error" id="iErr"></div>
    </form>
    <p class="hint center">Not your room? <button class="link" id="noInvite" type="button">Create or join a different one</button></p>
  </section>`;
}

function homeView() {
  const invite = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase().slice(0, 5);
  const r = meta?.rules;
  app.innerHTML = `<div class="home">
    <header class="topbar plain"><div class="topbar-in">${brand}</div></header>
    <main class="home-main">
      <section class="intro">
        <span class="pill"><span class="live-dot"></span>Live multiplayer auction</span>
        <h1>Run your own IPL auction with friends</h1>
        <p class="lede">Create a room, share the code, claim a franchise and bid for players in real time. The clock resets on every bid. Last paddle up wins.</p>
        <dl class="facts">
          <div><dt>Purse</dt><dd>${r ? fmt(r.purse) : '₹120 cr'}</dd></div>
          <div><dt>Squad size</dt><dd>${r ? r.maxSquad : 25}</dd></div>
          <div><dt>Players / room</dt><dd>${r ? r.maxMembers : 10}</dd></div>
        </dl>
        <div class="logo-row" aria-hidden="true">${(meta?.teams || []).map(t => badge(t)).join('')}</div>
      </section>
      ${invite ? inviteCard(invite) : `<section class="card entry">
        <div class="seg" role="tablist">
          <button role="tab" class="${homeTab === 'create' ? 'on' : ''}" aria-selected="${homeTab === 'create'}" data-tab="create">Create room</button>
          <button role="tab" class="${homeTab === 'join' ? 'on' : ''}" aria-selected="${homeTab === 'join'}" data-tab="join">Join room</button>
        </div>
        <form id="createForm" ${homeTab === 'create' ? '' : 'hidden'}>
          <label for="cName">Your name</label>
          <input id="cName" maxlength="20" required autocomplete="nickname" placeholder="e.g. Nikhil" />
          <button class="btn primary block" type="submit">Create room</button>
          <p class="hint">You’ll be the host and get a 5-letter code to share.</p>
          <div class="error" id="cErr"></div>
        </form>
        <form id="joinForm" ${homeTab === 'join' ? '' : 'hidden'}>
          <label for="jName">Your name</label>
          <input id="jName" maxlength="20" required autocomplete="nickname" placeholder="e.g. Prudhvi" />
          <label for="jCode">Room code</label>
          <input id="jCode" class="code" maxlength="5" required placeholder="ABCDE" autocapitalize="characters" />
          <button class="btn primary block" type="submit">Join room</button>
          <div class="error" id="jErr"></div>
        </form>
      </section>`}
    </main>
  </div>`;
  if (invite) {
    inviteForm.onsubmit = e => {
      e.preventDefault();
      socket.emit('join', { name: iName.value, code: invite }, res => res.ok ? save(res) : (iErr.textContent = res.error));
    };
    noInvite.onclick = () => { history.replaceState(null, '', '/'); homeTab = 'create'; homeView(); };
    return;
  }
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    homeTab = b.dataset.tab;
    app.querySelectorAll('[data-tab]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    createForm.hidden = homeTab !== 'create'; joinForm.hidden = homeTab !== 'join';
  });
  createForm.onsubmit = e => {
    e.preventDefault();
    socket.emit('create', { name: cName.value }, res => res.ok ? save(res) : (cErr.textContent = res.error));
  };
  joinForm.onsubmit = e => {
    e.preventDefault();
    socket.emit('join', { name: jName.value, code: jCode.value }, res => res.ok ? save(res) : (jErr.textContent = res.error));
  };
}

function timerControl(compact) {
  const r = state.rules;
  if (!isHost()) return `<span class="value">${r.bidSeconds} s</span>`;
  return `<div class="seg ${compact ? 'sm' : ''}" role="group" aria-label="Bid timer">
    ${r.timerOptions.map(s => `<button class="${s === r.bidSeconds ? 'on' : ''}" data-act="timer" data-s="${s}" aria-pressed="${s === r.bidSeconds}">${s}s</button>`).join('')}
  </div>`;
}

function lobbyView() {
  const mine = me()?.teamId;
  const claimed = state.teams.filter(t => t.owner).length;
  const r = state.rules;
  app.innerHTML = `${topBar()}
  <main class="page">
    <div class="page-head">
      <div>
        <h1>Choose your franchise</h1>
        <p class="muted">Each person runs one team. Teams nobody picks sit out the auction.</p>
      </div>
      <span class="pill">${claimed}/10 claimed</span>
    </div>
    <div class="lobby">
      <section class="team-grid">
        ${state.teams.map(t => {
          const taken = t.owner && t.id !== mine;
          const status = t.id === mine ? 'Your team' : t.owner ? esc(t.owner) : 'Available';
          return `<button class="team-card ${t.id === mine ? 'mine' : ''}" style="${teamVars(t)}"
            data-act="pick" data-team="${t.id}" ${taken ? 'disabled' : ''} title="${t.id === mine ? 'Tap to release' : ''}">
            ${badge(t, 'md')}
            <span class="tc-text"><strong>${esc(t.name)}</strong><span class="tc-status ${t.owner ? 'taken' : ''}">${status}</span></span>
          </button>`;
        }).join('')}
      </section>
      <aside class="side">
        <section class="card">
          <div class="card-head"><h2>Players</h2><span class="muted small">${state.members.length}/${r.maxMembers}</span></div>
          <ul class="people">
            ${state.members.map(m => {
              const t = m.teamId && team(m.teamId);
              return `<li><span class="dot ${m.online ? '' : 'off'}"></span><span class="who">${esc(m.name)}${m.id === state.hostId ? '<span class="tag">Host</span>' : ''}</span>
                ${t ? `<span class="team-mini">${badge(t, 'xs')}${esc(t.id)}</span>` : '<span class="muted small">No team</span>'}</li>`;
            }).join('')}
          </ul>
        </section>
        <section class="card">
          <div class="card-head"><h2>Auction rules</h2></div>
          <dl class="rules">
            <div><dt>Purse</dt><dd>${fmt(r.purse)}</dd></div>
            <div><dt>Squad size</dt><dd>Up to ${r.maxSquad}</dd></div>
            <div><dt>Overseas</dt><dd>Up to ${r.maxOverseas}</dd></div>
            <div class="stack"><dt>Bid timer</dt><dd>${timerControl(false)}</dd></div>
          </dl>
          ${isHost()
            ? `<button class="btn primary block" data-act="start" ${claimed ? '' : 'disabled'}>Start auction</button>
               ${claimed ? '' : '<p class="hint">At least one team must be claimed to start.</p>'}
               ${claimed && !mine ? '<p class="hint warn">You haven’t picked a team yourself. Pick one if you want to bid.</p>' : ''}`
            : '<p class="hint center">Waiting for the host to start the auction…</p>'}
        </section>
      </aside>
    </div>
  </main>`;
}

// Shown on the auction board to anyone without a team, so late joiners can still play.
function joinStrip() {
  const free = state.teams.filter(t => !t.owner);
  return `<div class="join-strip">
    <div><strong>You don’t have a team yet</strong>
    <p class="muted small">${free.length ? `Pick a free franchise to start bidding with the full ${fmt(state.rules.purse)} purse.` : 'All 10 franchises are taken, so you’re watching this one.'}</p></div>
    ${free.length ? `<div class="join-teams">${free.map(t => `<button class="join-team" data-act="pick" data-team="${t.id}" title="${esc(t.name)}">${badge(t, 'sm')}<span>${esc(t.id)}</span></button>`).join('')}</div>` : ''}
  </div>`;
}

function bidState() {
  const m = me(), t = m?.teamId && team(m.teamId);
  if (!t) return { ok: false, hint: 'Pick a free franchise to start bidding.' };
  if (state.paused) return { ok: false, hint: 'The host has paused the auction.' };
  if (state.status !== 'live') return { ok: false, hint: 'Next player coming up…' };
  if (state.leader === t.id) return { ok: false, hint: 'You hold the highest bid.' };
  if (t.purse < state.nextBid) return { ok: false, hint: 'Not enough left in your purse.' };
  if (t.squad.length >= state.rules.maxSquad) return { ok: false, hint: 'Your squad is full.' };
  if (state.lot.overseas && t.squad.filter(p => p.overseas).length >= state.rules.maxOverseas) return { ok: false, hint: 'You’ve reached the overseas limit.' };
  return { ok: true, hint: `${fmt(t.purse)} left · press Space to bid` };
}

function auctionView() {
  if (view === 'squads') return squadsPage(false);
  if (view === 'xi') return xiPage();
  if (view === 'xi-edit') return xiEditPage();
  const lot = state.lot, lead = team(state.leader), b = bidState(), r = state.result;
  const soldTo = r?.sold && team(r.teamId);
  const bump = state.bid != null && state.bid !== lastBid;
  lastBid = state.bid;
  app.innerHTML = `${topBar()}
  <main class="page">
    <div class="auction">
      <section class="stage">
        ${lot ? `
        <article class="card lot-card" ${lead ? `style="${teamVars(lead)}"` : ''}>
          <div class="lot-photo">${avatar(lot, 'photo')}</div>
          <div class="lot-body">
            <div class="lot-top">
              <span class="pill live"><span class="live-dot"></span>${state.unsoldRound ? 'Unsold round' : SET[lot.base] || 'Auction'}</span>
              <span class="muted small">${state.remaining} players left</span>
            </div>
            <h1 class="lot-name">${esc(lot.name)}</h1>
            <div class="tags">
              <span class="tag">${ROLE[lot.role]}</span>
              <span class="tag ${lot.overseas ? 'os' : ''}">${esc(lot.country)}${lot.overseas ? ' · Overseas' : ''}</span>
            </div>
            <dl class="lot-stats">
              <div><dt>Base price</dt><dd>${fmt(lot.base)}</dd></div>
              <div><dt>Role</dt><dd>${ROLE[lot.role]}</dd></div>
              <div><dt>Nationality</dt><dd>${lot.overseas ? 'Overseas' : 'Indian'}</dd></div>
            </dl>
          </div>
        </article>

        <article class="card bid-card" id="bidCard">
          ${state.paused ? '<div class="banner paused">Auction paused by the host</div>' : ''}
          ${r ? (r.sold
            ? `<div class="banner sold" style="${teamVars(soldTo)}">${badge(soldTo, 'sm')}<span><b>Sold</b> to ${esc(soldTo.name)}</span><b class="banner-amt">${fmt(r.price)}</b></div>`
            : '<div class="banner unsold"><b>Unsold</b><span>No bids. The player goes to the unsold list.</span></div>') : ''}
          <div class="bid-main">
            <div class="bid-info">
              <span class="label">${state.bid == null ? 'Opening bid' : 'Current bid'}</span>
              <div class="amount ${bump ? 'bump' : ''}">${state.bid == null ? fmt(lot.base) : fmt(state.bid)}</div>
              <div class="leader">${lead ? `${badge(lead, 'xs')}<span><b>${esc(lead.name)}</b> leading</span>` : '<span class="muted">No bids yet</span>'}</div>
            </div>
            <div class="clock" id="clock" role="timer" aria-label="Seconds left"><span id="clockNum"></span><small>sec</small></div>
          </div>
          ${me()?.teamId ? `
            <button class="bid-btn" data-act="bid" ${b.ok ? '' : 'disabled'}>Bid ${fmt(state.nextBid)}</button>
            <p class="bid-hint">${esc(b.hint)}</p>`
          : joinStrip()}
          ${isHost() ? `<div class="host-bar">
            <span class="host-label">Host</span>
            <button class="btn sm" data-act="pause">${state.paused ? 'Resume' : 'Pause'}</button>
            <button class="btn sm" data-act="skip" ${state.status === 'live' ? '' : 'disabled'}>Close lot</button>
            <button class="btn sm danger" data-act="end">End auction</button>
            <span class="host-timer"><span class="muted small">Timer</span>${timerControl(true)}</span>
          </div>` : ''}
        </article>
        ` : '<article class="card empty-state">Loading next player…</article>'}
      </section>

      <aside class="side">
        <section class="card">
          <div class="card-head"><h2>Teams</h2>
            <div class="head-links"><button class="link" data-act="squads">Squads</button><button class="link" data-act="xi">Playing XIs</button></div>
          </div>
          <ul class="purses">
            ${state.teams.filter(t => t.owner).map(t => `<li class="${t.id === state.leader ? 'lead' : ''}" style="${teamVars(t)}">
              ${badge(t, 'sm')}
              <div class="p-info">
                <div class="p-top"><span class="p-name">${esc(t.owner)} <span class="muted">· ${esc(t.id)}</span></span><span class="money">${fmt(t.purse)}</span></div>
                <div class="meter"><span style="width:${(t.purse / state.rules.purse) * 100}%"></span></div>
                <div class="p-sub">${t.squad.length}/${state.rules.maxSquad} players · ${t.squad.filter(p => p.overseas).length}/${state.rules.maxOverseas} overseas</div>
              </div>
            </li>`).join('')}
          </ul>
        </section>
        <section class="card">
          <div class="card-head"><h2>Activity</h2></div>
          <ul class="log">${state.log.slice().reverse().map(l => `<li class="${l.kind}">${esc(l.text)}</li>`).join('')}</ul>
        </section>
      </aside>
    </div>
  </main>`;
  updateClock();
}

function updateClock() {
  const c = document.getElementById('clock'); if (!c || !state) return;
  const t = Math.max(0, state.timeLeft), live = state.status === 'live' && !state.paused;
  c.style.setProperty('--p', (t / state.rules.bidSeconds) * 100);
  c.classList.toggle('urgent', live && t <= 3);
  c.classList.toggle('warn', live && t > 3 && t <= 5);
  document.getElementById('bidCard')?.classList.toggle('urgent', live && t <= 3);
  document.getElementById('clockNum').textContent = state.status === 'live' ? t : '–';
}

function subNav() {
  const cur = view === 'board' ? 'squads' : view === 'xi-edit' ? 'xi' : view; // after the auction, 'board' shows squads
  const tab = (v, label) => `<button class="${cur === v ? 'on' : ''}" data-act="${v}">${label}</button>`;
  return `<nav class="subnav">
    ${state.phase === 'auction' ? `<button class="btn sm" data-act="board">${ICON.back}Back to auction</button>` : ''}
    <div class="seg">${tab('squads', 'Squads')}${tab('xi', 'Playing XIs')}</div>
  </nav>`;
}

const playerLine = p => `${avatar(p, 'sm')}<span class="r-name">${esc(p.name)}<span class="r-sub">${ROLE[p.role]}${p.overseas ? ' · Overseas' : ''}</span></span>`;

function teamHead(t, action = '') {
  return `<header class="team-head" style="${teamVars(t)}">
    ${badge(t, 'md')}
    <div class="th-text"><h3>${esc(t.name)}</h3><span>${esc(t.owner)}</span></div>
    ${action}
  </header>`;
}

function squadsPage(final) {
  const teams = state.teams.filter(t => t.owner);
  const mine = me()?.teamId;
  app.innerHTML = `${topBar()}
  <main class="page">
    <div class="page-head"><div><h1>${final ? 'Final squads' : 'Squads so far'}</h1>
      <p class="muted">${final ? 'The auction is complete. Pick your Playing XI from the Playing XIs tab.' : 'Updated live as players are sold.'}</p></div></div>
    ${subNav()}
    <div class="grid-cards">
      ${teams.map(t => `<section class="card team-card-lg">
          ${teamHead(t, t.id === mine && t.squad.length ? '<button class="btn sm" data-act="xi-edit">Pick XI</button>' : '')}
          <dl class="mini-stats">
            <div><dt>Players</dt><dd>${t.squad.length}</dd></div>
            <div><dt>Spent</dt><dd>${fmt(state.rules.purse - t.purse)}</dd></div>
            <div><dt>Left</dt><dd>${fmt(t.purse)}</dd></div>
          </dl>
          ${t.squad.length ? `<ul class="roster">${t.squad.slice().sort((a, b) => b.price - a.price).map(p =>
            `<li>${playerLine(p)}<b class="price">${fmt(p.price)}</b></li>`).join('')}</ul>`
            : '<p class="empty">No players bought yet.</p>'}
        </section>`).join('')}
    </div>
    ${final ? '<div class="page-foot"><button class="btn primary" data-act="leave">Start a new auction</button></div>' : ''}
  </main>`;
}

function resultsView() {
  if (view === 'xi') xiPage();
  else if (view === 'xi-edit') xiEditPage();
  else squadsPage(true);
}

// ---------- Playing XI ----------
const ROLE_ORDER = { WK: 0, BAT: 1, AR: 2, BOWL: 3 };
const impactSlot = p => `<div class="impact"><span class="ip-tag">Impact Player</span>${p ? playerLine(p) : '<span class="muted small">Not chosen</span>'}</div>`;

function xiPage() {
  const mine = me()?.teamId;
  app.innerHTML = `${topBar()}
  <main class="page">
    <div class="page-head"><div><h1>Playing XIs</h1><p class="muted">Each owner names 11 players in batting order plus one Impact Player.</p></div></div>
    ${subNav()}
    <div class="grid-cards">
      ${state.teams.filter(t => t.owner).map(t => {
        const byId = new Map(t.squad.map(p => [p.id, p]));
        const xi = t.xi.xi.map(id => byId.get(id)).filter(Boolean);
        return `<section class="card team-card-lg">
          ${teamHead(t, t.id === mine && t.squad.length ? `<button class="btn sm" data-act="xi-edit">${xi.length ? 'Edit XI' : 'Pick XI'}</button>` : '')}
          ${xi.length
            ? `<ol class="roster numbered">${xi.map((p, i) => `<li><span class="no">${i + 1}</span>${playerLine(p)}</li>`).join('')}</ol>
               ${xi.length < state.rules.xiSize ? `<p class="hint warn pad">${xi.length}/${state.rules.xiSize} picked so far</p>` : ''}`
            : `<p class="empty">${t.id === mine ? 'You haven’t picked your XI yet.' : 'XI not announced yet.'}</p>`}
          ${impactSlot(byId.get(t.xi.impact))}
        </section>`;
      }).join('')}
    </div>
  </main>`;
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
  app.innerHTML = `${topBar()}
  <main class="page">
    <div class="page-head"><div><h1>Pick your Playing XI</h1><p class="muted">${esc(t.name)} · tap <b>XI</b> to add to the batting order, <b>Impact</b> for your Impact Player.</p></div></div>
    ${subNav()}
    <div class="xi-editor">
      <section class="card">
        <div class="card-head"><h2>Squad</h2><span class="muted small">${t.squad.length} players</span></div>
        ${t.squad.length ? `<ul class="roster pool">${pool.map(p => {
          const inXI = draft.xi.includes(p.id), isIP = draft.impact === p.id;
          return `<li class="${inXI || isIP ? 'picked' : ''}">${playerLine(p)}
            <button class="chip ${inXI ? 'on' : ''}" data-act="xi-toggle" data-id="${p.id}" aria-pressed="${inXI}">XI</button>
            <button class="chip ip ${isIP ? 'on' : ''}" data-act="xi-impact" data-id="${p.id}" aria-pressed="${isIP}">Impact</button>
          </li>`;
        }).join('')}</ul>` : '<p class="empty">Buy some players first.</p>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>Batting order</h2>
          <span class="counts"><span>${draft.xi.length}/${r.xiSize}</span><span class="${os > r.xiMaxOverseas ? 'bad' : ''}">${os}/${r.xiMaxOverseas} overseas</span></span>
        </div>
        ${draft.xi.length ? `<ol class="roster numbered">${draft.xi.map((id, i) => {
          const p = byId.get(id);
          return `<li><span class="no">${i + 1}</span>${playerLine(p)}
            <span class="row-actions">
              <button class="icon-btn sm" data-act="xi-up" data-id="${id}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} up">↑</button>
              <button class="icon-btn sm" data-act="xi-down" data-id="${id}" ${i === draft.xi.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(p.name)} down">↓</button>
              <button class="icon-btn sm" data-act="xi-toggle" data-id="${id}" aria-label="Remove ${esc(p.name)}">✕</button>
            </span>
          </li>`;
        }).join('')}</ol>` : '<p class="empty">No players picked yet.</p>'}
        ${impactSlot(byId.get(draft.impact))}
        <div class="pad">
          ${errors.map(m => `<p class="msg bad">${esc(m)}</p>`).join('')}
          ${notes.map(m => `<p class="msg">${esc(m)}</p>`).join('')}
          <div class="xi-actions">
            <button class="btn primary" data-act="xi-save" ${errors.length ? 'disabled' : ''}>Announce XI</button>
            <button class="btn" data-act="xi-cancel">Cancel</button>
          </div>
        </div>
      </section>
    </div>
  </main>`;
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
    confetti([t.color, t.alt || t.color, '#F5B841', '#FFFFFF']);
  }
  lastSold = key;
}

function confetti(colors) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.getElementById('confetti'), ctx = c.getContext('2d'), dpr = devicePixelRatio || 1;
  const W = (c.width = innerWidth * dpr), H = (c.height = innerHeight * dpr);
  const parts = Array.from({ length: 110 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.25, y: H * 0.35,
    vx: (Math.random() - 0.5) * W * 0.018, vy: -(Math.random() * 0.02 + 0.006) * H,
    s: (5 + Math.random() * 6) * dpr, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3,
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
    if (++frame < 170) confetti.raf = requestAnimationFrame(step);
    else ctx.clearRect(0, 0, W, H);
  })();
}

// ---------- actions (delegated) ----------
app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'pick') socket.emit('pickTeam', { teamId: me()?.teamId === el.dataset.team ? null : el.dataset.team });
  else if (act === 'copy') {
    const url = `${location.origin}/?room=${state.code}`;
    navigator.clipboard?.writeText(url).then(() => toast('Invite link copied. Send it to your friends.'), () => toast(url));
  }
  else if (act === 'sound') { sfx.toggle(); render(true); toast(sfx.on ? 'Sounds on' : 'Sounds off'); }
  else if (act === 'timer') socket.emit('setTimer', { seconds: Number(el.dataset.s) });
  else if (act === 'leave') { socket.emit('leave'); save(null); state = null; view = 'board'; draft = null; history.replaceState(null, '', '/'); render(true); }
  else if (['squads', 'board', 'xi', 'xi-edit'].includes(act)) { view = act; draft = null; render(true); scrollTo(0, 0); }
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
