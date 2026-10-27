// Edit freely: teams, auction modes and shared rules live here; player lists are in players.js.
// Prices are in lakhs (100 lakhs = 1 crore).

// Purse, squad size and overseas limit come from the auction mode (MODES below).
const RULES = {
  maxMembers: 10,    // people allowed in one room
  bidSeconds: 10,    // default countdown; it resets to this on every bid
  timerOptions: [5, 8, 10, 15, 20, 30], // countdowns the host can choose
  rtmOptions: [0, 1, 2, 3, 4, 5, 6], // Right to Match cards per team the host can choose
  rtmSeconds: 15,    // time for each Right to Match decision
  breakSeconds: 3,   // pause between lots
  xiSize: 11,        // Playing XI
  xiMaxOverseas: 4   // overseas allowed in the XI, counting the Impact Player
};

// Logos are the teams' own trademarks, loaded from Wikipedia. Swap a URL for a file in public/ if you like.
const W = 'https://thumb.wikimedia.org/wikipedia/en/thumb/';
const TEAMS = [
  { id: 'CSK',  name: 'Chennai Super Kings',         color: '#F9CD05', alt: '#0081E9',
    logo: W + '2/2b/Chennai_Super_Kings_Logo.svg/330px-Chennai_Super_Kings_Logo.svg.png' },
  { id: 'MI',   name: 'Mumbai Indians',              color: '#004BA0', alt: '#D1AB3E',
    logo: W + 'c/cd/Mumbai_Indians_Logo.svg/330px-Mumbai_Indians_Logo.svg.png' },
  { id: 'RCB',  name: 'Royal Challengers Bengaluru', color: '#EC1C24', alt: '#2B2A29',
    logo: W + 'd/d4/Royal_Challengers_Bengaluru_Logo.svg/330px-Royal_Challengers_Bengaluru_Logo.svg.png' },
  { id: 'KKR',  name: 'Kolkata Knight Riders',       color: '#3A225D', alt: '#D4AF37',
    logo: W + '4/4c/Kolkata_Knight_Riders_Logo.svg/330px-Kolkata_Knight_Riders_Logo.svg.png' },
  { id: 'SRH',  name: 'Sunrisers Hyderabad',         color: '#FF822A', alt: '#1A1A1A',
    logo: W + '5/51/Sunrisers_Hyderabad_Logo.svg/330px-Sunrisers_Hyderabad_Logo.svg.png' },
  { id: 'DC',   name: 'Delhi Capitals',              color: '#17479E', alt: '#EF1B23',
    logo: W + '2/2f/Delhi_Capitals.svg/330px-Delhi_Capitals.svg.png' },
  { id: 'RR',   name: 'Rajasthan Royals',            color: '#EA1A85', alt: '#254AA5',
    logo: W + '5/5c/This_is_the_logo_for_Rajasthan_Royals%2C_a_cricket_team_playing_in_the_Indian_Premier_League_%28IPL%29.svg/330px-This_is_the_logo_for_Rajasthan_Royals%2C_a_cricket_team_playing_in_the_Indian_Premier_League_%28IPL%29.svg.png' },
  { id: 'PBKS', name: 'Punjab Kings',                color: '#DD1F2D', alt: '#A7A9AC',
    logo: W + 'd/d4/Punjab_Kings_Logo.svg/330px-Punjab_Kings_Logo.svg.png' },
  { id: 'GT',   name: 'Gujarat Titans',              color: '#1B2133', alt: '#B1913D',
    logo: W + '0/09/Gujarat_Titans_Logo.svg/330px-Gujarat_Titans_Logo.svg.png' },
  { id: 'LSG',  name: 'Lucknow Super Giants',        color: '#00A0E3', alt: '#F28B00',
    logo: W + '3/34/Lucknow_Super_Giants_Logo.svg/330px-Lucknow_Super_Giants_Logo.svg.png' }
];

// ---------- players ----------
// Pools are loaded from the CSVs in data/ by players.js.
// Photos: photos.json lists each player's source image (from Wikipedia). Each one is downloaded once, cropped
// and shrunk into public/players/<name-slug>.jpg, and the game serves that local copy. Players without a local
// file show their initials. To use your own picture, save it as public/players/<name-slug>.jpg
// (e.g. virat-kohli.jpg) and add the player to photos.json.
const fs = require('fs');
const path = require('path');
const { MEGA, EXTRA, MOCK_POOL, RETENTIONS, LEGENDS, UPGRADED, FOOTBALL } = require('./players');
const { CLUBS } = require('./clubs');
let PHOTOS = {};
try { PHOTOS = require('./photos.json'); } catch {}

const slug = name => name.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const localPhoto = name => {
  const file = `${slug(name)}.jpg`;
  return fs.existsSync(path.join(__dirname, 'public', 'players', file)) ? `/players/${file}` : '';
};

