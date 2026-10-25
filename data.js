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
// Pools live in players.js. Photos come from photos.json (player name -> image URL, from Wikipedia);
// players missing there are looked up in the browser. To use your own picture, add or edit the entry
// in photos.json, e.g. "Virat Kohli": "/players/kohli.jpg" with the file in public/players/.
const { CURRENT, LEGENDS, ICONS } = require('./players');
let PHOTOS = {};
try { PHOTOS = require('./photos.json'); } catch {}

// One catalogue of every player. Ids are stable: current players from 1, legends from 1001.
const withMeta = (list, start) => list.map((p, i) => ({
  id: start + i, ...p, img: PHOTOS[p.name] || '', overseas: p.country !== 'IND'
}));
const CURRENT_P = withMeta(CURRENT, 1);
const LEGENDS_P = withMeta(LEGENDS, 1001);
const PLAYERS = [...CURRENT_P, ...LEGENDS_P];
const iconIds = new Set(CURRENT_P.filter(p => ICONS.includes(p.name)).map(p => p.id));

// ---------- auction modes ----------
// pool() returns the players for one auction; it runs when the auction starts, so random pools differ each time.
const MODES = {
  mega: {
    name: 'Mega Auction',
    desc: 'Every current IPL player goes under the hammer. Build a full squad.',
    purse: 12000, maxSquad: 25, maxOverseas: 8,
    pool: () => CURRENT_P
  },
  legendsUpgraded: {
    name: 'Legends Upgraded',
    desc: 'IPL greats from 2008 to today plus every current player.',
    purse: 12000, maxSquad: 25, maxOverseas: 8,
    pool: () => [...LEGENDS_P, ...CURRENT_P]
  },
  legends: {
    name: 'Legends Auction',
    desc: 'All-time IPL legends and modern icons only.',
    purse: 12000, maxSquad: 25, maxOverseas: 8,
    pool: () => [...LEGENDS_P, ...CURRENT_P.filter(p => iconIds.has(p.id))]
  },
  mini: {
    name: 'Mock Auction',
    desc: 'A quick mini auction: 90 random current players, smaller purse.',
    purse: 5000, maxSquad: 12, maxOverseas: 4,
    pool: () => [...CURRENT_P].sort(() => Math.random() - 0.5).slice(0, 90)
  }
};
// Player counts shown before the auction starts (the mini pool size is fixed).
for (const m of Object.values(MODES)) m.size = m === MODES.mini ? 90 : m.pool().length;

module.exports = { RULES, TEAMS, PLAYERS, MODES };
