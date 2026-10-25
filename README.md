# Auction Room — multiplayer IPL and football auction game

A real-time auction game: create a room, share the code, each friend claims a franchise,
and everyone bids on players against a countdown that resets on every bid.

## Run it
```bash
npm install
npm start          # http://localhost:3000
```
Open it in two browser windows (or on two phones on the same Wi-Fi via your computer's IP) to test multiplayer.

## How it works
- `server.js` — Express + Socket.IO. Holds every room in memory and is the single source of truth:
  it runs the clock, validates bids (purse, squad size, overseas cap) and broadcasts state to the room.
- `data.js` — teams, shared rules and the auction modes (purse, squad size, overseas cap and player pool for each).
- `data/*.csv` — the player lists for each mode (PlayAuction exports): mega auction, IPL legends, legends upgraded,
  and the IPL 2026 mock auction pool plus each team's real retentions. Edit or replace a CSV to change a list.
- `clubs.js` — the 50 football clubs (grouped by country) with colours and crests.
- `players.js` — reads those CSVs and turns set codes (e.g. `BA1`, `UFA2`, `OSB-1`) into readable set names.
- `photos.json` — player name → photo URL (from Wikipedia). Add or replace entries to change a player's picture;
  players without one show their initials.
- `public/` — the browser client (plain HTML/CSS/JS, no build step).

The host picks Cricket or Football when creating a room, then an auction mode in the lobby:

| Mode | Pool | Purse | Squad |
|---|---|---|---|
| Mega Auction | 523 players (`playauction_mega_auction.csv`) | ₹120 cr | up to 25 |
| Legends Upgraded | 301 legends and current stars, with IPL stats | ₹120 cr | up to 25 |
| IPL Legends Auction | 184 all-time IPL greats, with IPL stats | ₹120 cr | up to 25 |
| IPL 2026 Mock Auction | 350-player pool; teams start with their real 2026 retentions | each team's real purse left | up to 25 (retained players count) |
| Football Auction | 361 European players with position and rating (`playauction_football_auction.csv`); 50 clubs | €1000M | up to 25 |

Features: cricket and football, room codes and invite links, five auction modes, IPL-style sets (Marquee first), team claiming,
host controls (pause, close lot, end, bid timer), an unsold-players second round, an auction board
(upcoming, sold, unsold, leaderboard), team squads by role, an activity feed with chat, Playing XI with
Impact Player, countdown sounds, reconnect after a refresh and spacebar to bid.

## Deploy
Any Node host that supports WebSockets works (Render, Railway, Fly.io, a VPS).
Set the start command to `npm start`; the app reads `PORT` from the environment.
Rooms live in memory, so they reset when the server restarts. Add Redis or a database if you need persistence.
