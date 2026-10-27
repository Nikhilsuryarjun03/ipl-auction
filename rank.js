// Team rankings after the auction, from each team's Playing XI (cricket) or Starting XI (football).
// Every aspect is scored 0–100, then weighted into an overall score. Cricket ratings come from IPL career
// stats in the player lists; players without stats get an estimate from their base price and role.

const clamp01 = x => Math.max(0, Math.min(1, x));
const scale = (x, lo, hi) => clamp01((x - lo) / (hi - lo)); // 0 at lo, 1 at hi
const avgOf = (xs, slots) => (slots ? xs.slice(0, slots).concat(Array(Math.max(0, slots - xs.length)).fill(0)) : xs)
  .reduce((s, x, _, a) => s + x / a.length, 0);
const norm = s => s.normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toLowerCase().replace(/\./g, '').trim();

// ---------- cricket ----------
// The lists only say pace/spin for some sets, so well-known IPL spinners are named here.
// Other specialist bowlers count as pace.
const SPINNERS = [
  'Kuldeep Yadav', 'Yuzvendra Chahal', 'Rashid Khan', 'Ravi Bishnoi', 'Varun Chakravarthy', 'Axar Patel', 'Ravindra Jadeja',
  'Ravichandran Ashwin', 'Sunil Narine', 'Noor Ahmad', 'Washington Sundar', 'Krunal Pandya', 'Wanindu Hasaranga',
  'Maheesh Theekshana', 'Adam Zampa', 'Mitchell Santner', 'Piyush Chawla', 'Amit Mishra', 'Harbhajan Singh', 'Anil Kumble',
  'Muttiah Muralitharan', 'Shane Warne', 'Imran Tahir', 'Rahul Chahar', 'Karn Sharma', 'Mayank Markande', 'Suyash Sharma',
  'Shreyas Gopal', 'Sai Kishore', 'Allah Ghazanfar', 'Mujeeb Ur Rahman', 'Mujeeb Rahman', 'Glenn Maxwell', 'Shahbaz Ahmed',
  'Riyan Parag', 'Moeen Ali', 'Shakib Al Hasan', 'Liam Livingstone', 'Pragyan Ojha', 'Digvesh Rathi', 'Vignesh Puthur',
  'Zeeshan Ansari', 'Manav Suthar', 'Kumar Kartikeya', 'Kumar Kartikeya Singh', 'Harpreet Brar', 'Tanush Kotian',
  'Shahbaz Nadeem', 'Akeal Hosein', 'Mohammad Nabi', 'Yusuf Pathan', 'Deepak Hooda', 'Rahul Sharma', 'Murali Kartik',
  'Iqbal Abdulla', 'Shadab Jakati', 'Daniel Vettori', 'Samuel Badree', 'Ajantha Mendis', 'Ajanta Mendis', 'Brad Hogg',
  'Abhishek Sharma', 'Pravin Dubey', 'Jayant Yadav', 'Qais Ahmad', 'Rishad Hossain', 'Mohammad Waqar Salamkheil',
  'Viyaskanth Vijayakanth', 'Dunith Wellalage', 'Roston Chase', 'Liam Dawson', 'Rehan Ahmed', 'George Linde', 'Tom Moores',
  'Kamindu Mendis', 'Charith Asalanka', 'Raghu Sharma', 'Shivam Shukla', 'Prashant Solanki', 'Murugan Ashwin', 'J Suchith',
  'Jagadeesha Suchith', 'Krishnappa Gowtham', 'Parvez Rasool', 'Pawan Negi', 'Bipul Sharma', 'Ramesh Powar', 'KC Cariappa',
  'K.C. Cariappa', 'Johan Botha', 'Roelof van der Merwe', 'Mahipal Lomror', 'Sanvir Singh', 'Hrithik Shokeen', 'Hritik Shokeen'
].map(norm);
const spinSet = new Set(SPINNERS);
const spinShort = SPINNERS.map(n => n.split(' '));
function isSpinner(p) {
  const w = norm(p.name).split(' ');
  if (spinSet.has(w.join(' '))) return true;
  // short names in the legends list ("YS Chahal", "R Ashwin")
  return w[0].length <= 3 && spinShort.some(s => s[s.length - 1] === w[w.length - 1] && s[0][0] === w[0][0]);
}
const bowlTypeOf = p => p.bowlType || (isSpinner(p) ? 'spin' : p.role === 'BOWL' ? 'pace' : null);

