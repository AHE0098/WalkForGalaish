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
