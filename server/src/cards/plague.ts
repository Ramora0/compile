/**
 * Plague protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Your opponent discards 1 card.
 *     Bottom: Your opponent cannot play cards in this line.
 * 1 — Top: After your opponent discards cards: Draw 1 card.
 *     Middle: Your opponent discards 1 card.
 * 2 — Middle: Discard 1 or more cards. Your opponent discards the amount of
 *             cards discarded plus 1.
 * 3 — Middle: Flip each other face-up card.
 * 4 — Bottom: End: Your opponent deletes 1 of their face-down cards. You may
 *             flip this card.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";
import { lineOf } from "./helpers.js";
import type { LineIdx } from "../engine/types.js";

const plague0: CardDef = {
  protocol: "plague",
  value: 0,
  top: null,
  middle: function* (ctx) {
    yield* h.discardOppN(ctx, 1);
  },
  bottom: {
    kind: "static-rule",
    apply: (ctx) => {
      const line = lineOf(ctx.state, ctx.thisInstanceId);
      const lineIdx: LineIdx = line ?? 0;
      return {
        kind: "play-restriction",
        lineIdx,
        affects: ctx.opp,
        forbid: "any-card",
      };
    },
  },
};

const plague1: CardDef = {
  protocol: "plague",
  value: 1,
  top: {
    kind: "trigger-reactive",
    on: "after-discard",
    scope: "opp",
    resolve: function* (ctx) {
      yield* ctx.draw(1);
    },
  },
  middle: function* (ctx) {
    yield* h.discardOppN(ctx, 1);
  },
  bottom: null,
};

const plague2: CardDef = {
  protocol: "plague",
  value: 2,
  top: null,
  middle: function* (ctx) {
    const n = yield* h.discardSelfOneOrMore(ctx, "plague-2");
    yield* h.discardOppN(ctx, n + 1);
  },
  bottom: null,
};

const plague3: CardDef = {
  protocol: "plague",
  value: 3,
  top: null,
  middle: function* (ctx) {
    yield* h.flipAllMatching(ctx, {
      faceUp: true,
      excludeInstanceId: ctx.thisInstanceId,
    });
  },
  bottom: null,
};

const plague4: CardDef = {
  protocol: "plague",
  value: 4,
  top: null,
  middle: null,
  bottom: {
    kind: "trigger-phase",
    phase: "end",
    resolve: function* (ctx) {
      // deleteChosen silently skips when no candidates exist — important here
      // because the opponent might have no face-down cards. The opponent picks
      // the card to delete (forPlayerIdx: ctx.opp).
      yield* h.deleteChosen(
        ctx,
        { side: "opp", faceDown: true },
        { reason: "plague-4-opp-delete", forPlayerIdx: ctx.opp },
      );
      if (yield* h.confirm(ctx, "Flip Plague 4", "plague-4-may-flip")) {
        yield* ctx.flip(ctx.thisInstanceId);
      }
    },
  },
};

const plague5: CardDef = {
  protocol: "plague",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const plagueCards: CardDef[] = [plague0, plague1, plague2, plague3, plague4, plague5];
for (const c of plagueCards) registerCard(c);
