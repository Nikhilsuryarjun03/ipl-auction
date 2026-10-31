"""Build each player's last-5-IPL-seasons stats from Cricsheet ball-by-ball data.

Usage: python -I build_form.py <match_json_dir> <people.csv> <names.csv> <catalog.txt> <out.json>
catalog.txt lines are "Name|ROLE" for every cricketer in the game. Output maps each matched game name to
its last five IPL seasons (most recent first)."""
import csv, glob, json, os, re, sys, unicodedata
from collections import defaultdict

match_dir, people_csv, names_csv, catalog_txt, out_json = sys.argv[1:6]

NOT_BOWLER_WICKET = {'run out', 'retired hurt', 'retired out', 'obstructing the field', 'retired not out'}


def blank():
    return dict(m=0, inns=0, runs=0, balls=0, outs=0, f=0, s=0, bb=0, rc=0, w=0)


stats = defaultdict(lambda: defaultdict(blank))  # identifier -> year -> totals
for path in glob.glob(os.path.join(match_dir, '*.json')):
    with open(path, encoding='utf-8') as fh:
        d = json.load(fh)
    info = d['info']
    year = int(info['dates'][0][:4])
    reg = info.get('registry', {}).get('people', {})
    pid = lambda n: reg.get(n, 'name:' + n)
    for team_players in info.get('players', {}).values():
        for n in team_players:
            stats[pid(n)][year]['m'] += 1
    for inn_no, inn in enumerate(d.get('innings', [])):
        batted = set()
        for over in inn.get('overs', []):
            for b in over.get('deliveries', []):
                ex = b.get('extras', {})
                bat, bowl, ns = pid(b['batter']), pid(b['bowler']), pid(b['non_striker'])
                batted.update((bat, ns))
                r = b['runs']['batter']
                sb = stats[bat][year]
                sb['runs'] += r
                if 'wides' not in ex:
                    sb['balls'] += 1
                if not b['runs'].get('non_boundary'):
                    if r == 4: sb['f'] += 1
                    if r == 6: sb['s'] += 1
                bo = stats[bowl][year]
                if 'wides' not in ex and 'noballs' not in ex:
                    bo['bb'] += 1
                bo['rc'] += r + ex.get('wides', 0) + ex.get('noballs', 0)
                for wk in b.get('wickets', []):
                    if wk['kind'] not in ('retired hurt', 'retired not out'):
                        stats[pid(wk['player_out'])][year]['outs'] += 1
                    if wk['kind'] not in NOT_BOWLER_WICKET:
                        bo['w'] += 1
        for p in batted:
            stats[p][year]['inns'] += 1


def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z ]+', '', s.replace('.', ' ').replace('-', ' ')).split()


# every known name for each IPL player (full names from names.csv, short names from people.csv)
variants = defaultdict(set)
with open(people_csv, encoding='utf-8') as fh:
    for row in csv.DictReader(fh):
        if row['identifier'] in stats:
            variants[row['identifier']].update([row['name'], row['unique_name']])
with open(names_csv, encoding='utf-8') as fh:
    for row in csv.DictReader(fh):
        if row['identifier'] in stats:
            variants[row['identifier']].add(row['name'])
by_name = defaultdict(set)
for ident, names in variants.items():
    for n in names:
        by_name[' '.join(norm(n))].add(ident)
last_year = {i: max(y for y in stats[i]) for i in variants}


totals = {i: (sum(x['runs'] for x in stats[i].values()), sum(x['w'] for x in stats[i].values())) for i in variants}
ROLE = {'name': None}


def pick(ids):
    # several people share a name: the one whose record fits the role (a bowler with wickets, a batter with runs),
    # then the one who played IPL most recently
    if not ids:
        return None
    role = ROLE['name']
    def fit(i):
        runs, wkts = totals[i]
        return {'BOWL': wkts * 25, 'BAT': runs, 'WK': runs}.get(role, runs + wkts * 25)
    return max(ids, key=lambda i: (fit(i) > 0, fit(i) if len(ids) > 1 and role else 0, last_year[i]))


RECENT = max(y for i in stats for y in stats[i]) - 3  # "still playing" means an IPL season in the last few years


# Players listed under a different name in Cricsheet.
ALIASES = {'Mayank Agarawal': 'Mayank Agarwal', 'Yudhvir Charak': 'Yudhvir Singh', 'Smaran Ravichandaran': 'R Smaran',
           'Sarfaraz Khan': 'SN Khan', 'Lhuan-Dre Pretorious': 'Lhuan-dre Pretorius'}


def match(name, current):
    w = norm(ALIASES.get(name, name))
    ident = pick(by_name.get(' '.join(w), set()))
    if ident:
        return ident, 'exact'
    keys = [(k.split(), ids) for k, ids in by_name.items() if k]
    # same words in another order ("Vyshak Vijaykumar" / "Vijaykumar Vyshak")
    hits = {i for kw, ids in keys if sorted(kw) == sorted(w) for i in ids}
    if hits:
        return pick(hits), 'reordered'
    # one name contains the other ("Sai Sudharsan" / "B Sai Sudharsan", "Mohd Arshad Khan" / "Arshad Khan")
    if len(w) >= 2:
        hits = {i for kw, ids in keys if len(kw) >= 2 and kw[-1] == w[-1] and (set(w) <= set(kw) or set(kw) <= set(w)) for i in ids}
        if hits:
            return pick(hits), 'contains'
    # same surname and first initial ("Jitesh Sharma" / "JM Sharma"); current players prefer someone still playing
    hits = {i for kw, ids in keys if kw[-1] == w[-1] and kw[0][0] == w[0][0] for i in ids}
    if current and len(hits) > 1:
        hits = {i for i in hits if last_year[i] >= RECENT}
    if len(hits) == 1:
        return hits.pop(), 'initial'
    return None, None


out, unmatched, how = {}, [], defaultdict(int)
with open(catalog_txt, encoding='utf-8') as fh:
    for line in fh:
        parts = line.strip().split('|')
        name, current = parts[0], len(parts) > 2 and parts[2] == 'current'
        if not name or name in out:
            continue
        ROLE['name'] = parts[1] if len(parts) > 1 else None
        ident, kind = match(name, current)
        if not ident:
            unmatched.append(name)
            continue
        how[kind] += 1
        played = sorted((y for y, s in stats[ident].items() if s['m']), reverse=True)[:5]
        out[name] = [dict(y=y, **stats[ident][y]) for y in played]
with open(out_json, 'w', encoding='utf-8') as fh:
    json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
seasons = sorted({y for i in stats for y in stats[i]})
print(f'seasons {seasons[0]}-{seasons[-1]}; matched {len(out)} ({dict(how)}); unmatched {len(unmatched)}')
print('unmatched sample:', unmatched[:40])
