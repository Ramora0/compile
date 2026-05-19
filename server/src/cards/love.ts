/**
 * Love protocol — 6 cards (values 1–6; no value 0).
 *
 * 1 — Middle: Draw the top card of your opponent's deck.
 *     Bottom: End: You may give 1 card from your hand to your opponent. If you do, draw 2 cards.
 * 2 — Middle: Your opponent draws 1 card. Refresh.
 * 3 — Middle: Take 1 random card from your opponent's hand. Give 1 card from your hand to your opponent.
 * 4 — Middle: Reveal 1 card from your hand. Flip 1 card.
 * 5 — Middle: You discard 1 card.
 * 6 — Middle: Your opponent draws 2 cards.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";

const love1: CardDef = {
  protocol: "love",
  value: 1,
  top: null,
  middle: function* (ctx) {
    // "Draw the top card of your opponent's deck."
    // No engine Op exists for transferring directly from an opponent's deck to
    // self's hand, so mutate state directly. Reshuffle opp's trash into deck
    // if their deck is empty (mirrors the runtime's own draw behavior).
    const state = ctx.state();
    const opp = state.players[ctx.opp];
    if (opp.deck.length === 0 && opp.trash.length > 0) {
      opp.deck = opp.trash.splice(0);
    }
    const card = opp.deck.pop();
    if (card) {
      // Ownership transfers per rules.md:106 (give/take retains ownership).
      card.ownerIdx = ctx.self;
      state.players[ctx.self].hand.push(card);
    }
  },
  bottom: {
    kind: "trigger-phase",
    phase: "end",
    resolve: function* (ctx) {
      const did = yield* h.mayGiveOneToOpp(ctx, "love-1-end");
      if (did) yield* ctx.draw(2);
    },
  },
};

const love2: CardDef = {
  protocol: "love",
  value: 2,
  top: null,
  middle: function* (ctx) {
    yield* ctx.draw(1, ctx.opp);
    yield* ctx.refresh();
  },
  bottom: null,
};

const love3: CardDef = {
  protocol: "love",
  value: 3,
  top: null,
  middle: function* (ctx) {
    h.takeRandomFromOpp(ctx.state(), ctx.self);
    yield* h.mayGiveOneToOpp(ctx, "love-3-give");
  },
  bottom: null,
};

const love4: CardDef = {
  protocol: "love",
  value: 4,
  top: null,
  middle: function* (ctx) {
    yield* h.revealOneFromOwnHand(ctx);
    yield* h.flipChosen(ctx, {});
  },
  bottom: null,
};

const love5: CardDef = {
  protocol: "love",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

const love6: CardDef = {
  protocol: "love",
  value: 6,
  top: null,
  middle: function* (ctx) {
    yield* ctx.draw(2, ctx.opp);
  },
  bottom: null,
};

export const loveCards: CardDef[] = [love1, love2, love3, love4, love5, love6];
for (const c of loveCards) registerCard(c);
