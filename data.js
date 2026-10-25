// Edit freely: teams, auction modes and shared rules live here; player lists are in players.js.
// Prices are in lakhs (100 lakhs = 1 crore).

// Purse, squad size and overseas limit come from the auction mode (MODES below).
const RULES = {
  maxMembers: 10,    // people allowed in one room
  bidSeconds: 10,    // default countdown; it resets to this on every bid
  timerOptions: [5, 8, 10, 15, 20, 30], // countdowns the host can choose
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
// Pools are loaded from the CSVs in data/ by players.js. Photos come from photos.json (player name -> image URL,
// from Wikipedia); players missing there are looked up in the browser. To use your own picture, add or edit the
// entry in photos.json, e.g. "Virat Kohli": "/players/kohli.jpg" with the file in public/players/.
const { MEGA, EXTRA, MOCK_POOL, RETENTIONS, LEGENDS, UPGRADED } = require('./players');
let PHOTOS = {};
try { PHOTOS = require('./photos.json'); } catch {}

// Short names like "V Kohli" or "Mohammad Siraj" reuse a known photo when exactly one known player
// has the same surname and first initial.
const norm = s => s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
const photoKeys = Object.keys(PHOTOS).map(k => [k, norm(k).split(' ')]);
function photoFor(name) {
  if (PHOTOS[name]) return PHOTOS[name];
  const words = norm(name).split(' '), surname = words[words.length - 1];
  const exact = photoKeys.find(([, w]) => w.join(' ') === words.join(' '));
  if (exact) return PHOTOS[exact[0]];
  const hits = photoKeys.filter(([, w]) => w[w.length - 1] === surname && w[0][0] === words[0][0]);
  return hits.length === 1 ? PHOTOS[hits[0][0]] : '';
}
const withPhoto = p => ({ ...p, img: photoFor(p.name) });

// One catalogue of every player the client may need to show, keyed by id.
const PLAYERS = [...MEGA, ...EXTRA, ...LEGENDS, ...UPGRADED].map(withPhoto);
const byId = new Map(PLAYERS.map(p => [p.id, p]));
const fromCatalog = list => list.map(p => ({ ...byId.get(p.id), ...p, img: byId.get(p.id).img }));
for (const t of Object.values(RETENTIONS)) t.players = fromCatalog(t.players);

// ---------- auction modes ----------
// purse: starting purse in lakhs, or null when it comes from the team's retentions.
const MODES = {
  mega: {
    name: 'Mega Auction',
    desc: 'The full IPL mega auction list, set by set. Build a 25-player squad.',
    purse: 12000, maxSquad: 25, maxOverseas: 8,
    pool: () => fromCatalog(MEGA)
  },
  legendsUpgraded: {
    name: 'Legends Upgraded',
    desc: 'IPL greats from 2008 to today alongside current stars, with career stats.',
    purse: 12000, maxSquad: 25, maxOverseas: 8,
    pool: () => fromCatalog(UPGRADED)
  },
  legends: {
    name: 'IPL Legends Auction',
    desc: 'Top batters and bowlers from IPL history, 2008–2025, with career stats.',
    purse: 12000, maxSquad: 25, maxOverseas: 8,
    pool: () => fromCatalog(LEGENDS)
  },
  mock: {
    name: 'IPL 2026 Mock Auction',
    desc: 'Real 2026 retentions. Each team keeps its retained players and bids with the purse it has left.',
    purse: null, maxSquad: 25, maxOverseas: 8, retentions: RETENTIONS,
    pool: () => fromCatalog(MOCK_POOL)
  }
};
for (const m of Object.values(MODES)) m.size = m.pool().length;

module.exports = { RULES, TEAMS, PLAYERS, MODES };
