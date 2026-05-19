/**
 * Life protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Play the top card of your deck face-down in each line where you have a card.
 *     Bottom: When this card would be covered: First, delete this card.
 * 1 — Middle: Flip 1 card. Flip 1 card.
 * 2 — Middle: Draw 1 card. You may flip 1 face-down card.
 * 3 — Bottom: When this card would be covered: First, play the top card of your deck face-down in another line.
 * 4 — Middle: If this card is covering a card, draw 1 card.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";
import { findCardOnField } from "../engine/field.js";
import type { LineIdx } from "../engine/types.js";

const life0: CardDef = {
  protocol: "life",
  value: 0,
  top: null,
  middle: function* (ctx) {
    const state = ctx.state();
    for (const l of [0, 1, 2] as LineIdx[]) {
      if (h.lineSize(state, ctx.self, l) > 0) {
        yield* h.playTopOfDeckFaceDown(ctx, ctx.self, l);
      }
    }
  },
  bottom: {
    kind: "trigger-replacement",
    on: "covered",
    resolve: function* (ctx) {
      yield* ctx.delete(ctx.thisInstanceId);
    },
  },
};

const life1: CardDef = {
  protocol: "life",
  value: 1,
  top: null,
  middle: function* (ctx) {
    yield* h.flipChosen(ctx, {});
    yield* h.flipChosen(ctx, {});
  },
  bottom: null,
};

const life2: CardDef = {
  protocol: "life",
  value: 2,
  top: null,
  middle: function* (ctx) {
    yield* ctx.draw(1);
    yield* h.flipChosen(ctx, { faceDown: true }, { optional: true });
  },
  bottom: null,
};

const life3: CardDef = {
  protocol: "life",
  value: 3,
  top: null,
  middle: null,
  bottom: {
    kind: "trigger-replacement",
    on: "covered",
    resolve: function* (ctx) {
      const line = h.lineOfThis(ctx);
      if (line === null) return;
      const others = h.otherLines(line);
      if (others.length === 0) return;
      const dest = yield* ctx.promptLine({ allowedLines: others, reason: "life-3-line" });
      yield* h.playTopOfDeckFaceDown(ctx, ctx.self, dest);
    },
  },
};

const life4: CardDef = {
  protocol: "life",
  value: 4,
  top: null,
  middle: function* (ctx) {
    const loc = findCardOnField(ctx.state(), ctx.thisInstanceId);
    if (loc && loc.stackIdx > 0) {
      yield* ctx.draw(1);
    }
  },
  bottom: null,
};

const life5: CardDef = {
  protocol: "life",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const lifeCards: CardDef[] = [life0, life1, life2, life3, life4, life5];
for (const c of lifeCards) registerCard(c);
