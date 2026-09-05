# Interaction conventions

The board must work the same on a phone as on a laptop. These rules exist because
the first version of zone sorting shipped as a long press only: fine on a desktop,
unreachable on a phone.

## 1. A button first, always

Every action ships as a real, visible, tappable control. Only once that works may a
gesture be added as an accelerator.

| Ranked by robustness | Use it for |
|---|---|
| Tap a button | everything, always the first implementation |
| Tap a card | selecting, inspecting |
| Toggle button with `aria-pressed` | showing and hiding panels |
| Long press | an accelerator for something a button already does |
| Hover | decoration only — never information, never an action |
| Drag, swipe, double-tap, right-click | avoid; a phone cannot reliably produce them |

If removing every gesture from the app would make a feature unreachable, the feature
is not finished.

## 2. Nothing important lives in a tooltip

`title=` does not exist on a touch screen. A reason, a rule or a number that a player
needs must be in the layout or in a panel they can open. Tooltips are a bonus for
mouse users.

## 3. Hover must not stick

Touch browsers keep `:hover` applied after a tap. Any hover styling is wrapped in
`@media (hover: hover)` or neutralised under `@media (hover: none)`.

## 4. Physical realities of a phone

- `100dvh`, never `100vh` — mobile toolbars collapse and change the viewport.
- `env(safe-area-inset-*)` on anything pinned to an edge.
- Inputs at `font-size: 16px`, or iOS zooms the page on focus.
- `touch-action: manipulation` on interactive elements to kill the 300 ms double-tap delay.
- `overscroll-behavior: contain` on scrollable rows, so a sideways drag does not
  trigger pull-to-refresh.
- Tap targets at least 44 px on small screens.
- Never `user-scalable=no`: pinch zoom is an accessibility feature.

## 5. These rules are tested, not remembered

`src/client/__tests__/touch.test.ts` enforces them by scanning the source. It fails if
a long press appears in a component with no button, if a drag or double-click handler
is introduced, if `100vh` creeps back in, or if the safe-area and font-size rules go
missing. Deliberately blunt: a false alarm costs a minute, a gesture-only feature costs
a playtest.
