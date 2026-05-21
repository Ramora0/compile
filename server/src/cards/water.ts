/**
 * Water protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Flip 1 other card. Flip this card.
 * 1 — Middle: Play the top card of your deck face-down in each other line.
 * 2 — Middle: Draw 2 cards. Rearrange your protocols.
 * 3 — Middle: Return all cards with a value of 2 in 1 line.
 * 4 — Middle: Return 1 of your cards.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";

const water0: CardDef = {
  protocol: "water",
  value: 0,
  top: null,
  middle: function* (ctx) {
    yield* h.flipChosen(ctx, { excludeInstanceId: ctx.thisInstanceId });
    yield* ctx.flip(ctx.thisInstanceId);
  },
  bottom: null,
};

const water1: CardDef = {
  protocol: "water",
  value: 1,
  top: null,
  middle: function* (ctx) {
    const thisLine = h.lineOfThis(ctx);
    if (thisLine === null) return;
    for (const l of h.otherLines(thisLine)) {
      yield* h.playTopOfDeckFaceDown(ctx, ctx.self, l);
    }
  },
  bottom: null,
};

const water2: CardDef = {
  protocol: "water",
  value: 2,
  top: null,
  middle: function* (ctx) {
    yield* ctx.draw(2);
    yield* h.rearrangeProtocolsPrompt(ctx, ctx.self);
  },
  bottom: null,
};

const water3: CardDef = {
  protocol: "water",
  value: 3,
  top: null,
  middle: function* (ctx) {
    const line = yield* ctx.promptLine({ allowedLines: [0, 1, 2], reason: "water-3-line" });
    // "All cards with a value of 2" — effective value. Face-down cards
    // default to 2 (so they're returned), unless Darkness 2 raises them to 4
    // in this line (then they're not).
    yield* h.returnAllMatching(ctx, { inLines: [line], valueIn: [2] });
  },
  bottom: null,
};

const water4: CardDef = {
  protocol: "water",
  value: 4,
  top: null,
  middle: function* (ctx) {
    yield* h.returnChosen(ctx, { side: "self" });
  },
  bottom: null,
};

const water5: CardDef = {
  protocol: "water",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const waterCards: CardDef[] = [water0, water1, water2, water3, water4, water5];
for (const c of waterCards) registerCard(c);
