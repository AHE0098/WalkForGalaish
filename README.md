# Card Game Platform — Race for the Galaxy

A generic multiplayer card-game platform with Race for the Galaxy as its first game plugin.
One Node process serves the API, the WebSocket endpoint, and the built frontend.

## Local

Requires Node 20+.

```bash
npm install
npm run dev      # http://localhost:5173 (client) + :3000 (server)
npm test         # typecheck + unit tests
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

The repo ships with a **procedural pack** (`public/assets/packs/neon`): 95 card
images and 23 symbols drawn as SVG from the card data itself by
`npm run assets:generate`. Resource hue, a filled disc for production worlds, a
ring for windfall worlds, hazard chevrons for military worlds and megastructure
scale for six-cost developments all come straight from the card's own fields, so
the picture can never disagree with the mechanics. It is our own output, so it is
committed. `ASSET_PACK=neon` is the default.

To replace it with model-generated or commissioned art, hand `art/ART-BRIEF.md`, `art/prompts.txt` and
`art/art-manifest.csv` to an image model. They specify all 119 images (95 cards,
23 symbols, one card back), the exact filenames the resolver expects, and a style
guide that keeps the card corners and lower third quiet so the overlaid numbers
and phase rail stay readable. Drop the results into
`public/assets/packs/neon/` and set `ASSET_PACK=neon`.

## Goods

There are four kinds — novelty, rare elements, genes and alien technology. A good is a
real face-down card from the supply sitting on a world; its **kind comes from the world**,
never from the card underneath, and consuming it returns that card to the discard pile.
Clients are told a good's kind (public) but never its identity (secret).

Production worlds refill every Produce phase; windfall worlds receive one good when
settled, and otherwise only via the Produce bonus or a card power.

**Nothing is discarded or spent without a click.** Paying for a card, keeping explore
draws, trimming to the hand limit at the end of a round, and giving up cards for victory
points are all choices the player makes. Where the rules genuinely force a move — placing
production goods — the player still confirms it, and the button is marked *forced*, so
the table can follow what happened rather than watching goods appear silently.

**Consuming is compulsory, but every decision inside it belongs to the player.** The
engine enumerates each legal move — sell this genes good, spend that novelty good on
Consumer Markets — and the phase does not end while any remains. Nothing is spent
without a click. A "resolve the rest for me" button is there for players who don't
want to click through, and an absent player has it done for them. Trade sells at
2/3/4/5 cards for novelty/rare/genes/alien plus any Trade powers.

## What the game does now

Full round loop: opening 6-choose-4 discard → secret action-card selection → only the
chosen phases run, in order → Explore deals cards to choose from → Develop and Settle
with per-card legality and a payment step → Consume resolves powers for VP chips and
trade → Produce places goods → hand limit → next round → end condition → scored results.

Every row of cards on the board is a `CardZone`, which is where shared behaviour like
sorting lives — hold a zone's title to reveal the sort controls, then pick keys in the
order you want them applied. Rule text is rendered from structured segments, so goods
appear as coloured tokens and military as the same red circle a world's defense uses.

Cards are drawn the way the printed game draws them: a black diamond for developments,
a circle for worlds, a red circle for military worlds, a solid coloured circle for
production worlds and a coloured halo for windfall worlds. Powers sit in fixed I–V rows
so the same phase is always in the same place. Tapping any card opens a full-size reader;
tapping anywhere closes it. All game numbers live behind one status button.

When the supply runs out the table stops at a Reshuffle step: every player confirms, the
graveyard is shuffled back in, and play resumes.

### Staying robust

Seats survive disconnects. Closing a tab, losing signal or hitting "Leave game" mid-game
keeps your seat and your hand; rejoining with the same browser puts you straight back.
There is no move timer: connected players may think as long as they like. Only a
player whose connection has actually dropped is played for, after a few seconds'
grace, so the table can never be frozen by someone who closed their laptop. The
server tells every client who it is still waiting on.

### Views

Anything that takes over the screen — the card reader, the deck browser, the status
sheet, the menu — is pushed onto a generic view stack (`src/client/views/ViewHost.tsx`).
Escape or a backdrop tap pops one level. Adding a new full-screen view is one `push` call
and needs no changes to the board.

The deck browser is game-agnostic: it renders whatever card list it is given and offers
whichever sort keys the game declares in its `display.sortKeys`. Sorting is multi-key and
applied in the order the player picks the keys.

## Not yet implemented

- Explore/settle/produce powers are applied for the common cases; rarer ones are inert
  (the card still plays with its printed cost and VP)
- Some rarer card powers remain inert; those cards still play at their printed cost and VP
- The experienced two-player variant (nine action cards, choose two)
- The six optional start worlds
- No card artwork yet — see `docs/ASSETS.md` to add some
