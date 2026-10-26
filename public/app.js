const app = document.getElementById('app');
const socket = io();
const KEY = 'auction-session';

let state = null;
let session = load();
let view = 'board';       // board | squads | xi | xi-edit | summary
let lastKey = '';
let meta = null;          // { teams, rules, modes, players } sent on connect
let catalog = new Map();  // player id -> player, from meta
let draft = null;         // Playing XI being edited: { xi: [ids in batting order], impact }
let homeTab = 'create';
let homeSport = 'cricket'; // sport picked on the home screen's Create tab
let boardTab = 'upcoming'; // upcoming | sold | unsold | leaders
let showAllUpcoming = false;
let feedFilter = 'all';   // all | chat
const openTeams = new Set(); // teams expanded in the Teams panel
let lastSold = '';
let lastBid = null;

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function save(s) { session = s; try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sportNow = () => state?.sport || homeSport;
const isFootball = () => sportNow() === 'football';
// Money: lakhs for cricket (100 = ₹1 cr), €M for football.
const fmt = l => (isFootball() ? `€${l || 0}M` : l >= 100 ? `₹${+(l / 100).toFixed(2)} cr` : l ? `₹${l} L` : '₹0');
const ROLE = {
  BAT: 'Batter', BOWL: 'Bowler', AR: 'All-rounder', WK: 'Wicket-keeper',
  GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward'
};
const ROLE_GROUPS_BY = {
  cricket: [['BAT', 'Batters'], ['WK', 'Wicket-keepers'], ['AR', 'All-rounders'], ['BOWL', 'Bowlers']],
  football: [['GK', 'Goalkeepers'], ['DEF', 'Defenders'], ['MID', 'Midfielders'], ['FWD', 'Forwards']]
};
const roleGroups = () => ROLE_GROUPS_BY[sportNow()];
const XI = () => (isFootball() ? 'Starting XI' : 'Playing XI');
const TEAM_WORD = () => (isFootball() ? 'club' : 'franchise');
const hasOverseas = () => state?.rules.maxOverseas != null;
// Short line under a player's name: "Batter · AUS" or "RW · 89 rated".
const playerSub = p => p.position
  ? `${esc(p.position)} · <span class="rating">${p.rating ?? '–'}</span>`
  : `${ROLE[p.role]}${p.overseas ? ` · <span class="os-text">${esc(p.country)}</span>` : ''}`;
const MODE_ICON = { mega: '🏆', legendsUpgraded: '⭐', legends: '👑', mock: '📋', football: '⚽' };
const P = id => catalog.get(id);
const me =() => state?.members.find(m => m.id === session?.memberId);
const team = id => state?.teams.find(t => t.id === id);
const isHost = () => state && session && state.hostId === session.memberId;
const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

const ICON = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  exit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>'
};
const inviteUrl = () => `${location.origin}/?room=${state.code}`;
const inviteText = () => `Join my IPL auction! Tap the link and enter your name: ${inviteUrl()}`;

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
    gsrsearch: `${name} ${isFootball() ? 'footballer' : 'cricketer'}`, gsrlimit: '5', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '480'
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
  if (s.result && !prev.result) s.result.sold ? sfx.sold() : sfx.unsold();
  const myTurn = x => x?.status === 'rtm' && rtmDecider(x) === me()?.teamId;
  if (myTurn(s) && (!myTurn(prev) || s.rtm.step !== prev.rtm?.step)) sfx.beep();
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
  catalog = new Map(m.players.map(p => [p.id, p]));
  // Fill in the home screen's logo row without wiping anything typed into the forms.
  const row = document.querySelector('.logo-row');
  if (row) row.innerHTML = homeLogos();
  const fp = document.getElementById('factPlayers'), fm = document.getElementById('factModes');
  if (fp) fp.textContent = m.players.length.toLocaleString();
  if (fm) fm.textContent = Object.keys(m.modes).length;
});
socket.on('state', s => { const prev = state; state = s; playSounds(prev, s); celebrate(); render(); });
// The server sends just the seconds left once a second; beep in the last few seconds.
socket.on('tick', t => {
  if (!state) return;
  const prev = state.timeLeft;
  state.timeLeft = t;
  if ((state.status === 'live' || state.status === 'rtm') && !state.paused && t > 0 && t < prev) {
    if (t <= 3) sfx.beep();
    else if (t <= 5) sfx.tick();
  }
  updateClock();
});
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
  const ui = snapshotUI();
  if (state.phase === 'lobby') lobbyView();
  else if (state.phase === 'auction') auctionView();
  else resultsView();
  restoreUI(ui);
  hydrateImages();
}

// Re-renders replace the page, so keep the chat draft, focus and scroll positions across them.
function snapshotUI() {
  const ci = document.getElementById('chatInput'), feed = document.getElementById('feed'), board = document.getElementById('boardBody');
  return {
    chat: ci?.value || '', focus: ci && document.activeElement === ci, sel: ci?.selectionStart ?? 0,
    feedTop: feed?.scrollTop ?? 0, feedAtBottom: !feed || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40,
    boardTop: board?.scrollTop ?? 0
  };
}
function restoreUI(ui) {
  const ci = document.getElementById('chatInput');
  if (ci) {
    ci.value = ui.chat;
    if (ui.focus) { ci.focus({ preventScroll: true }); ci.setSelectionRange(ui.sel, ui.sel); }
  }
  const feed = document.getElementById('feed');
  if (feed) feed.scrollTop = ui.feedAtBottom ? feed.scrollHeight : ui.feedTop;
  const board = document.getElementById('boardBody');
  if (board) board.scrollTop = ui.boardTop;
}

const brandHtml = () => `<div class="brand"><span class="brand-mark ${isFootball() ? 'ball' : ''}" aria-hidden="true"></span><span>Auction Room</span><span class="brand-tag">${isFootball() ? 'Football' : 'IPL'}</span></div>`;
// Home screen logos for the selected sport (football has 50 clubs, so show a dozen).
const homeLogos = () => (meta?.sports[homeSport].teams || []).slice(0, 12).map(t => badge(t)).join('');

