# Cards

This directory holds the card definitions that plug into the engine. Each card is a TypeScript module exporting a `CardDef` and self-registering via `registerCard()`.

In v1 there are zero cards. The engine ships with the registry and the author API; real cards are slotted in one file at a time as `<protocol>/<value>.ts`.

## Adding a card

The example below is a **shape illustration only** — `<some-protocol>` and the effect bodies are placeholders, not a real card from rules.md.

```ts
// src/cards/<some-protocol>/<value>.ts
import { registerCard, type CardDef } from "../api.js";

const card: CardDef = {
  protocol: "<some-protocol>", // any ProtocolName
  value: 0,                    // 0..5
  top: null,
  middle: function* (ctx) {
    // Yield Ops the engine will pump. The actual effect text from
    // rules.md / cards/<protocol>/<value>.md is what determines the body.
    yield { kind: "draw", playerIdx: ctx.self, count: 1 };
  },
  bottom: null,
};

registerCard(card);

export default card;
```

A card module must be imported once at startup so its `registerCard()` call runs. Aggregate imports live in `cards/index.ts` (created when the first real card is added).

## Effect shape

`middle` and trigger `resolve` functions are **generator functions** that `yield` Ops. Each yield hands control back to the engine's Op pump, which:

1. Applies the Op (mutating game state).
2. Resolves any replacement triggers it fires.
3. If the Op is a prompt, suspends the generator until the player responds.
4. Resumes the generator with the Op's result (e.g. the chosen card).

This gives us the "active text interrupts other text, last in first out" semantics from rules.md for free — nested effects spawn nested generators on the engine's stack.

## Passive shape

The `top` and `bottom` fields are `Passive | null`:

- `trigger-phase` — fires at Start/End of the owner's turn
- `trigger-reactive` — fires after a named action (`after-draw`, `after-delete`, etc.)
- `trigger-replacement` — intercepts a lifecycle event (`covered`, `flipped`, `deleted-by-compile`, …); the resolve generator runs *before* the underlying transition
- `static-rule` — registers a `RuleOverride` that modifies game rules while the passive is active (value modifiers, play restrictions, phase skips)

Triggers and overrides attach automatically when the passive is visible (face-up; bottom additionally requires the card to be uncovered) and detach when it stops being visible.
