// Player pools for every auction mode, loaded from the CSV files in data/.
// To change a list, edit or replace the CSV; the columns are the ones PlayAuction exports.
const fs = require('fs');
const path = require('path');

const ROLE = {
  'Batsman': 'BAT', 'Wicket-Keeper': 'WK', 'All-Rounder': 'AR', 'Bowler': 'BOWL',
  'Goalkeeper': 'GK', 'Defender': 'DEF', 'Midfielder': 'MID', 'Forward': 'FWD'
};
const COUNTRY = {
  India: 'IND', Australia: 'AUS', England: 'ENG', 'South Africa': 'SA', 'New Zealand': 'NZ', 'West Indies': 'WI',
  'Sri Lanka': 'SL', Afghanistan: 'AFG', Bangladesh: 'BAN', Pakistan: 'PAK', Netherlands: 'NED', Ireland: 'IRE', Zimbabwe: 'ZIM'
};

// Set codes in the CSVs (e.g. BA1, UFA2, OSB-1, ELITE_BAT) turned into readable names.
const SET_NAMES = {
  BA: 'Batters', AL: 'All-rounders', WK: 'Wicket-keepers', FA: 'Fast bowlers', SP: 'Spinners',
  UBA: 'Uncapped batters', UAL: 'Uncapped all-rounders', UWK: 'Uncapped wicket-keepers', UFA: 'Uncapped fast bowlers', USP: 'Uncapped spinners',
  MARQ: 'Marquee', IB: 'Indian batters', OSB: 'Overseas batters', IPA: 'Indian all-rounders', OPA: 'Overseas all-rounders',
  IW: 'Indian wicket-keepers', OWK: 'Overseas wicket-keepers', ISA: 'Indian spin all-rounders', OSA: 'Overseas spin all-rounders',
  IP: 'Indian pacers', OP: 'Overseas pacers', IS: 'Indian spinners', OSS: 'Overseas spinners',
  MEGA: 'Mega stars', ELITE_BAT: 'Elite batters', ELITE_WK: 'Elite wicket-keepers', ELITE_AR: 'Elite all-rounders',
  ELITE_BOWL: 'Elite bowlers', STAR_BAT: 'Star batters', STAR_AR: 'Star all-rounders', STAR_BOWL: 'Star bowlers',
  CLASSIC_BAT: 'Classic batters', CLASSIC_BOWL: 'Classic bowlers'
};
function setLabel(code) {
  const m = /^([A-Z_]+?)-?(\d*)$/.exec(code);
  if (!m || !SET_NAMES[m[1]]) return code; // already readable, e.g. "Marquee Set 1"
  return m[2] ? `${SET_NAMES[m[1]]} ${m[2]}` : SET_NAMES[m[1]];
}

// Pace or spin, when the set says so (FA = fast bowlers, SP = spinners, IP/OP = pacers, IS/OSS/ISA/OSA = spin).
function bowlTypeOf(code) {
  if (/^U?SP\d|^IS-|^OSS|^ISA-|^OSA-/.test(code)) return 'spin';
  if (/^U?FA\d|^IP-|^OP-/.test(code)) return 'pace';
  return null;
}

function readCsv(file) {
  const text = fs.readFileSync(path.join(__dirname, 'data', file), 'utf8').replace(/^﻿/, '').trim();
  const [head, ...rows] = text.split(/\r?\n/);
  const keys = head.split(',');
  return rows.filter(Boolean).map(line => Object.fromEntries(line.split(',').map((v, i) => [keys[i], v.trim()])));
}

const num = v => (v === '' || v == null ? null : Number(v));
function statsOf(r) {
  const s = {
    m: num(r.stat_matches), runs: num(r.stat_runs), avg: num(r.stat_average), sr: num(r.stat_strikeRate),
    hs: r.stat_highestScore || null, wkts: num(r.stat_wickets), econ: num(r.stat_economy), best: r.stat_bestFigures || null
  };
  Object.keys(s).forEach(k => s[k] == null && delete s[k]);
  return Object.keys(s).length ? s : null;
}

function toPlayer(r, id) {
  return {
    id, key: r.id, name: r.name, role: ROLE[r.role] || 'AR',
    country: COUNTRY[r.country] || r.country, overseas: r.isOverseas === 'true', capped: r.isCapped === 'true',
    base: Number(r.basePrice), set: setLabel(r.set), bowlType: bowlTypeOf(r.set), prevTeam: r.previousTeam || '', stats: statsOf(r),
    ...(r.position ? { position: r.position, rating: num(r.rating) } : {})
  };
}

// Ids: mega list 1–999, extra mock players 1000+, legends 2001+, legends upgraded 3001+, football 5001+.
const MEGA = readCsv('playauction_mega_auction.csv').map((r, i) => toPlayer(r, i + 1));
const byKey = new Map(MEGA.map(p => [p.key, p]));
const EXTRA = []; // players that appear in the mock files but not in the mega list
let nextExtra = 1000;
const lookup = r => byKey.get(r.id) || (() => { const p = toPlayer(r, nextExtra++); byKey.set(p.key, p); EXTRA.push(p); return p; })();

// IPL 2026 mock: the auction pool, plus each team's retained players, purse and slots.
const MOCK_POOL = readCsv('playauction_ipl2026_mock_auction.csv').map(r => {
  const p = lookup(r);
  return { ...p, set: setLabel(r.set), bowlType: p.bowlType || bowlTypeOf(r.set), prevTeam: r.previousTeam || '' };
});
const RETENTIONS = {};
readCsv('playauction_ipl2026_mock_retentions.csv').forEach(r => {
  const t = (RETENTIONS[r.team] ||= { purse: Number(r.purse_left), slots: Number(r.available_slots), overseasSlots: Number(r.overseas_slots), players: [] });
  t.players.push({ ...lookup({ ...r, set: 'Retained' }), price: Number(r.price), retained: true });
});

const LEGENDS = readCsv('playauction_ipl_legends_auction.csv').map((r, i) => toPlayer(r, 2001 + i));
const UPGRADED = readCsv('playauction_legends_upgraded.csv').map((r, i) => toPlayer(r, 3001 + i));

// Football: prices are in €M; country is "International" in the list, so it isn't shown.
const FOOTBALL = readCsv('playauction_football_auction.csv').map((r, i) => ({ ...toPlayer(r, 5001 + i), country: '' }));

module.exports = { MEGA, EXTRA, MOCK_POOL, RETENTIONS, LEGENDS, UPGRADED, FOOTBALL };