// Short names in the legends list ("V Kohli", "RG Sharma") reuse a known player's photo when exactly one
// known player has the same surname, first initial and a compatible role, so "R Sharma" the leg-spinner
// never gets Rohit Sharma's face.
const norm = s => s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
const roleOf = new Map([...MEGA, ...UPGRADED].map(p => [norm(p.name), p.role]));
const compatible = (a, b) => a === b || a === 'AR' || b === 'AR' || (a !== 'BOWL' && b !== 'BOWL');
const photoKeys = Object.keys(PHOTOS).map(k => [k, norm(k).split(' ')]);
function photoName(name, role, fuzzy) {
  if (PHOTOS[name]) return name;
  if (!fuzzy) return '';
  const words = norm(name).split(' '), surname = words[words.length - 1];
  const exact = photoKeys.find(([, w]) => w.join(' ') === words.join(' '));
  if (exact) return exact[0];
  const hits = photoKeys.filter(([k, w]) => w[w.length - 1] === surname && w[0][0] === words[0][0]
    && (!roleOf.has(norm(k)) || compatible(roleOf.get(norm(k)), role)));
  return hits.length === 1 ? hits[0][0] : '';
}
const withPhoto = (p, fuzzy) => {
  const key = photoName(p.name, p.role, fuzzy);
  return { ...p, img: key ? localPhoto(key) : '' };
};

// One catalogue of every player the client may need to show, keyed by id.
// Football photos only match exact names, so a cricketer's photo never lands on a footballer.
// IPL career stats: the legends lists carry stats for many current players, so share them by name
// (full names first, then the legends list's short names by surname + initial + compatible role).
const hasCareer = s => s && (s.runs != null || s.wkts != null);
const statsByName = new Map(UPGRADED.filter(p => hasCareer(p.stats)).map(p => [norm(p.name), p.stats]));
const legendStats = LEGENDS.filter(p => hasCareer(p.stats)).map(p => [norm(p.name).split(' '), p]);
function careerStats(p) {
  if (hasCareer(p.stats)) return p.stats;
  const s = statsByName.get(norm(p.name));
  if (s) return s;
  const w = norm(p.name).split(' ');
  const hits = legendStats.filter(([lw, l]) => lw[lw.length - 1] === w[w.length - 1] && lw[0][0] === w[0][0] && compatible(l.role, p.role));
  return hits.length === 1 ? hits[0][1].stats : p.stats;
}
// Pace or spin, shared by name across lists the same way.
const typeByName = new Map();
[...MEGA, ...MOCK_POOL, ...UPGRADED].forEach(p => p.bowlType && typeByName.set(norm(p.name), p.bowlType));
const bowlTypeFor = p => p.bowlType || typeByName.get(norm(p.name)) || null;

const PLAYERS = [
  ...[...MEGA, ...EXTRA, ...LEGENDS, ...UPGRADED].map(p => withPhoto({ ...p, sport: 'cricket', stats: careerStats(p), bowlType: bowlTypeFor(p) }, true)),
  ...FOOTBALL.map(p => withPhoto({ ...p, sport: 'football' }, false))
];
const byId = new Map(PLAYERS.map(p => [p.id, p]));
// Pool entries keep their own set/price details but take photo, stats and pace/spin from the catalogue.
const fromCatalog = list => list.map(p => {
  const c = byId.get(p.id);
  return { ...c, ...p, img: c.img, stats: c.stats, bowlType: p.bowlType || c.bowlType, sport: c.sport };
});
for (const t of Object.values(RETENTIONS)) t.players = fromCatalog(t.players);

// ---------- sports ----------
// Money is stored as whole units: lakhs for cricket (100 = ₹1 cr), €M for football.
const SPORTS = {
  cricket: { name: 'Cricket', tag: 'IPL', teams: TEAMS, defaultMode: 'mega', purseStep: 5 },
  football: { name: 'Football', tag: 'Football', teams: CLUBS, defaultMode: 'football', purseStep: 1 }
};

// ---------- auction modes ----------
// purse: starting purse (in the sport's units), or null when it comes from the team's retentions.
// maxOverseas: null means no overseas limit.
const MODES = {
  mega: {
    sport: 'cricket',
    name: 'Mega Auction',
    rtm: 6, // Right to Match cards per team by default; uses each player's previous team from the list
    desc: 'The full IPL mega auction list, set by set. Build a 25-player squad.',
    purse: 12000, maxSquad: 25, maxOverseas: 8,
    pool: () => fromCatalog(MEGA)
  },
  legendsUpgraded: {
    sport: 'cricket',
    name: 'Legends Upgraded',
    desc: 'IPL greats from 2008 to today alongside current stars, with career stats.',
    purse: 12000, maxSquad: 25, maxOverseas: 8,
    pool: () => fromCatalog(UPGRADED)
  },
  legends: {
    sport: 'cricket',
    name: 'IPL Legends Auction',
    desc: 'Top batters and bowlers from IPL history, 2008–2025, with career stats.',
    purse: 12000, maxSquad: 25, maxOverseas: 8,
    pool: () => fromCatalog(LEGENDS)
  },
  mock: {
    sport: 'cricket',
    name: 'IPL 2026 Mock Auction',
    rtm: 0, // real mini auctions have no RTM, but the host can turn it on
    desc: 'Real 2026 retentions. Each team keeps its retained players and bids with the purse it has left.',
    purse: null, maxSquad: 25, maxOverseas: 8, retentions: RETENTIONS,
    pool: () => fromCatalog(MOCK_POOL)
  },
  football: {
    sport: 'football',
    name: 'Football Auction',
    desc: 'Top European players by position and rating. Build a squad of up to 25 with €1000M.',
    purse: 1000, maxSquad: 25, maxOverseas: null,
    pool: () => fromCatalog(FOOTBALL)
  }
};
for (const m of Object.values(MODES)) m.size = m.pool().length;

module.exports = { RULES, TEAMS, PLAYERS, MODES, SPORTS };
