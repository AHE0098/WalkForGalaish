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
