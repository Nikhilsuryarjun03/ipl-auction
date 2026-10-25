# Gavel & Willow — multiplayer cricket auction game

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
- `players.js` — the player lists: current IPL players, retired legends, and which current players count as icons.
  Each line is `"Name/ROLE"` or `"Name/ROLE/COUNTRY"`, grouped by base price.
- `photos.json` — player name → photo URL (from Wikipedia). Add or replace entries to change a player's picture;
  players without one show their initials.
- `public/` — the browser client (plain HTML/CSS/JS, no build step).

Auction modes (the host picks one in the lobby):
| Mode | Pool | Purse | Squad |
|---|---|---|---|
| Mega Auction | every current IPL player | ₹120 cr | up to 25 |
| Legends Upgraded | legends + every current player | ₹120 cr | up to 25 |
| Legends Auction | legends + modern icons | ₹120 cr | up to 25 |
| Mock Auction | 90 random current players | ₹50 cr | up to 12 |

Features: room codes and invite links, four auction modes, IPL-style sets (Marquee first), team claiming,
host controls (pause, close lot, end, bid timer), an unsold-players second round, an auction board
(upcoming, sold, unsold, leaderboard), team squads by role, an activity feed with chat, Playing XI with
Impact Player, countdown sounds, reconnect after a refresh and spacebar to bid.

## Deploy
Any Node host that supports WebSockets works (Render, Railway, Fly.io, a VPS).
Set the start command to `npm start`; the app reads `PORT` from the environment.
Rooms live in memory, so they reset when the server restarts. Add Redis or a database if you need persistence.
