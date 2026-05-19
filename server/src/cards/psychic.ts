/**
 * Psychic protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Draw 2 cards. Your opponent discards 2 cards, then reveals their hand.
 * 1 — Top: Your opponent can only play cards face-down.
 *     Bottom: Start: Flip this card.
 * 2 — Middle: Your opponent discards 2 cards. Rearrange their protocols.
 * 3 — Middle: Your opponent discards 1 card. Shift 1 of their cards.
 * 4 — Bottom: End: You may return 1 of your opponent's cards. If you do, flip this card.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";

const psychic0: CardDef = {
  protocol: "psychic",
  value: 0,
  top: null,
  middle: function* (ctx) {
    yield* ctx.draw(2);
    yield* h.discardOppN(ctx, 2);
    yield* h.revealOppHand(ctx);
  },
  bottom: null,
};

const psychic1: CardDef = {
  protocol: "psychic",
  value: 1,
  top: {
    kind: "static-rule",
    apply: (ctx) => ({
      kind: "play-restriction",
      lineIdx: "any",
      affects: ctx.opp,
      forbid: "face-up",
    }),
  },
  middle: null,
  bottom: {
    kind: "trigger-phase",
    phase: "start",
    resolve: function* (ctx) {
      yield* ctx.flip(ctx.thisInstanceId);
    },
  },
};

const psychic2: CardDef = {
  protocol: "psychic",
  value: 2,
  top: null,
  middle: function* (ctx) {
    yield* h.discardOppN(ctx, 2);
    yield* h.rearrangeProtocolsPrompt(ctx, ctx.opp);
  },
  bottom: null,
};

const psychic3: CardDef = {
  protocol: "psychic",
  value: 3,
  top: null,
  middle: function* (ctx) {
    yield* h.discardOppN(ctx, 1);
    yield* h.shiftChosen(ctx, { side: "opp" });
  },
  bottom: null,
};

const psychic4: CardDef = {
  protocol: "psychic",
  value: 4,
  top: null,
  middle: null,
  bottom: {
    kind: "trigger-phase",
    phase: "end",
    resolve: function* (ctx) {
      const returned = yield* h.returnChosen(ctx, { side: "opp" }, { optional: true });
      if (returned) yield* ctx.flip(ctx.thisInstanceId);
    },
  },
};

const psychic5: CardDef = {
  protocol: "psychic",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const psychicCards: CardDef[] = [psychic0, psychic1, psychic2, psychic3, psychic4, psychic5];
for (const c of psychicCards) registerCard(c);
