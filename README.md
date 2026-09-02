# Card Game Platform — Race for the Galaxy

A generic multiplayer card-game platform with Race for the Galaxy as its first game plugin.
One Node process serves the API, the WebSocket endpoint, and the built frontend.

## Local

Requires Node 20+.

```bash
npm install
npm run dev      # http://localhost:5173 (client) + :3000 (server)
npm test         # unit tests
npm run smoke    # two-client end-to-end check against the production build
npm run build    # production build
npm start        # serve the build on $PORT (default 3000)
```

`npm run smoke` requires `npm run build` first. Open two browser tabs to play
locally: create a room in one, join with the code in the other.

## Render

Single Web Service.

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Environment | `PORT` (set by Render), `ASSET_PACK` (default `generated`), `ASSET_BASE_URL` (optional) |

The server reads `process.env.PORT` and listens on `0.0.0.0`. The client connects
to its own origin, so there are no hardcoded hosts. An SPA fallback means
refreshing on `/room/ABCD` works.

**Rooms live in memory.** A restart or redeploy loses every in-progress game.
Swap `createMemoryRoomStore` for a Redis-backed `RoomStore` when that matters —
the interface is the only thing the engine depends on.

## Architecture

Two layers with one dependency direction: **`core` never imports from `games`.**
A test enforces this.

```
src/core/      generic platform — rooms, transport, deck, zones, RNG, phases,
               ready gating, hidden simultaneous selection, per-player
               serialization, asset resolution, generic card UI
src/games/     one folder per game; imports and configures core
src/server/    Express + Socket.IO, room lifecycle, GameHost
src/client/    React shell, routes, socket hook
```

The server owns canonical state. Clients send intentions; the server validates,
resolves, increments a state version, and sends every player a **separately
filtered view**. Nothing secret is hidden in the client.

### Adding a new game

1. Create `src/games/<your-game>/`.
2. Provide a card database as data, plus an object satisfying `GameDefinition`
   (`src/core/types.ts`): setup, phases, `legalActions`, `resolveAction`,
   `calculateScore`, `determineGameEnd`, and a `display` config naming which card
   fields to render and which symbol tokens to use.
3. Register it in `GAMES` in `src/server/gameHost.ts`.

No file under `src/core/` should need editing. If one does, that is a leak worth fixing.

## Card data

`src/games/race-for-the-galaxy/cards/race_for_the_galaxy_base_cards.json` holds
95 card definitions / 114 physical cards, with mechanical values transcribed from
an open-source card database and cross-checked against the 2nd-edition rulebook.
`npm run validate:cards` checks structure and totals; it also runs as part of `npm test`.

Read `knownGaps` in that file before trusting the totals. In short: only the five
basic start worlds are present, and the payment-world cost distribution has a small
unexplained residual against the rulebook's full-box table.

## Assets

Cards render from data. Artwork is optional and swappable — see `docs/ASSETS.md`.
`npm run assets:check` reports coverage and misnamed files.

## Not yet implemented

- Card powers beyond costs, VP, flat military, and end-game scoring
- The Consume and Explore phases have no player-facing actions yet (Ready only)
- The experienced two-player variant (nine action cards, choose two)
- The six optional start worlds