// Players without career stats: estimate from base price (₹30 L ≈ 32, ₹2 cr+ ≈ 62).
const estimate = base => 30 + 32 * scale(base, 20, 200);

function batRating(p) {
  const s = p.stats;
  if (s && s.runs != null && s.m) {
    return 100 * (0.40 * scale(s.sr ?? 120, 110, 165) + 0.35 * scale(s.runs / s.m, 8, 36) + 0.25 * scale(s.runs, 0, 5000));
  }
  if (p.role === 'BOWL') return 12;
  return p.role === 'AR' ? estimate(p.base) * 0.85 : estimate(p.base);
}
function bowlRating(p) {
  const s = p.stats;
  if (s && s.wkts != null && s.m) {
    return 100 * (0.40 * scale(9.6 - (s.econ ?? 8.5), 0, 2.8) + 0.35 * scale(s.wkts / s.m, 0.5, 1.5) + 0.25 * scale(s.wkts, 0, 180));
  }
  if (p.role === 'BOWL') return estimate(p.base);
  if (p.role === 'AR') return estimate(p.base) * 0.8;
  return 0;
}

function cricketTeam(team) {
  const byId = new Map(team.squad.map(p => [p.id, p]));
  const xi = team.xi.xi.map(id => byId.get(id)).filter(Boolean);
  const impact = byId.get(team.xi.impact);
  const all = impact ? [...xi, impact] : xi;
  const bat = xi.map(batRating);
  const bowlers = all.map(p => ({ p, r: bowlRating(p) })).filter(b => b.r >= 20).sort((a, b) => b.r - a.r);
  const batters = all.filter(p => batRating(p) >= 35);
  const types = bowlers.map(b => bowlTypeOf(b.p));
  const pace = types.filter(t => t === 'pace').length, spin = types.filter(t => t === 'spin').length;
  const matches = xi.reduce((s, p) => s + (p.stats?.m || 0), 0);

  const issues = [];
  let balance = 100;
  if (xi.length < 11) { balance -= 8 * (11 - xi.length); issues.push(`Only ${xi.length} players in the XI`); }
  if (!xi.some(p => p.role === 'WK')) { balance -= 25; issues.push('No wicket-keeper'); }
  if (bowlers.length < 5) { balance -= 15 * (5 - bowlers.length); issues.push(`Only ${bowlers.length} bowling option${bowlers.length === 1 ? '' : 's'}`); }
  if (batters.length < 6) { balance -= 10 * (6 - batters.length); issues.push(`Only ${batters.length} recognised batter${batters.length === 1 ? '' : 's'}`); }
  if (bowlers.length && !pace) { balance -= 12; issues.push('No pace bowling'); }
  if (bowlers.length && !spin) { balance -= 12; issues.push('No spinner'); }
  if (!impact) { balance -= 5; issues.push('No Impact Player'); }

  const aspects = [
    { key: 'top', label: 'Top order (1–3)', score: avgOf(bat.slice(0, 3), 3) },
    { key: 'middle', label: 'Middle & finishing (4–7)', score: avgOf(bat.slice(3, 7), 4) },
    { key: 'bowling', label: 'Bowling attack', score: avgOf(bowlers.map(b => b.r), 5) },
    { key: 'depth', label: 'All-round depth', score: 100 * (0.5 * scale(bowlers.length, 4, 7) + 0.5 * scale(batters.length, 5, 8)) },
    { key: 'experience', label: 'IPL experience', score: 100 * scale(matches, 200, 1400) },
    { key: 'balance', label: 'Team balance', score: Math.max(0, balance) }
  ];
  const weights = { top: 0.20, middle: 0.18, bowling: 0.27, depth: 0.10, experience: 0.08, balance: 0.17 };
  const key = all.map(p => ({ p, r: Math.max(batRating(p), bowlRating(p)) })).sort((a, b) => b.r - a.r).slice(0, 3).map(x => x.p.name);
  const summary = `${bowlers.length} bowling options (${pace} pace, ${spin} spin) · ${batters.length} batters · ${matches} IPL matches`;
  return finish(team, aspects, weights, issues, key, summary);
}

