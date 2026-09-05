# Decisions

- **One service, one process.** Express serves Socket.IO and the built client with an
  SPA fallback. A split frontend/backend is the usual way WebSockets break on Render.
- **Rooms in memory behind `RoomStore`.** Redis later without touching the engine.
- **Goods are card instances, not counters.** A good is a real face-down card on a world;
  its kind comes from the world. This keeps deck counts honest.
- **Face-down cards get opaque handles in the player view.** Instance ids embed the
  definition id (`gamma#001`), so sending one would reveal the card. Goods are sent as
  `{ goodId: "<worldInstance>/g0" }` instead. A test enforces this.
- **`advancePhase` is guarded by `phaseId`.** Repeated Ready clicks are no-ops after the
  first, rather than being debounced in the UI.
- **Round action choices are persisted to `gameData.roundActions`** because `enterPhase`
  clears `revealedChoices`, and the per-phase bonuses belong to whoever chose that phase.
- **v1 uses the five basic start worlds only**, matching the supplied card data.
- **Action selection is in v1.** It is the defining mechanic, and retrofitting it would
  touch the phase engine, the UI, and every test.

## Playtest fixes

- **One action per phase is enforced by a ledger**, `gameData.acted`, keyed by `phaseId`.
  Checking "has this player already played?" via readiness was not enough: a free
  military world costs 0, so it slid past the payment check and a player could place
  two worlds in one Settle phase. The ledger holds only the current phase, so a stale
  entry cannot leak forward.
- **Round bookkeeping is cleared when a round opens.** `roundActions`, `keepCounts` and
  the action ledger used to persist, so in round 2 the client still saw last round's
  choice and left the player stranded on "revealing…". `GameHost.startOfRoundCleanup`
  drops them the moment `phaseIndex` returns to −1.
- **No phase clock for connected players.** `phaseTimeoutSeconds: 0` disables it
  entirely; only a player whose socket has actually dropped is played for, after a
  six-second grace. Thinking time is unlimited.
- **`waitingOn` is computed on the server** and sent to every client, so all players
  see the same answer to "who are we waiting for" instead of each deriving it from
  data that could be stale.

## Build hygiene

- **Tests are excluded from the production build.** `tsconfig.build.json` compiles only
  `core`, `games` and `server` source; a type error in a test file has no business
  breaking a deploy.
- **`npm test` runs `tsc --noEmit` over everything first**, tests included. The failure
  mode this prevents is real: a stray line in a test file passed `vitest` (which strips
  types without checking them) and only surfaced on Render.

## Consume belongs to the player

Auto-resolving Consume was wrong. It was rules-legal — consumption is compulsory — but
it silently made choices that are the player's: which good to sell for the Trade bonus,
and which power to spend a good on. A playtester traded a good he wanted to keep and
had a second one eaten in the same invisible step.

The engine now enumerates concrete options through the generic `playerOptions` hook and
waits. `legalActions` returns `CHOOSE_OPTION` while any option remains, so the phase
cannot end early, and `READY` only once nothing is left — compulsion is preserved
without removing agency. `AUTO_RESOLVE` is opt-in, and is what an absent player gets.

## Choice by default; forced moves are still clicked

Every point where the engine used to pick cards on the player's behalf now asks:

- the end-of-round hand limit inserts a **Discard step** into the round, and each player
  over the limit chooses what to lose (anyone who does not choose is trimmed when the
  step completes, so the table cannot hang);
- **Deficit Spending** raises a pending selection instead of eating the first cards in hand;
- **Produce** is compulsory by the rules, so it is offered as a single option flagged
  `forced: true` and labelled "compulsory" — the click exists purely so the move is
  visible.

`Pending` (pick N cards) and `PlayerOption.forced` both live in the generic layer, so any
game gets both behaviours for free.

## Discard-this-card powers

New Military Tactics, Colony Ship and Contact Specialist were all completely inert:
`militaryStrength` summed only the plain military powers, and nothing consulted the
other two effect types at all. They are now implemented, with the two discretionary
ones offered as Settle-phase options so the player decides whether to spend the card.

Their effects last for one phase only and are stored keyed by `phaseId` — the same
pattern as the action ledger — so a boost cannot leak into a later phase. A test
asserts exactly that.

## Presentation is generic, not per-game

- **`CardZone`** is the single component behind every row of cards: hand, tableau,
  opponent tableau, explore draws. Behaviour added there appears everywhere at once.
  Sorting lives in it as core functionality but is hidden by default — press and hold a
  zone title to reveal it — so the common path stays uncluttered.
- **Rule text is a list of segments, not a string.** `powerSegments` (game layer) turns
  a structured power into `text | good | military | vp | card` pieces, and `Glyph`
  (core layer) knows how to draw each. Core never learns what a "good" means; the game
  never learns how one is drawn. A different game supplies different segment kinds.
- **The card no longer says "world" or "development".** The diamond and circle already
  carry that, so the tag row is reserved for traits the pip cannot show — windfall,
  rebel, alien, start, six-cost — which now stand out because there is less beside them.
- **A card holding a good is tinted by that good** across its whole face, driven by a
  `data-good` attribute and a CSS custom property, so adding a fifth resource is a
  colour token rather than a code change.

## Buttons before gestures

Zone sorting shipped as a long press with no other way in. It worked on a laptop and
was unreachable on a phone — the same class of mistake as auto-consuming: a path that
exists in the developer's head but not in the player's hands.

The convention is now: implement the button first, add the gesture second, and never
let the gesture be the only route. `CONVENTIONS.md` states it and
`src/client/__tests__/touch.test.ts` enforces it by scanning the client source, so it
fails the build rather than surfacing in a playtest. I verified the check by removing
the sort button and confirming the suite went red.

## Artwork lives in its own pack

Real artwork and generated artwork must not share a folder. The generator writes SVG
into `packs/neon`, and the resolver prefers `.svg`, so a hand-supplied `gem-world.webp`
dropped in beside it would have been silently outranked by the procedural version.

Real art therefore has its own pack, `packs/art`, which is committed (so it deploys),
never written to by any build step, and deliberately excluded from the release archives
handed over for upload — uploading a new build cannot delete artwork it does not
contain. Lookup falls through art → neon → drawn-from-data, so partial coverage is a
normal state rather than a broken one. Tests assert each of these.

## Motion is driven by events, not by diffing

The client never compares two game states to work out what happened. The engine
emits structured `GameEvent`s with monotonic ids, and the feed shows anything with an
id it has not seen. A dropped update, a reconnect or a stale frame costs nothing: the
next payload carries the ids, and at worst a moment is missed rather than mis-narrated.

Every animation is opacity or transform only — a test walks each `@keyframes` block
and fails if one animates width, height or position — so a slow phone drops frames
instead of doing layout work. Idle "breathing" on playable cards is restricted to
devices with a real pointer, and everything collapses under `prefers-reduced-motion`.

## Scroll containment is per axis

`overscroll-behavior: contain` on the horizontal card rows blocked scroll chaining on
*both* axes, so a vertical drag starting on a card — most of a phone screen — never
reached the page. It is now `overscroll-behavior-x` only, with `touch-action: pan-x
pan-y` on the rows and on cards.
