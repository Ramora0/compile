/**
 * Light protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Flip 1 card. Draw cards equal to that card's value.
 * 1 — Bottom: End: Draw 1 card.
 * 2 — Middle: Draw 2 cards. Reveal 1 face-down card. You may shift or flip that card.
 * 3 — Middle: Shift all face-down cards in this line to another line.
 * 4 — Middle: Your opponent reveals their hand.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";
import { cardValue, findCardOnField } from "../engine/field.js";
import type { CardInstance } from "../engine/types.js";

const light0: CardDef = {
  protocol: "light",
  value: 0,
  top: null,
  middle: function* (ctx) {
    // Snapshot the target BEFORE yielding the flip. The flip resolves any
    // cascading middle text (which can move or delete the card outright); the
    // "that card's value" reference should still hold even if the cascade
    // erases the card. We compute the value the card WILL have after the flip
    // — flipping a face-down card reveals its printed value; flipping a
    // face-up card produces the face-down value for that line (default 2,
    // raised to 4 by a Darkness 2 override).
    const id = yield* h.chooseField(ctx, {}, { reason: "flip" });
    if (!id) return;
    const loc = findCardOnField(ctx.state(), id);
    if (!loc) return;
    const card = ctx.state().stacks[loc.playerIdx][loc.lineIdx].cards[loc.stackIdx];
    if (!card) return;
    const flipped: CardInstance = { ...card, faceDown: !card.faceDown };
    const drawCount = cardValue(ctx.state(), flipped, loc.playerIdx, loc.lineIdx);
    yield* ctx.flip(id);
    if (drawCount > 0) yield* ctx.draw(drawCount);
  },
  bottom: null,
};

const light1: CardDef = {
  protocol: "light",
  value: 1,
  top: null,
  middle: null,
  bottom: {
    kind: "trigger-phase",
    phase: "end",
    resolve: function* (ctx) {
      yield* ctx.draw(1);
    },
  },
};

const light2: CardDef = {
  protocol: "light",
  value: 2,
  top: null,
  middle: function* (ctx) {
    yield* ctx.draw(2);
    yield* h.revealThenMayShiftOrFlip(ctx, { faceDown: true });
  },
  bottom: null,
};

const light3: CardDef = {
  protocol: "light",
  value: 3,
  top: null,
  middle: function* (ctx) {
    const line = h.lineOfThis(ctx);
    if (line === null) return;
    const others = h.otherLines(line);
    if (others.length === 0) return;
    const dest = yield* ctx.promptLine({ allowedLines: others, reason: "light-3-dest" });
    yield* h.shiftAllMatching(ctx, { faceDown: true, inLines: [line] }, dest);
  },
  bottom: null,
};

const light4: CardDef = {
  protocol: "light",
  value: 4,
  top: null,
  middle: function* (ctx) {
    yield* h.revealOppHand(ctx);
  },
  bottom: null,
};

const light5: CardDef = {
  protocol: "light",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const lightCards: CardDef[] = [light0, light1, light2, light3, light4, light5];
for (const c of lightCards) registerCard(c);
