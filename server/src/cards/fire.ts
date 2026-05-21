/**
 * Fire protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Flip 1 other card. Draw 2 cards.
 *     Bottom: When this card would be covered: First, draw 1 card and flip 1 other card.
 * 1 — Middle: Discard 1 card. If you do, delete 1 card.
 * 2 — Middle: Discard 1 card. If you do, return 1 card.
 * 3 — Bottom: End: You may discard 1 card. If you do, flip 1 card.
 * 4 — Middle: Discard 1 or more cards. Draw the amount discarded plus 1.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";

const fire0: CardDef = {
  protocol: "fire",
  value: 0,
  top: null,
  middle: function* (ctx) {
    yield* h.flipChosen(ctx, { excludeInstanceId: ctx.thisInstanceId });
    yield* ctx.draw(2);
  },
  bottom: {
    kind: "trigger-replacement",
    on: "covered",
    resolve: function* (ctx) {
      yield* ctx.draw(1);
      yield* h.flipChosen(ctx, { excludeInstanceId: ctx.thisInstanceId });
    },
  },
};

const fire1: CardDef = {
  protocol: "fire",
  value: 1,
  top: null,
  middle: function* (ctx) {
    // "Discard 1 card. If you do, delete 1 card." The discard is mandatory
    // whenever the hand has cards; "if you do" only gates the delete in the
    // empty-hand case (where you can't discard at all).
    if (ctx.myHand().length === 0) return;
    yield* h.discardSelfN(ctx, 1);
    yield* h.deleteChosen(ctx, {});
  },
  bottom: null,
};

const fire2: CardDef = {
  protocol: "fire",
  value: 2,
  top: null,
  middle: function* (ctx) {
    // "Discard 1 card. If you do, return 1 card." Same shape as Fire 1.
    if (ctx.myHand().length === 0) return;
    yield* h.discardSelfN(ctx, 1);
    yield* h.returnChosen(ctx, {});
  },
  bottom: null,
};

const fire3: CardDef = {
  protocol: "fire",
  value: 3,
  top: null,
  middle: null,
  bottom: {
    kind: "trigger-phase",
    phase: "end",
    resolve: function* (ctx) {
      const did = yield* h.mayDiscardSelfN(ctx, 1, "fire-3-end");
      if (did) yield* h.flipChosen(ctx, {});
    },
  },
};

const fire4: CardDef = {
  protocol: "fire",
  value: 4,
  top: null,
  middle: function* (ctx) {
    const n = yield* h.discardSelfOneOrMore(ctx, "fire-4");
    if (n > 0) yield* ctx.draw(n + 1);
  },
  bottom: null,
};

const fire5: CardDef = {
  protocol: "fire",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const fireCards: CardDef[] = [fire0, fire1, fire2, fire3, fire4, fire5];
for (const c of fireCards) registerCard(c);
