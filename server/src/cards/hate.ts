/**
 * Hate protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Delete 1 card.
 * 1 — Middle: Discard 3 cards. Delete 1 card. Delete 1 card.
 * 2 — Middle: Delete your highest value card. Delete your opponent's highest value card.
 * 3 — Top: After you delete cards: Draw 1 card.
 * 4 — Bottom: When this card would be covered: First, delete the lowest value
 *     covered card in this line.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";

const hate0: CardDef = {
  protocol: "hate",
  value: 0,
  top: null,
  middle: function* (ctx) {
    yield* h.deleteChosen(ctx, {});
  },
  bottom: null,
};

const hate1: CardDef = {
  protocol: "hate",
  value: 1,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 3);
    yield* h.deleteChosen(ctx, {});
    yield* h.deleteChosen(ctx, {});
  },
  bottom: null,
};

const hate2: CardDef = {
  protocol: "hate",
  value: 2,
  top: null,
  middle: function* (ctx) {
    const mine = h.highestValueCardOf(ctx.state(), ctx.self);
    if (mine) yield* ctx.delete(mine.instanceId);
    const theirs = h.highestValueCardOf(ctx.state(), ctx.opp);
    if (theirs) yield* ctx.delete(theirs.instanceId);
  },
  bottom: null,
};

const hate3: CardDef = {
  protocol: "hate",
  value: 3,
  top: {
    kind: "trigger-reactive",
    on: "after-delete",
    scope: "self",
    resolve: function* (ctx) {
      yield* ctx.draw(1);
    },
  },
  middle: null,
  bottom: null,
};

const hate4: CardDef = {
  protocol: "hate",
  value: 4,
  top: null,
  middle: null,
  bottom: {
    kind: "trigger-replacement",
    on: "covered",
    resolve: function* (ctx) {
      const line = h.lineOfThis(ctx);
      if (line === null) return;
      const target = h.lowestCoveredOfLine(ctx.state(), ctx.self, line);
      if (target) yield* ctx.delete(target.instanceId);
    },
  },
};

const hate5: CardDef = {
  protocol: "hate",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const hateCards: CardDef[] = [hate0, hate1, hate2, hate3, hate4, hate5];
for (const c of hateCards) registerCard(c);