// ---------- football ----------
const fbRating = p => 100 * scale(p.rating ?? 70, 65, 92);

function footballTeam(team) {
  const byId = new Map(team.squad.map(p => [p.id, p]));
  const xi = team.xi.xi.map(id => byId.get(id)).filter(Boolean);
  const by = role => xi.filter(p => p.role === role).map(fbRating).sort((a, b) => b - a);
  const gk = by('GK'), def = by('DEF'), mid = by('MID'), fwd = by('FWD');
  const defenders = xi.filter(p => p.role === 'DEF');
  const pos = new Set(defenders.map(p => p.position));

  const issues = [];
  let balance = 100;
  if (xi.length < 11) { balance -= 8 * (11 - xi.length); issues.push(`Only ${xi.length} players in the XI`); }
  if (!gk.length) { balance -= 30; issues.push('No goalkeeper'); } else if (gk.length > 1) { balance -= 15 * (gk.length - 1); issues.push(`${gk.length} goalkeepers in the XI`); }
  if (def.length < 3 || def.length > 5) { balance -= 15 * (def.length < 3 ? 3 - def.length : def.length - 5); issues.push(`${def.length} defenders`); }
  if (mid.length < 2 || mid.length > 5) { balance -= 12 * (mid.length < 2 ? 2 - mid.length : mid.length - 5); issues.push(`${mid.length} midfielders`); }
  if (fwd.length < 1 || fwd.length > 3) { balance -= 12 * (fwd.length < 1 ? 1 : fwd.length - 3); issues.push(`${fwd.length} forwards`); }
  if (defenders.length && !pos.has('CB') && !pos.has('DEF')) { balance -= 10; issues.push('No centre-back'); }
  if (defenders.length >= 3 && !pos.has('LB') && !pos.has('RB') && defenders.filter(p => p.position === 'DEF').length < 2) { balance -= 8; issues.push('No full-backs'); }

  const aspects = [
    { key: 'gk', label: 'Goalkeeper', score: gk[0] || 0 },
    { key: 'def', label: 'Defence', score: avgOf(def, 4) },
    { key: 'mid', label: 'Midfield', score: avgOf(mid, 3) },
    { key: 'att', label: 'Attack', score: avgOf(fwd, 3) },
    { key: 'quality', label: 'Overall quality', score: avgOf(xi.map(fbRating), 11) },
    { key: 'balance', label: 'Team balance', score: Math.max(0, balance) }
  ];
  const weights = { gk: 0.12, def: 0.20, mid: 0.20, att: 0.22, quality: 0.11, balance: 0.15 };
  const key = xi.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 3).map(p => p.name);
  const avg = xi.length ? (xi.reduce((s, p) => s + (p.rating || 0), 0) / xi.length).toFixed(1) : '–';
  const summary = `Formation ${def.length}-${mid.length}-${fwd.length} · average rating ${avg}`;
  return finish(team, aspects, weights, issues, key, summary);
}

function finish(team, aspects, weights, issues, key, summary) {
  const exact = aspects.reduce((s, a) => s + a.score * weights[a.key], 0); // unrounded, to break ties
  aspects.forEach(a => (a.score = Math.round(a.score)));
  return {
    teamId: team.id, overall: Math.round(exact), exact, aspects, issues, key, summary,
    strengths: aspects.filter(a => a.key !== 'balance' && a.score >= 70).map(a => a.label),
    weaknesses: aspects.filter(a => a.key !== 'balance' && a.score < 45).map(a => a.label)
  };
}

// teams: [{ id, squad, xi: { xi, impact } }] for the owned teams. Returns them ranked, best first.
function rankTeams(sport, teams) {
  const rate = sport === 'football' ? footballTeam : cricketTeam;
  const rows = teams.map(rate);
  rows.sort((a, b) => b.exact - a.exact);
  rows.forEach((r, i) => { r.rank = i + 1; delete r.exact; });
  return rows;
}

module.exports = { rankTeams, batRating, bowlRating };
