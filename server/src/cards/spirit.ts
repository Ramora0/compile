/**
 * Spirit protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Refresh. Draw 1 card.
 *     Bottom: Skip your check cache phase.
 * 1 — Top: You can play cards in any line.
 *     Middle: Draw 2 cards.
 *     Bottom: Start: Either discard 1 card or flip this card.
 * 2 — Middle: You may flip 1 card.
 * 3 — Top: After you draw cards: You may shift this card, even if this card is covered.
 * 4 — Middle: Swap the positions of 2 of your protocols.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";
import { findCardOnField } from "../engine/field.js";
import type { LineIdx } from "../engine/types.js";

const spirit0: CardDef = {
  protocol: "spirit",
  value: 0,
  top: null,
  middle: function* (ctx) {
    yield* ctx.refresh();
    yield* ctx.draw(1);
  },
  bottom: {
    kind: "static-rule",
    apply: (ctx) => ({ kind: "skip-phase", phase: "check-cache", ownerIdx: ctx.self }),
  },
};

const spirit1: CardDef = {
  protocol: "spirit",
  value: 1,
  top: {
    kind: "static-rule",
    apply: (ctx) => ({ kind: "play-anywhere", affects: ctx.self }),
  },
  middle: function* (ctx) {
    yield* ctx.draw(2);
  },
  bottom: {
    kind: "trigger-phase",
    phase: "start",
    resolve: function* (ctx) {
      const choice = yield* ctx.promptOption({
        options: [
          { id: "discard", label: "Discard 1" },
          { id: "flip", label: "Flip Spirit 1" },
        ],
        reason: "spirit-1-start",
      });
      if (choice === "discard") {
        yield* h.discardSelfN(ctx, 1);
      } else {
        yield* ctx.flip(ctx.thisInstanceId);
      }
    },
  },
};

const spirit2: CardDef = {
  protocol: "spirit",
  value: 2,
  top: null,
  middle: function* (ctx) {
    yield* h.flipChosen(ctx, {}, { optional: true });
  },
  bottom: null,
};

const spirit3: CardDef = {
  protocol: "spirit",
  value: 3,
  top: {
    kind: "trigger-reactive",
    on: "after-draw",
    scope: "self",
    resolve: function* (ctx) {
      const choice = yield* ctx.promptOption({
        options: [
          { id: "yes", label: "Shift this" },
          { id: "no", label: "Skip" },
        ],
        reason: "spirit-3-may-shift",
      });
      if (choice !== "yes") return;
      const loc = findCardOnField(ctx.state(), ctx.thisInstanceId);
      if (!loc) return;
      const allowed: LineIdx[] = ([0, 1, 2] as LineIdx[]).filter((l) => l !== loc.lineIdx);
      if (allowed.length === 0) return;
      const dest = yield* ctx.promptLine({ allowedLines: allowed, reason: "spirit-3-dest" });
      yield* ctx.shift(ctx.thisInstanceId, dest);
    },
  },
  middle: null,
  bottom: null,
};

const spirit4: CardDef = {
  protocol: "spirit",
  value: 4,
  top: null,
  middle: function* (ctx) {
    yield* h.swapTwoProtocols(ctx);
  },
  bottom: null,
};

const spirit5: CardDef = {
  protocol: "spirit",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const spiritCards: CardDef[] = [spirit0, spirit1, spirit2, spirit3, spirit4, spirit5];
for (const c of spiritCards) registerCard(c);
