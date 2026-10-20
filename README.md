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
- `data.js` — teams, players and rules. Change purse, timer, squad limits or swap in your own player list here.
- `photos.json` — player name → photo URL (from Wikipedia). Add or replace entries to change a player's picture;
  players without one show their initials.
- `public/` — the browser client (plain HTML/CSS/JS, no build step).

Features: room codes and invite links, team claiming, host controls (pause, close lot, end),
an unsold-players second round, reconnect after a refresh, spacebar to bid, and final squad summaries.

## Deploy
Any Node host that supports WebSockets works (Render, Railway, Fly.io, a VPS).
Set the start command to `npm start`; the app reads `PORT` from the environment.
Rooms live in memory, so they reset when the server restarts. Add Redis or a database if you need persistence.
