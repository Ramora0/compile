/**
 * Speed protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Play 1 card.
 * 1 — Top (after-clear-cache): Draw 1 card.
 *     Middle: Draw 2 cards.
 * 2 — Top (replacement, deleted-by-compile): Shift this card, even if covered.
 * 3 — Middle: Shift 1 of your other cards.
 *     Bottom (End): You may shift 1 of your cards. If you do, flip this card.
 * 4 — Middle: Shift 1 of your opponent's face-down cards.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";
import { findCardOnField } from "../engine/field.js";
import type { LineIdx } from "../engine/types.js";

const speed0: CardDef = {
  protocol: "speed",
  value: 0,
  top: null,
  middle: function* (ctx) {
    yield* h.playFromHand(ctx, { faceDown: "ask", reason: "speed-0" });
  },
  bottom: null,
};

const speed1: CardDef = {
  protocol: "speed",
  value: 1,
  top: {
    kind: "trigger-reactive",
    on: "after-clear-cache",
    scope: "self",
    resolve: function* (ctx) {
      yield* ctx.draw(1);
    },
  },
  middle: function* (ctx) {
    yield* ctx.draw(2);
  },
  bottom: null,
};

const speed2: CardDef = {
  protocol: "speed",
  value: 2,
  top: {
    kind: "trigger-replacement",
    on: "deleted-by-compile",
    resolve: function* (ctx) {
      const loc = findCardOnField(ctx.state(), ctx.thisInstanceId);
      if (!loc) return;
      const others = ([0, 1, 2] as const).filter((l) => l !== loc.lineIdx);
      if (others.length === 0) return;
      const dest = yield* ctx.promptLine({
        allowedLines: [...others] as LineIdx[],
        reason: "speed-2-escape",
      });
      yield* ctx.shift(ctx.thisInstanceId, dest);
      // note: engine still proceeds to delete this card from its new location;
      // proper "escape from compile" requires replacement-cancellation support.
    },
  },
  middle: null,
  bottom: null,
};

const speed3: CardDef = {
  protocol: "speed",
  value: 3,
  top: null,
  middle: function* (ctx) {
    yield* h.shiftChosen(ctx, { side: "self", excludeInstanceId: ctx.thisInstanceId });
  },
  bottom: {
    kind: "trigger-phase",
    phase: "end",
    resolve: function* (ctx) {
      const id = yield* h.shiftChosen(ctx, { side: "self" }, { optional: true });
      if (id) yield* ctx.flip(ctx.thisInstanceId);
    },
  },
};

const speed4: CardDef = {
  protocol: "speed",
  value: 4,
  top: null,
  middle: function* (ctx) {
    yield* h.shiftChosen(ctx, { side: "opp", faceDown: true });
  },
  bottom: null,
};

const speed5: CardDef = {
  protocol: "speed",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const speedCards: CardDef[] = [speed0, speed1, speed2, speed3, speed4, speed5];
for (const c of speedCards) registerCard(c);