function topBar() {
  const t = me()?.teamId && team(me().teamId);
  return `<header class="topbar"><div class="topbar-in">
    ${brandHtml()}
    <div class="tb-right">
      <button class="room-chip" data-act="copy" title="Copy invite link">
        <span class="muted">Room</span><b>${esc(state.code)}</b><span class="chip-act">${ICON.copy}<span>Invite</span></span>
      </button>
      ${t ? `<span class="me-chip">${badge(t, 'xs')}<span>${esc(me().name)}</span></span>` : ''}
      <button class="icon-btn" data-act="sound" title="${sfx.on ? 'Mute sounds' : 'Turn sounds on'}" aria-label="${sfx.on ? 'Mute sounds' : 'Turn sounds on'}">${sfx.on ? ICON.soundOn : ICON.soundOff}</button>
      <button class="icon-btn" data-act="leave" title="Leave room" aria-label="Leave room">${ICON.exit}</button>
    </div>
  </div></header>`;
}

// Invite links (/?room=CODE) slide up a small panel that only asks for a name.
function inviteSheet(code) {
  return `<div class="sheet-backdrop" id="inviteSheet">
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="inviteTitle">
      <button class="icon-btn sm sheet-close" id="noInvite" type="button" aria-label="Close">✕</button>
      <span class="sheet-icon" aria-hidden="true">🔨</span>
      <span class="label">You’re invited</span>
      <h2 id="inviteTitle">Join room <b>${esc(code)}</b></h2>
      <p class="muted small">Enter your name to join. You’ll pick your team in the lobby.</p>
      <form id="inviteForm">
        <input id="iName" maxlength="20" required autocomplete="nickname" placeholder="Your name" aria-label="Your name" />
        <button class="btn primary block" type="submit">Join room</button>
        <div class="error" id="iErr"></div>
      </form>
    </section>
  </div>`;
}

