/**
 * Metal protocol — 6 cards (values 0, 1, 2, 3, 5, 6 — no 4).
 *
 * 0 — Top: Your opponent's total value in this line is reduced by 2.
 *     Middle: Flip 1 card.
 * 1 — Middle: Draw 2 cards. Your opponent cannot compile next turn.
 * 2 — Top: Your opponent cannot play cards face-down in this line.
 * 3 — Middle: Draw 1 card. Delete all cards in 1 other line with 8 or more cards.
 * 5 — Middle: You discard 1 card.
 * 6 — Top/Bottom: When this card would be covered or flipped: First, delete this card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";
import { lineOf } from "./helpers.js";
import type { LineIdx } from "../engine/types.js";

const metal0: CardDef = {
  protocol: "metal",
  value: 0,
  top: {
    kind: "static-rule",
    apply: (ctx) => {
      const line = lineOf(ctx.state, ctx.thisInstanceId);
      const lineIdx: LineIdx = line ?? 0;
      return {
        kind: "value-modifier",
        lineIdx,
        side: "opp",
        ownerIdx: ctx.self,
        delta: () => -2,
      };
    },
  },
  middle: function* (ctx) {
    yield* h.flipChosen(ctx, {});
  },
  bottom: null,
};

const metal1: CardDef = {
  protocol: "metal",
  value: 1,
  top: null,
  middle: function* (ctx) {
    yield* ctx.draw(2);
    // "Your opponent cannot compile next turn." The check-compile phase
    // consumes one ban-turn from compileBans[active] when it fires next.
    ctx.state().compileBans[ctx.opp]++;
  },
  bottom: null,
};

const metal2: CardDef = {
  protocol: "metal",
  value: 2,
  top: {
    kind: "static-rule",
    apply: (ctx) => {
      const line = lineOf(ctx.state, ctx.thisInstanceId);
      const lineIdx: LineIdx = line ?? 0;
      return { kind: "play-restriction", lineIdx, affects: ctx.opp, forbid: "face-down" };
    },
  },
  middle: null,
  bottom: null,
};

const metal3: CardDef = {
  protocol: "metal",
  value: 3,
  top: null,
  middle: function* (ctx) {
    yield* ctx.draw(1);
    const thisLine = h.lineOfThis(ctx);
    if (thisLine === null) return;
    const others = h.otherLines(thisLine);
    const eligible = others.filter((l) => h.lineSizeBothSides(ctx.state(), l) >= 8);
    if (eligible.length === 0) return;
    const dest = yield* ctx.promptLine({ allowedLines: eligible, reason: "metal-3-line" });
    yield* h.deleteAllMatching(ctx, { inLines: [dest] });
  },
  bottom: null,
};

const metal5: CardDef = {
  protocol: "metal",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

const metal6: CardDef = {
  protocol: "metal",
  value: 6,
  top: {
    kind: "trigger-replacement",
    on: "flipped",
    resolve: function* (ctx) {
      yield* ctx.delete(ctx.thisInstanceId);
    },
  },
  middle: null,
  bottom: {
    kind: "trigger-replacement",
    on: "covered",
    resolve: function* (ctx) {
      yield* ctx.delete(ctx.thisInstanceId);
    },
  },
};

export const metalCards: CardDef[] = [metal0, metal1, metal2, metal3, metal5, metal6];
for (const c of metalCards) registerCard(c);
