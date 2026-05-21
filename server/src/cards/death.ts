/**
 * Death protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Delete 1 card from each other line.
 * 1 — Top (Start): You may draw 1 card. If you do, delete 1 other card,
 *     then delete this card.
 * 2 — Middle: Delete all cards in 1 line with values of 1 or 2.
 * 3 — Middle: Delete 1 face-down card.
 * 4 — Middle: Delete a card with a value of 0 or 1.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";

const death0: CardDef = {
  protocol: "death",
  value: 0,
  top: null,
  middle: function* (ctx) {
    const thisLine = h.lineOfThis(ctx);
    if (thisLine === null) return;
    for (const l of h.otherLines(thisLine)) {
      yield* h.deleteChosen(ctx, { inLines: [l] });
    }
  },
  bottom: null,
};

const death1: CardDef = {
  protocol: "death",
  value: 1,
  top: {
    kind: "trigger-phase",
    phase: "start",
    resolve: function* (ctx) {
      if (!(yield* h.confirm(ctx, "Draw 1", "death1-may-draw"))) return;
      // "You may draw 1 card. If you do, delete 1 other card, then delete
      // this card." The "if you do" clause only fires when a draw actually
      // happened — i.e. the deck (after trash reshuffle) had a card to give.
      const drawn = yield* ctx.draw(1);
      if (drawn.length === 0) return;
      yield* h.deleteChosen(ctx, { excludeInstanceId: ctx.thisInstanceId });
      yield* ctx.delete(ctx.thisInstanceId);
    },
  },
  middle: null,
  bottom: null,
};

const death2: CardDef = {
  protocol: "death",
  value: 2,
  top: null,
  middle: function* (ctx) {
    const chosenLine = yield* ctx.promptLine({
      allowedLines: [0, 1, 2],
      reason: "death2-delete-line",
    });
    // "Values of 1 or 2" — effective value, so face-down cards (default 2)
    // are eligible. Darkness 2 in the line lifts face-downs to 4 and makes
    // them ineligible, which is exactly the intended interaction.
    yield* h.deleteAllMatching(ctx, {
      inLines: [chosenLine],
      valueIn: [1, 2],
    });
  },
  bottom: null,
};

const death3: CardDef = {
  protocol: "death",
  value: 3,
  top: null,
  middle: function* (ctx) {
    yield* h.deleteChosen(ctx, { faceDown: true });
  },
  bottom: null,
};

const death4: CardDef = {
  protocol: "death",
  value: 4,
  top: null,
  middle: function* (ctx) {
    // "A card with a value of 0 or 1" — effective value. No face-down value
    // defaults to 0 or 1 today, but reading it as effective keeps the door
    // open to future overrides without changing this card.
    yield* h.deleteChosen(ctx, { valueIn: [0, 1] });
  },
  bottom: null,
};

const death5: CardDef = {
  protocol: "death",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const deathCards: CardDef[] = [death0, death1, death2, death3, death4, death5];
for (const c of deathCards) registerCard(c);