function homeView() {
  const invite = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase().slice(0, 5);
  const r = meta?.rules;
  app.innerHTML = `<div class="home">
    <header class="topbar plain"><div class="topbar-in">${brandHtml()}</div></header>
    <main class="home-main">
      <section class="intro">
        <span class="pill"><span class="live-dot"></span>Live multiplayer auction</span>
        <h1>Run your own IPL or football auction with friends</h1>
        <p class="lede">Create a room, share the link, claim a team and bid for players in real time. IPL mega auction, legends, a 2026 mock auction or a European football auction. Last paddle up wins.</p>
        <dl class="facts">
          <div><dt>Players</dt><dd id="factPlayers">${meta ? meta.players.length.toLocaleString() : '1,300+'}</dd></div>
          <div><dt>Auction modes</dt><dd id="factModes">${meta ? Object.keys(meta.modes).length : 5}</dd></div>
          <div><dt>Players / room</dt><dd>${r ? r.maxMembers : 10}</dd></div>
        </dl>
        <div class="logo-row" aria-hidden="true">${homeLogos()}</div>
      </section>
      <section class="card entry">
        <div class="seg" role="tablist">
          <button role="tab" class="${homeTab === 'create' ? 'on' : ''}" aria-selected="${homeTab === 'create'}" data-tab="create">Create room</button>
          <button role="tab" class="${homeTab === 'join' ? 'on' : ''}" aria-selected="${homeTab === 'join'}" data-tab="join">Join room</button>
        </div>
        <form id="createForm" ${homeTab === 'create' ? '' : 'hidden'}>
          <label>Sport</label>
          <div class="sport-pick" role="radiogroup" aria-label="Sport">
            <button type="button" role="radio" class="${homeSport === 'cricket' ? 'on' : ''}" aria-checked="${homeSport === 'cricket'}" data-sport="cricket"><span aria-hidden="true">🏏</span>Cricket</button>
            <button type="button" role="radio" class="${homeSport === 'football' ? 'on' : ''}" aria-checked="${homeSport === 'football'}" data-sport="football"><span aria-hidden="true">⚽</span>Football</button>
          </div>
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
      </section>
    </main>
  </div>
  ${invite ? inviteSheet(invite) : ''}`;
  if (invite) {
    const sheet = document.getElementById('inviteSheet');
    const close = () => {
      history.replaceState(null, '', '/');
      document.removeEventListener('keydown', onKey);
      sheet.classList.add('closing');
      setTimeout(() => sheet.remove(), 200);
    };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    inviteForm.onsubmit = e => {
      e.preventDefault();
      socket.emit('join', { name: iName.value, code: invite }, res => {
        if (!res.ok) return (iErr.textContent = res.error);
        document.removeEventListener('keydown', onKey);
        save(res);
      });
    };
    noInvite.onclick = close;
    sheet.onclick = e => { if (e.target === sheet) close(); };
    setTimeout(() => iName.focus(), 250);
  }
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    homeTab = b.dataset.tab;
    app.querySelectorAll('[data-tab]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    createForm.hidden = homeTab !== 'create'; joinForm.hidden = homeTab !== 'join';
  });
  app.querySelectorAll('[data-sport]').forEach(b => b.onclick = () => {
    homeSport = b.dataset.sport;
    app.querySelectorAll('[data-sport]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    app.querySelector('.logo-row').innerHTML = homeLogos();
    app.querySelector('.topbar.plain .topbar-in').innerHTML = brandHtml();
  });
  createForm.onsubmit = e => {
    e.preventDefault();
    socket.emit('create', { name: cName.value, sport: homeSport }, res => res.ok ? save(res) : (cErr.textContent = res.error));
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
        <h1>Set up the auction</h1>
        <p class="muted">${isHost() ? `Pick the auction mode, then everyone claims a ${TEAM_WORD()}.` : `The host picks the auction mode. Claim your ${TEAM_WORD()} below.`}</p>
      </div>
    </div>
    <div class="lobby">
      <div class="lobby-main">
      <div class="section-head"><h2>Auction mode</h2>${isHost() ? '' : '<span class="muted small">Chosen by the host</span>'}</div>
      ${modePicker()}
      <div class="section-head"><h2>Choose your ${TEAM_WORD()}</h2><span class="pill">${claimed}/${Math.min(state.teams.length, r.maxMembers)} claimed</span></div>
      ${teamPicker(mine)}
      </div>
      <aside class="side">
        <section class="card invite-card">
          <div class="card-head"><h2>Invite friends</h2><span class="muted small">${r.maxMembers - state.members.length} spots left</span></div>
          <div class="pad">
            <div class="invite-link" title="${esc(inviteUrl())}">${esc(inviteUrl().replace(/^https?:\/\//, ''))}</div>
            <div class="invite-actions">
              <button class="btn sm primary" data-act="copy">${ICON.copy}Copy link</button>
              <a class="btn sm" href="https://wa.me/?text=${encodeURIComponent(inviteText())}" target="_blank" rel="noopener">WhatsApp</a>
              ${navigator.share ? `<button class="btn sm" data-act="share">${ICON.share}Share</button>` : ''}
            </div>
            <p class="hint">Friends who open the link just type their name to join.</p>
          </div>
        </section>
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
            <div><dt>Mode</dt><dd>${esc(meta.modes[state.mode].name)}</dd></div>
            <div><dt>Players in pool</dt><dd>${meta.modes[state.mode].size}</dd></div>
            <div><dt>Purse</dt><dd class="purse-dd">${purseSummary()}${isHost() ? '<button class="link accent" data-act="purses">Edit</button>' : ''}</dd></div>
            <div><dt>Squad size</dt><dd>Up to ${r.maxSquad}</dd></div>
            ${hasOverseas() ? `<div><dt>Overseas</dt><dd>Up to ${r.maxOverseas}</dd></div>` : ''}
            ${meta.modes[state.mode].rtm ? `<div class="stack"><dt>Right to Match <span class="muted small">cards per team</span></dt><dd>${rtmControl()}</dd></div>` : ''}
            <div class="stack"><dt>Bid timer</dt><dd>${timerControl(false)}</dd></div>
          </dl>
          ${isHost()
            ? `<button class="btn primary block" data-act="start" ${claimed ? '' : 'disabled'}>Start auction</button>
               ${claimed ? '' : '<p class="hint">At least one team must be claimed to start.</p>'}
               ${claimed && !mine ? '<p class="hint warn">You haven’t picked a team yourself. Pick one if you want to bid.</p>' : ''}`
            : '<p class="hint center">Waiting for the host to start the auction…</p>'}
        </section>
        ${activityCard()}
      </aside>
    </div>
  </main>`;
}

// Team cards; football clubs are grouped by country.
function teamPicker(mine) {
  const card = t => {
    const taken = t.owner && t.id !== mine;
    const status = t.id === mine ? 'Your team' : t.owner ? esc(t.owner) : 'Available';
    return `<button class="team-card ${t.id === mine ? 'mine' : ''}" style="${teamVars(t)}"
      data-act="pick" data-team="${t.id}" ${taken ? 'disabled' : ''} title="${t.id === mine ? 'Tap to release' : esc(t.name)}">
      ${badge(t, 'md')}
      <span class="tc-text"><strong>${esc(t.name)}</strong><span class="tc-status ${t.owner ? 'taken' : ''}">${status}</span>
        ${t.squad.length ? `<span class="tc-kept">${t.squad.length} retained · ${fmt(t.purse)} left</span>` : ''}</span>
    </button>`;
  };
  const leagues = [...new Set(state.teams.map(t => t.league).filter(Boolean))];
  if (!leagues.length) return `<section class="team-grid">${state.teams.map(card).join('')}</section>`;
  return leagues.map(l => `<div class="league">
    <h3 class="league-name">${esc(l)}</h3>
    <section class="team-grid compact">${state.teams.filter(t => t.league === l).map(card).join('')}</section>
  </div>`).join('');
}

function modePicker() {
  const host = isHost();
  return `<section class="modes">
    ${Object.entries(meta.modes).filter(([, m]) => m.sport === state.sport).map(([k, m]) => `<button class="mode-card ${state.mode === k ? 'on' : ''}" data-act="mode" data-mode="${k}"
        ${host ? '' : 'disabled'} aria-pressed="${state.mode === k}">
      <span class="mode-icon" aria-hidden="true">${MODE_ICON[k] || '🏏'}</span>
      <span class="mode-text">
        <strong>${esc(m.name)}</strong>
        <span class="mode-desc">${esc(m.desc)}</span>
        <span class="mode-facts">${m.size} players · ${m.retentions ? 'real retentions' : `${fmt(m.purse)} purse`} · ${m.maxSquad}-player squads</span>
      </span>
    </button>`).join('')}
  </section>`;
}

// ---------- activity feed + chat ----------
const FEED_ICON = { bid: '↑', sold: '✓', unsold: '✕', join: '+', team: '★', host: '•', info: '•', rtm: '⇄' };
function feedItem(l) {
  const t = l.teamId && team(l.teamId);
  const time = new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (l.kind === 'chat') {
    return `<li class="chat ${l.memberId === session?.memberId ? 'mine' : ''}" title="${time}">
      <span class="chat-who">${t ? badge(t, 'xs') : ''}${esc(l.name)}</span><span class="chat-msg">${esc(l.text)}</span></li>`;
  }
  return `<li class="ev ${l.kind}" title="${time}"><span class="ic">${FEED_ICON[l.kind] || '•'}</span>
    ${t && (l.kind === 'bid' || l.kind === 'sold' || l.kind === 'team') ? badge(t, 'xs') : ''}<span>${esc(l.text)}</span></li>`;
}

function activityCard() {
  const items = state.log.filter(l => feedFilter === 'all' || l.kind === 'chat');
  const chats = state.log.filter(l => l.kind === 'chat').length;
  return `<section class="card activity">
    <div class="card-head"><h2>Activity</h2>
      <div class="seg sm" role="group" aria-label="Filter activity">
        <button class="${feedFilter === 'all' ? 'on' : ''}" data-act="feed" data-f="all">All</button>
        <button class="${feedFilter === 'chat' ? 'on' : ''}" data-act="feed" data-f="chat">Chat${chats ? ` (${chats})` : ''}</button>
      </div>
    </div>
    <ul class="feed" id="feed">${items.length ? items.map(feedItem).join('') : `<li class="empty">${feedFilter === 'chat' ? 'No messages yet. Say hi!' : 'Nothing yet.'}</li>`}</ul>
    <form class="chat-form" id="chatForm" autocomplete="off">
      <input id="chatInput" maxlength="200" placeholder="Message the room…" aria-label="Chat message" />
      <button class="btn sm primary" type="submit">Send</button>
    </form>
  </section>`;
}

// Shown on the auction board to anyone without a team, so late joiners can still play.
function joinStrip() {
  const free = state.teams.filter(t => !t.owner);
  return `<div class="join-strip">
    <div><strong>You don’t have a team yet</strong>
    <p class="muted small">${free.length ? `Pick a free ${TEAM_WORD()} to start bidding with its purse.` : `Every ${TEAM_WORD()} is taken, so you’re watching this one.`}</p></div>
    ${free.length ? `<div class="join-teams">${free.map(t => `<button class="join-team" data-act="pick" data-team="${t.id}" title="${esc(t.name)}">${badge(t, 'sm')}<span>${esc(t.id)}</span></button>`).join('')}</div>` : ''}
  </div>`;
}

// ---------- Right to Match ----------
// The team whose decision it is right now.
const rtmDecider = s => (s.rtm.step === 'raise' ? s.rtm.winner : s.rtm.team);

// The team that could use RTM on this player: its previous team, owned by someone, with cards left.
function rtmHolder(p) {
  if (!state.rules.rtmCards || !p.prevTeam) return null;
  const t = team(p.prevTeam);
  return t && t.owner && t.rtmLeft > 0 ? t : null;
}

function rtmControl() {
  const r = state.rules;
  if (!isHost()) return `<span class="value">${r.rtmCards ? `${r.rtmCards} per team` : 'Off'}</span>`;
  return `<div class="seg" role="group" aria-label="Right to Match cards">
    ${r.rtmOptions.map(n => `<button class="${n === r.rtmCards ? 'on' : ''}" data-act="rtmcards" data-n="${n}" aria-pressed="${n === r.rtmCards}">${n || 'Off'}</button>`).join('')}
  </div>`;
}

// Bid steps, matching the server: used for the final-raise buttons.
const stepFrom = l => (isFootball() ? (l < 20 ? 1 : l < 50 ? 2 : l < 100 ? 5 : 10) : (l < 100 ? 5 : l < 200 ? 10 : l < 500 ? 20 : 25));
function raiseOptions(price, purse) {
  const out = [];
  let v = price;
  for (const n of [1, 2, 3, 5, 10]) {
    while (out.length < n) { v += stepFrom(v); out.push(v); }
  }
  return [1, 3, 5, 10].map(n => out[n - 1]).filter(a => a <= purse);
}

function rtmPanel() {
  const r = state.rtm, prev = team(r.team), win = team(r.winner), mine = me()?.teamId;
  const lot = state.lot.name;
  let title, body, actions = '';
  if (r.step === 'offer') {
    title = `${prev.name} can use Right to Match`;
    body = `${esc(lot)} played for ${esc(r.team)} last season. ${esc(r.winner)} won the bidding at <b>${fmt(r.price)}</b>.`;
    if (mine === r.team) actions = `<button class="btn primary" data-act="rtm" data-a="use">Use RTM at ${fmt(r.price)}</button>
      <button class="btn" data-act="rtm" data-a="decline">Decline</button>`;
  } else if (r.step === 'raise') {
    title = `${win.name} gets one final raise`;
    body = `${esc(r.team)} used RTM at <b>${fmt(r.price)}</b>. ${esc(r.winner)} can raise once, or let ${esc(r.team)} have ${esc(lot)}.`;
    if (mine === r.winner) {
      const opts = raiseOptions(r.price, win.purse);
      actions = `${opts.map(a => `<button class="btn primary" data-act="rtm" data-a="raise" data-amt="${a}">Raise to ${fmt(a)}</button>`).join('')}
        <button class="btn" data-act="rtm" data-a="noraise">No raise</button>`;
    }
  } else {
    title = `${prev.name} can match ${fmt(r.price)}`;
    body = `${esc(r.winner)} raised to <b>${fmt(r.price)}</b>. ${esc(r.team)} can match and take ${esc(lot)}, or let it go.`;
    if (mine === r.team) actions = `<button class="btn primary" data-act="rtm" data-a="match">Match ${fmt(r.price)}</button>
      <button class="btn" data-act="rtm" data-a="decline">Decline</button>`;
  }
  const waiting = team(rtmDecider(state));
  return `<div class="rtm-panel" style="${teamVars(prev)}">
    <div class="rtm-head">${badge(prev, 'sm')}<span class="rtm-label">Right to Match</span><span class="muted small">${esc(r.team)} has ${prev.rtmLeft} card${prev.rtmLeft === 1 ? '' : 's'} left</span></div>
    <strong class="rtm-title">${esc(title)}</strong>
    <p class="muted small">${body}</p>
    ${actions ? `<div class="rtm-actions">${actions}</div>` : `<p class="hint">Waiting for ${esc(waiting.name)}…</p>`}
  </div>`;
}

function bidState() {
  const m = me(), t = m?.teamId && team(m.teamId);
  if (!t) return { ok: false, hint: `Pick a free ${TEAM_WORD()} to start bidding.` };
  if (state.paused) return { ok: false, hint: 'The host has paused the auction.' };
  if (state.status === 'rtm') return { ok: false, hint: 'Right to Match in progress.' };
  if (state.status !== 'live') return { ok: false, hint: 'Next player coming up…' };
  if (state.leader === t.id) return { ok: false, hint: 'You hold the highest bid.' };
  if (t.purse < state.nextBid) return { ok: false, hint: 'Not enough left in your purse.' };
  if (t.squad.length >= state.rules.maxSquad) return { ok: false, hint: 'Your squad is full.' };
  if (hasOverseas() && state.lot.overseas && t.squad.filter(p => p.overseas).length >= state.rules.maxOverseas) return { ok: false, hint: 'You’ve reached the overseas limit.' };
  return { ok: true, hint: `${fmt(t.purse)} left · press Space to bid` };
}

function auctionView() {
  if (view === 'squads') return squadsPage(false);
  if (view === 'xi') return xiPage();
  if (view === 'xi-edit') return xiEditPage();
  if (view === 'summary') return summaryPage();
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
              <span class="pill live"><span class="live-dot"></span>${esc(lot.set || 'Auction')}</span>
              <span class="muted small">${state.remaining} players left</span>
            </div>
            <h1 class="lot-name">${esc(lot.name)}</h1>
            <div class="tags">
              <span class="tag">${ROLE[lot.role]}</span>
              ${lot.position ? `<span class="tag">${esc(lot.position)}</span><span class="tag rating-tag">★ ${lot.rating ?? '–'}</span>` : ''}
              ${lot.country ? `<span class="tag ${lot.overseas ? 'os' : ''}">${esc(lot.country)}${lot.overseas ? ' · Overseas' : ''}</span>` : ''}
              ${lot.capped === false ? '<span class="tag">Uncapped</span>' : ''}
              ${lot.prevTeam ? `<span class="tag">Last IPL team: ${esc(lot.prevTeam)}</span>` : ''}
              ${rtmHolder(lot) ? `<span class="tag rtm-chip" title="${esc(rtmHolder(lot).id)} can use Right to Match on this player">RTM: ${esc(rtmHolder(lot).id)}</span>` : ''}
            </div>
            <dl class="lot-stats">
              <div><dt>Base price</dt><dd>${fmt(lot.base)}</dd></div>
              ${lotStats(lot)}
            </dl>
          </div>
        </article>

        <article class="card bid-card" id="bidCard">
          ${state.paused ? '<div class="banner paused">Auction paused by the host</div>' : ''}
          ${r ? (r.sold
            ? `<div class="banner sold" style="${teamVars(soldTo)}">${badge(soldTo, 'sm')}<span><b>Sold</b> to ${esc(soldTo.name)}${r.rtm ? ' <span class="rtm-tag">using RTM</span>' : ''}</span><b class="banner-amt">${fmt(r.price)}</b></div>`
            : '<div class="banner unsold"><b>Unsold</b><span>No bids. The player goes to the unsold list.</span></div>') : ''}
          <div class="bid-main">
            <div class="bid-info">
              <span class="label">${state.bid == null ? 'Opening bid' : 'Current bid'}</span>
              <div class="amount ${bump ? 'bump' : ''}">${state.bid == null ? fmt(lot.base) : fmt(state.bid)}</div>
              <div class="leader">${lead ? `${badge(lead, 'xs')}<span><b>${esc(lead.name)}</b> leading</span>` : '<span class="muted">No bids yet</span>'}</div>
            </div>
            <div class="clock" id="clock" role="timer" aria-label="Seconds left"><span id="clockNum"></span><small>sec</small></div>
          </div>
          ${state.status === 'rtm' ? rtmPanel() : me()?.teamId ? `
            <button class="bid-btn" data-act="bid" ${b.ok ? '' : 'disabled'}>Bid ${fmt(state.nextBid)}</button>
            <p class="bid-hint">${esc(b.hint)}</p>`
          : joinStrip()}
          ${isHost() ? `<div class="host-bar">
            <span class="host-label">Host</span>
            <button class="btn sm" data-act="pause">${state.paused ? 'Resume' : 'Pause'}</button>
            <button class="btn sm" data-act="skip" ${state.status === 'live' || state.status === 'rtm' ? '' : 'disabled'}>${state.status === 'rtm' ? 'Skip RTM' : 'Close lot'}</button>
            <button class="btn sm danger" data-act="end">End auction</button>
            <span class="host-timer"><span class="muted small">Timer</span>${timerControl(true)}</span>
          </div>` : ''}
        </article>
        ` : '<article class="card empty-state">Loading next player…</article>'}
        ${auctionBoard()}
      </section>

      <aside class="side">
        ${teamsCard()}
        ${activityCard()}
      </aside>
    </div>
  </main>`;
  updateClock();
}

// IPL career numbers from the player lists: batting for batters, bowling for bowlers, a mix for all-rounders.
function lotStats(p) {
  const s = p.stats;
  if (p.position) return `<div><dt>Position</dt><dd>${esc(p.position)}</dd></div><div><dt>Rating</dt><dd>${p.rating ?? '–'}</dd></div>`;
  if (!s) return `<div><dt>Role</dt><dd>${ROLE[p.role]}</dd></div><div><dt>Nationality</dt><dd>${p.overseas ? 'Overseas' : 'Indian'}</dd></div>`;
  const items = [];
  if (s.m != null) items.push(['IPL matches', s.m]);
  const bowl = s.wkts != null && (p.role === 'BOWL' || s.runs == null);
  if (bowl) {
    items.push(['Wickets', s.wkts]);
    if (s.econ != null) items.push(['Economy', s.econ]);
    if (s.best) items.push(['Best', s.best]);
  } else {
    if (s.runs != null) items.push(['Runs', s.runs]);
    if (s.sr != null) items.push(['Strike rate', s.sr]);
    if (p.role === 'AR' && s.wkts != null) items.push(['Wickets', s.wkts]);
    else if (s.avg != null) items.push(['Average', s.avg]);
    else if (s.hs) items.push(['Highest', s.hs]);
  }
  if (items.length === 1) items.push(['Role', ROLE[p.role]]);
  return items.slice(0, 3).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
}

// "₹120 cr" when every team has the same purse, otherwise a note that it varies.
function purseSummary() {
  const purses = state.teams.map(t => t.purse);
  return purses.every(p => p === purses[0]) ? fmt(purses[0]) : 'Varies by team';
}

// ---------- purse editor (host) ----------
// Lives outside #app so state updates don't wipe what the host is typing.
function openPurseEditor() {
  const modal = document.getElementById('modal');
  // Cricket purses are edited in crore (stored as lakhs); football in €M as stored.
  const fb = isFootball();
  const U = fb ? { factor: 1, max: 10000, step: 1, pre: '€', post: 'M', unit: '€M', chips: [500, 750, 1000, 1500], eg: 1000 }
               : { factor: 100, max: 1000, step: 0.05, pre: '₹', post: 'cr', unit: 'crore', chips: [80, 100, 120, 150], eg: 120 };
  const cr = l => +(l / U.factor).toFixed(2);
  // 50 football clubs is too many to list; only clubs someone owns matter there.
  const teams = fb ? state.teams.filter(t => t.owner) : state.teams;
  modal.innerHTML = `<div class="sheet-backdrop" id="purseSheet">
    <section class="sheet wide" role="dialog" aria-modal="true" aria-labelledby="purseTitle">
      <button class="icon-btn sm sheet-close" data-close type="button" aria-label="Close">✕</button>
      <h2 id="purseTitle">Edit purses</h2>
      <p class="muted small">Amounts in ${U.unit}. ${state.phase === 'auction' ? 'Changes apply straight away and are shown in the activity feed. Money already spent stays spent.' : 'Applies to this auction only.'}</p>
      <div class="purse-all">
        <label for="pAll">Set every team to</label>
        <div class="purse-all-row">
          <input id="pAll" type="number" min="0" max="${U.max}" step="${U.step}" inputmode="decimal" placeholder="e.g. ${U.eg}" />
          <button class="btn sm" type="button" id="pAllBtn">Fill all</button>
        </div>
        <div class="purse-chips">${U.chips.map(v => `<button class="chip" type="button" data-v="${v}">${U.pre}${v}${fb ? 'M' : ' cr'}</button>`).join('')}</div>
      </div>
      <div class="purse-list">
        ${teams.length ? '' : `<p class="empty">No ${TEAM_WORD()}s claimed yet.</p>`}
        ${teams.map(t => `<label class="purse-row">
          ${badge(t, 'sm')}
          <span class="pr-name"><b>${esc(t.name)}</b><span class="muted small">${t.owner ? esc(t.owner) : 'No owner'}${t.squad.length ? ` · ${t.squad.length} players` : ''}</span></span>
          <span class="pr-input"><span class="muted">${U.pre}</span><input type="number" min="0" max="${U.max}" step="${U.step}" inputmode="decimal" data-team="${t.id}" value="${cr(t.purse)}" aria-label="${esc(t.name)} purse in ${U.unit}" /><span class="muted">${U.post}</span></span>
        </label>`).join('')}
      </div>
      <div class="error" id="pErr"></div>
      <div class="xi-actions"><button class="btn primary" type="button" id="pSave">Save purses</button><button class="btn" type="button" data-close>Cancel</button></div>
    </section>
  </div>`;
  const sheet = document.getElementById('purseSheet');
  const inputs = [...sheet.querySelectorAll('input[data-team]')];
  const fillAll = v => { if (v === '' || isNaN(v)) return; inputs.forEach(i => (i.value = v)); pAll.value = v; };
  const close = () => { document.removeEventListener('keydown', onKey); sheet.classList.add('closing'); setTimeout(() => (modal.innerHTML = ''), 200); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  sheet.addEventListener('click', e => {
    if (e.target === sheet || e.target.closest('[data-close]')) return close();
    const chip = e.target.closest('[data-v]'); if (chip) fillAll(chip.dataset.v);
  });
  pAllBtn.onclick = () => fillAll(pAll.value);
  pAll.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); fillAll(pAll.value); } };
  pSave.onclick = () => {
    const purses = {};
    for (const i of inputs) {
      if (i.value === '') continue;
      const v = Number(i.value);
      if (!(v >= 0 && v <= U.max)) return (pErr.textContent = `Each purse must be between ${U.pre}0 and ${U.pre}${U.max}${fb ? 'M' : ' cr'}.`);
      purses[i.dataset.team] = Math.round(v * U.factor);
    }
    socket.emit('setPurses', { purses }, res => {
      if (!res?.ok) return (pErr.textContent = res?.error || 'Could not save purses.');
      close(); toast('Purses updated.');
    });
  };
  setTimeout(() => pAll.focus(), 200);
}

// ---------- teams panel (tap a team to see its squad by role) ----------
function squadGroups(t) {
  if (!t.squad.length) return '<p class="sg-empty">No players bought yet.</p>';
  return roleGroups().map(([role, label]) => {
    const ps = t.squad.filter(p => p.role === role).sort((a, b) => b.price - a.price);
    return `<div class="sg">
      <div class="sg-head"><span>${label}</span><span>${ps.length}</span></div>
      ${ps.length ? ps.map(p => `<div class="sg-row"><span>${esc(p.name)}${p.overseas ? '<span class="os-mark" title="Overseas">OS</span>' : ''}${p.retained ? '<span class="os-mark rt" title="Retained">R</span>' : ''}${p.rtm ? '<span class="os-mark rtm" title="Bought using Right to Match">RTM</span>' : ''}</span><b>${fmt(p.price)}</b></div>`).join('')
        : '<div class="sg-row none">None yet</div>'}
    </div>`;
  }).join('');
}

function teamsCard() {
  const r = state.rules;
  return `<section class="card">
    <div class="card-head"><h2>Teams</h2>
      <div class="head-links">${isHost() ? '<button class="link accent" data-act="purses">Edit purses</button>' : ''}<button class="link" data-act="squads">Squads</button><button class="link" data-act="xi">${XI()}s</button></div>
    </div>
    <ul class="purses">
      ${state.teams.filter(t => t.owner).map(t => {
        const open = openTeams.has(t.id);
        return `<li class="${t.id === state.leader ? 'lead' : ''} ${open ? 'open' : ''}" style="${teamVars(t)}">
          <button class="p-row" data-act="tteam" data-team="${t.id}" aria-expanded="${open}">
            ${badge(t, 'sm')}
            <div class="p-info">
              <div class="p-top"><span class="p-name">${esc(t.owner)} <span class="muted">· ${esc(t.id)}</span>${state.rules.rtmCards ? `<span class="rtm-count" title="Right to Match cards left">RTM ${t.rtmLeft}</span>` : ''}</span><span class="money">${fmt(t.purse)}</span></div>
              <div class="meter"><span style="width:${(t.purse / (t.startPurse || 1)) * 100}%"></span></div>
              <div class="p-sub">${t.squad.length}/${r.maxSquad} players${hasOverseas() ? ` · ${t.squad.filter(p => p.overseas).length}/${r.maxOverseas} overseas` : ''}</div>
            </div>
            <span class="chev" aria-hidden="true">${ICON.back}</span>
          </button>
          ${open ? `<div class="squad-groups">${squadGroups(t)}</div>` : ''}
        </li>`;
      }).join('')}
    </ul>
  </section>`;
}

// ---------- auction board: upcoming / sold / unsold / leaderboard ----------
function miniPlayer(p, right) {
  return `<li class="mp">${avatar(p, 'sm')}
    <span class="r-name">${esc(p.name)}<span class="r-sub">${playerSub(p)}</span></span>
    ${right}</li>`;
}

function boardBody() {
  if (boardTab === 'upcoming') {
    if (!state.upcoming.length) return '<p class="empty">No players left in the queue.</p>';
    let budget = showAllUpcoming ? Infinity : 30, shown = 0;
    const html = state.upcoming.map(s => {
      if (budget <= 0) return '';
      const ids = s.ids.slice(0, budget); budget -= ids.length; shown += ids.length;
      return `<div class="set-block">
        <div class="set-head"><span class="set-name">${esc(s.name)}</span><span class="muted small">${s.ids.length} players</span></div>
        <ul class="mp-grid">${ids.map(id => { const p = P(id); return p ? miniPlayer(p, `<b class="price">${fmt(p.base)}</b>`) : ''; }).join('')}</ul>
      </div>`;
    }).join('');
    return `<p class="board-note">Players come up set by set. The order inside each set is random.</p>${html}
      ${shown < state.remaining ? `<button class="btn sm block-sm" data-act="upall">Show all ${state.remaining} upcoming players</button>` : ''}`;
  }
  if (boardTab === 'sold') {
    if (!state.sold.length) return '<p class="empty">Nobody has been sold yet.</p>';
    return `<ul class="mp-list">${state.sold.slice().reverse().map(s => {
      const p = P(s.id), t = team(s.teamId);
      return p ? miniPlayer(p, `<span class="sold-to">${badge(t, 'xs')}${esc(t.id)}${s.rtm ? '<span class="os-mark rtm">RTM</span>' : ''}</span><b class="price">${fmt(s.price)}</b>`) : '';
    }).join('')}</ul>`;
  }
  if (boardTab === 'unsold') {
    if (!state.unsold.length) return '<p class="empty">No unsold players.</p>';
    const note = state.phase === 'auction' && !state.unsoldRound ? '<p class="board-note">Unsold players come back for a second round at the end.</p>' : '';
    return `${note}<ul class="mp-list">${state.unsold.map(id => { const p = P(id); return p ? miniPlayer(p, `<span class="muted small">Base ${fmt(p.base)}</span>`) : ''; }).join('')}</ul>`;
  }
  return leaderboard();
}

const avgRating = t => {
  const r = t.squad.filter(p => p.rating != null);
  return r.length ? (r.reduce((s, p) => s + p.rating, 0) / r.length).toFixed(1) : '–';
};

function leaderboard() {
  const teams = state.teams.filter(t => t.owner);
  if (!teams.length) return '<p class="empty">No teams yet.</p>';
  const value = t => t.squad.reduce((s, p) => s + p.price, 0);
  const ranked = teams.slice().sort((a, b) => value(b) - value(a) || b.squad.length - a.squad.length);
  const top = state.sold.slice().sort((a, b) => b.price - a.price).slice(0, 5);
  return `<table class="lb">
      <thead><tr><th>#</th><th>Team</th><th>Players</th><th>${hasOverseas() ? 'OS' : 'Avg rating'}</th><th>Squad value</th><th>Purse left</th></tr></thead>
      <tbody>${ranked.map((t, i) => `<tr class="${t.id === me()?.teamId ? 'me' : ''}">
        <td class="rank">${i + 1}</td>
        <td><span class="lb-team">${badge(t, 'xs')}<b>${esc(t.id)}</b><span class="muted">${esc(t.owner)}</span></span></td>
        <td>${t.squad.length}/${state.rules.maxSquad}</td>
        <td>${hasOverseas() ? t.squad.filter(p => p.overseas).length : avgRating(t)}</td>
        <td><b>${fmt(value(t))}</b></td>
        <td>${fmt(t.purse)}</td>
      </tr>`).join('')}</tbody>
    </table>
    ${top.length ? `<div class="set-head top-buys"><span class="set-name">Biggest buys</span></div>
      <ul class="mp-list">${top.map(s => { const p = P(s.id), t = team(s.teamId); return p ? miniPlayer(p, `<span class="sold-to">${badge(t, 'xs')}${esc(t.id)}</span><b class="price">${fmt(s.price)}</b>`) : ''; }).join('')}</ul>` : ''}`;
}

function auctionBoard() {
  const counts = { upcoming: state.remaining, sold: state.sold.length, unsold: state.unsold.length, leaders: state.teams.filter(t => t.owner).length };
  const tab = (k, label) => `<button class="${boardTab === k ? 'on' : ''}" data-act="btab" data-b="${k}">${label}<span class="cnt">${counts[k]}</span></button>`;
  return `<section class="card board-card">
    <div class="board-tabs seg">${tab('upcoming', 'Upcoming')}${tab('sold', 'Sold')}${tab('unsold', 'Unsold')}${tab('leaders', 'Leaderboard')}</div>
    <div class="board-body" id="boardBody">${boardBody()}</div>
  </section>`;
}

function updateClock() {
  const c = document.getElementById('clock'); if (!c || !state) return;
  const rtm = state.status === 'rtm';
  const t = Math.max(0, state.timeLeft), live = (state.status === 'live' || rtm) && !state.paused;
  c.style.setProperty('--p', (t / (rtm ? state.rules.rtmSeconds : state.rules.bidSeconds)) * 100);
  c.classList.toggle('urgent', live && t <= 3);
  c.classList.toggle('warn', live && t > 3 && t <= 5);
  document.getElementById('bidCard')?.classList.toggle('urgent', live && t <= 3);
  document.getElementById('clockNum').textContent = live || state.paused && (state.status === 'live' || rtm) ? t : '–';
}

function subNav() {
  const cur = view === 'board' ? 'squads' : view === 'xi-edit' ? 'xi' : view; // after the auction, 'board' shows squads
  const tab = (v, label) => `<button class="${cur === v ? 'on' : ''}" data-act="${v}">${label}</button>`;
  return `<nav class="subnav">
    ${state.phase === 'auction' ? `<button class="btn sm" data-act="board">${ICON.back}Back to auction</button>` : ''}
    <div class="seg">${tab('squads', 'Squads')}${tab('xi', `${XI()}s`)}${tab('summary', 'Summary')}</div>
  </nav>`;
}

function summaryPage() {
  app.innerHTML = `${topBar()}
  <main class="page">
    <div class="page-head"><div><h1>Auction summary</h1>
      <p class="muted">${esc(meta.modes[state.mode].name)} · ${state.sold.length} sold · ${state.unsold.length} unsold${state.phase === 'auction' ? ` · ${state.remaining} to go` : ''}</p></div></div>
    ${subNav()}
    <div class="summary">${auctionBoard()}${activityCard()}</div>
  </main>`;
}

const playerLine = p => `${avatar(p, 'sm')}<span class="r-name">${esc(p.name)}<span class="r-sub">${playerSub(p)}</span></span>`;

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
      <p class="muted">${final ? `The auction is complete. Pick your ${XI()} from the ${XI()}s tab.` : 'Updated live as players are sold.'}</p></div></div>
    ${subNav()}
    <div class="grid-cards">
      ${teams.map(t => `<section class="card team-card-lg">
          ${teamHead(t, t.id === mine && t.squad.length ? '<button class="btn sm" data-act="xi-edit">Pick XI</button>' : '')}
          <dl class="mini-stats">
            <div><dt>Players</dt><dd>${t.squad.length}</dd></div>
            <div><dt>${t.squad.some(p => p.retained) ? 'Spent at auction' : 'Spent'}</dt><dd>${fmt(t.startPurse - t.purse)}</dd></div>
            <div><dt>Left</dt><dd>${fmt(t.purse)}</dd></div>
          </dl>
          ${t.squad.length ? `<ul class="roster">${t.squad.slice().sort((a, b) => b.price - a.price).map(p =>
            `<li>${playerLine(p)}${p.retained ? '<span class="tag rt">Retained</span>' : ''}<b class="price">${fmt(p.price)}</b></li>`).join('')}</ul>`
            : '<p class="empty">No players bought yet.</p>'}
        </section>`).join('')}
    </div>
    ${final ? '<div class="page-foot"><button class="btn primary" data-act="leave">Start a new auction</button></div>' : ''}
  </main>`;
}

function resultsView() {
  if (view === 'xi') xiPage();
  else if (view === 'xi-edit') xiEditPage();
  else if (view === 'summary') summaryPage();
  else squadsPage(true);
}

// ---------- Playing XI ----------
const ROLE_ORDER = { WK: 0, BAT: 1, AR: 2, BOWL: 3, GK: 0, DEF: 1, MID: 2, FWD: 3 };
// Football has no Impact Player, so the slot is left out.
const impactSlot = p => (isFootball() ? '' : `<div class="impact"><span class="ip-tag">Impact Player</span>${p ? playerLine(p) : '<span class="muted small">Not chosen</span>'}</div>`);

function xiPage() {
  const mine = me()?.teamId;
  app.innerHTML = `${topBar()}
  <main class="page">
    <div class="page-head"><div><h1>${XI()}s</h1><p class="muted">${isFootball() ? 'Each owner names a starting 11, goalkeeper first.' : 'Each owner names 11 players in batting order plus one Impact Player.'}</p></div></div>
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
  if (d.xi.length < r.xiSize) notes.push(`${r.xiSize - d.xi.length} more player${r.xiSize - d.xi.length === 1 ? '' : 's'} to pick.`);
  if (isFootball()) {
    const gks = xi.filter(p => p.role === 'GK').length;
    if (d.xi.length && !gks) notes.push('No goalkeeper in the XI.');
    if (gks > 1) notes.push('More than one goalkeeper in the XI.');
    if (d.xi.length === r.xiSize && xi.filter(p => p.role === 'DEF').length < 3) notes.push('Fewer than 3 defenders.');
    return { errors, notes, os };
  }
  if (os > r.xiMaxOverseas) errors.push(`Too many overseas players: ${os} picked, ${r.xiMaxOverseas} allowed including the Impact Player.`);
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
    <div class="page-head"><div><h1>Pick your ${XI()}</h1><p class="muted">${esc(t.name)} · ${isFootball() ? 'tap <b>XI</b> to add a player to your starting line-up.' : 'tap <b>XI</b> to add to the batting order, <b>Impact</b> for your Impact Player.'}</p></div></div>
    ${subNav()}
    <div class="xi-editor">
      <section class="card">
        <div class="card-head"><h2>Squad</h2><span class="muted small">${t.squad.length} players</span></div>
        ${t.squad.length ? `<ul class="roster pool">${pool.map(p => {
          const inXI = draft.xi.includes(p.id), isIP = draft.impact === p.id;
          return `<li class="${inXI || isIP ? 'picked' : ''}">${playerLine(p)}
            <button class="chip ${inXI ? 'on' : ''}" data-act="xi-toggle" data-id="${p.id}" aria-pressed="${inXI}">XI</button>
            ${isFootball() ? '' : `<button class="chip ip ${isIP ? 'on' : ''}" data-act="xi-impact" data-id="${p.id}" aria-pressed="${isIP}">Impact</button>`}
          </li>`;
        }).join('')}</ul>` : '<p class="empty">Buy some players first.</p>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>${isFootball() ? 'Line-up' : 'Batting order'}</h2>
          <span class="counts"><span>${draft.xi.length}/${r.xiSize}</span>${isFootball() ? '' : `<span class="${os > r.xiMaxOverseas ? 'bad' : ''}">${os}/${r.xiMaxOverseas} overseas</span>`}</span>
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
    const url = inviteUrl();
    navigator.clipboard?.writeText(url).then(() => toast('Invite link copied. Send it to your friends.'), () => toast(url));
  }
  else if (act === 'share') navigator.share?.({ title: 'IPL Auction Room', text: 'Join my IPL auction! Tap the link and enter your name.', url: inviteUrl() }).catch(() => {});
  else if (act === 'sound') { sfx.toggle(); render(true); toast(sfx.on ? 'Sounds on' : 'Sounds off'); }
  else if (act === 'timer') socket.emit('setTimer', { seconds: Number(el.dataset.s) });
  else if (act === 'leave') { socket.emit('leave'); save(null); state = null; view = 'board'; draft = null; history.replaceState(null, '', '/'); render(true); }
  else if (['squads', 'board', 'xi', 'xi-edit', 'summary'].includes(act)) { view = act; draft = null; render(true); scrollTo(0, 0); }
  else if (act === 'mode') socket.emit('setMode', { mode: el.dataset.mode });
  else if (act === 'rtm') socket.emit('rtm', { action: el.dataset.a, amount: el.dataset.amt ? Number(el.dataset.amt) : undefined });
  else if (act === 'rtmcards') socket.emit('setRtm', { cards: Number(el.dataset.n) });
  else if (act === 'purses') openPurseEditor();
  else if (act === 'btab') { boardTab = el.dataset.b; render(true); }
  else if (act === 'upall') { showAllUpcoming = true; render(true); }
  else if (act === 'feed') { feedFilter = el.dataset.f; render(true); }
  else if (act === 'tteam') { openTeams.has(el.dataset.team) ? openTeams.delete(el.dataset.team) : openTeams.add(el.dataset.team); render(true); }
  else if (['xi-toggle', 'xi-impact', 'xi-up', 'xi-down'].includes(act)) editXI(act, Number(el.dataset.id));
  else if (act === 'xi-cancel') { view = 'xi'; draft = null; render(true); }
  else if (act === 'xi-save') {
    socket.emit('setXI', draft, res => {
      if (!res?.ok) return toast(res?.error || 'Could not save your XI.');
      toast(`${XI()} announced.`); view = 'xi'; draft = null; render(true);
    });
  }
  else socket.emit(act); // start, bid, pause, skip, end
});

// Chat
app.addEventListener('submit', e => {
  if (e.target.id !== 'chatForm') return;
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  input.value = '';
});

// Spacebar bids during the auction
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && state?.phase === 'auction' && view === 'board' && !['INPUT', 'BUTTON'].includes(document.activeElement.tagName)) {
    e.preventDefault(); if (bidState().ok) socket.emit('bid');
  }
});
