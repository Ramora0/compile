/**
 * Gravity protocol — 6 cards (values 0, 1, 2, 4, 5, 6).
 *
 * 0 — Middle: For every 2 cards in this line, play the top card of your deck face-down under this card.
 * 1 — Middle: Draw 2 cards. Shift 1 card either to or from this line.
 * 2 — Middle: Flip 1 card. Shift that card to this line.
 * 4 — Middle: Shift 1 face-down card to this line.
 * 5 — Middle: You discard 1 card.
 * 6 — Middle: Your opponent plays the top card of their deck face-down in this line.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";

const gravity0: CardDef = {
  protocol: "gravity",
  value: 0,
  top: null,
  middle: function* (ctx) {
    const thisLine = h.lineOfThis(ctx);
    if (thisLine === null) return;
    // Count includes Gravity 0 itself (it's already on the stack when middle
    // resolves), matching the rules-text reading of "cards in this line".
    const count = h.lineSizeBothSides(ctx.state(), thisLine);
    const plays = Math.floor(count / 2);
    for (let i = 0; i < plays; i++) {
      // "under this card" — Gravity 0 stays on top while each new card lands
      // beneath it, covered from the moment it arrives.
      yield* h.playTopOfDeckFaceDown(ctx, ctx.self, thisLine, ctx.thisInstanceId);
    }
  },
  bottom: null,
};

const gravity1: CardDef = {
  protocol: "gravity",
  value: 1,
  top: null,
  middle: function* (ctx) {
    yield* ctx.draw(2);
    const thisLine = h.lineOfThis(ctx);
    if (thisLine === null) return;
    const choice = yield* ctx.promptOption({
      options: [
        { id: "to", label: "Shift 1 card to this line" },
        { id: "from", label: "Shift 1 card from this line" },
      ],
      reason: "gravity1-shift-direction",
    });
    if (choice === "to") {
      yield* h.shiftChosen(
        ctx,
        { where: (e) => e.lineIdx !== thisLine },
        { destLine: thisLine },
      );
    } else {
      yield* h.shiftChosen(ctx, { inLines: [thisLine] });
    }
  },
  bottom: null,
};

const gravity2: CardDef = {
  protocol: "gravity",
  value: 2,
  top: null,
  middle: function* (ctx) {
    const thisLine = h.lineOfThis(ctx);
    if (thisLine === null) return;
    const id = yield* h.flipChosen(ctx, {});
    if (id) yield* ctx.shift(id, thisLine);
  },
  bottom: null,
};

const gravity4: CardDef = {
  protocol: "gravity",
  value: 4,
  top: null,
  middle: function* (ctx) {
    const thisLine = h.lineOfThis(ctx);
    if (thisLine === null) return;
    yield* h.shiftChosen(ctx, { faceDown: true }, { destLine: thisLine });
  },
  bottom: null,
};

const gravity5: CardDef = {
  protocol: "gravity",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

const gravity6: CardDef = {
  protocol: "gravity",
  value: 6,
  top: null,
  middle: function* (ctx) {
    const thisLine = h.lineOfThis(ctx);
    if (thisLine === null) return;
    yield* h.playTopOfDeckFaceDown(ctx, ctx.opp, thisLine);
  },
  bottom: null,
};

export const gravityCards: CardDef[] = [gravity0, gravity1, gravity2, gravity4, gravity5, gravity6];
for (const c of gravityCards) registerCard(c);
