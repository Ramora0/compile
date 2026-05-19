/**
 * Apathy protocol — 6 cards (values 0–5).
 *
 * 0 — Top: +1 to your line value per face-down card in this line.
 * 1 — Middle: Flip all other face-up cards in this line.
 * 2 — Top: Ignore all middle commands of cards in this line.
 *     Bottom: When this card would be covered: First, flip this card.
 * 3 — Middle: Flip 1 of your opponent's face-up cards.
 * 4 — Middle: You may flip 1 of your face-up covered cards.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";
import { lineOf } from "./helpers.js";
import type { LineIdx } from "../engine/types.js";

const apathy0: CardDef = {
  protocol: "apathy",
  value: 0,
  top: {
    kind: "static-rule",
    apply: (ctx) => {
      const line = lineOf(ctx.state, ctx.thisInstanceId);
      // Default to line 0 if not yet on field; override stays harmless until placed.
      const lineIdx: LineIdx = line ?? 0;
      return {
        kind: "value-modifier",
        lineIdx,
        side: "self",
        ownerIdx: ctx.self,
        // Count face-down cards on BOTH sides of this line (rules.md: "this line").
        delta: () => {
          const a = ctx.state.stacks[0][lineIdx].cards.filter((c) => c.faceDown).length;
          const b = ctx.state.stacks[1][lineIdx].cards.filter((c) => c.faceDown).length;
          return a + b;
        },
      };
    },
  },
  middle: null,
  bottom: null,
};

const apathy1: CardDef = {
  protocol: "apathy",
  value: 1,
  top: null,
  middle: function* (ctx) {
    const line = h.lineOfThis(ctx);
    if (line === null) return;
    yield* h.flipAllMatching(ctx, {
      faceUp: true,
      inLines: [line],
      excludeInstanceId: ctx.thisInstanceId,
    });
  },
  bottom: null,
};

const apathy2: CardDef = {
  protocol: "apathy",
  value: 2,
  top: {
    kind: "static-rule",
    apply: (ctx) => {
      const line = lineOf(ctx.state, ctx.thisInstanceId);
      const lineIdx: LineIdx = line ?? 0;
      // Apply to both sides of the line — "cards in this line" includes opp.
      return { kind: "ignore-middle", lineIdx, side: "self", ownerIdx: ctx.self };
    },
  },
  middle: null,
  bottom: {
    kind: "trigger-replacement",
    on: "covered",
    resolve: function* (ctx) {
      yield* ctx.flip(ctx.thisInstanceId);
    },
  },
};

const apathy3: CardDef = {
  protocol: "apathy",
  value: 3,
  top: null,
  middle: function* (ctx) {
    yield* h.flipChosen(ctx, { side: "opp", faceUp: true });
  },
  bottom: null,
};

const apathy4: CardDef = {
  protocol: "apathy",
  value: 4,
  top: null,
  middle: function* (ctx) {
    yield* h.flipChosen(ctx, { side: "self", faceUp: true, covered: true }, { optional: true });
  },
  bottom: null,
};

const apathy5: CardDef = {
  protocol: "apathy",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const apathyCards: CardDef[] = [apathy0, apathy1, apathy2, apathy3, apathy4, apathy5];
for (const c of apathyCards) registerCard(c);
