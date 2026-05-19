/**
 * Darkness protocol — 6 cards (values 0–5).
 *
 * 0 — Middle: Draw 3 cards. Shift 1 of your opponent's covered cards.
 * 1 — Middle: Flip 1 of your opponent's cards. You may shift that card.
 * 2 — Top:    All face-down cards in this stack have a value of 4.
 *     Middle: You may flip 1 covered card in this line.
 * 3 — Middle: Play 1 card face-down in another line.
 * 4 — Middle: Shift 1 face-down card.
 * 5 — Middle: You discard 1 card.
 */

import { registerCard, type CardDef } from "./api.js";
import * as h from "./helpers.js";
import { lineOf } from "./helpers.js";
import { findCardOnField } from "../engine/field.js";
import type { LineIdx } from "../engine/types.js";

const darkness0: CardDef = {
  protocol: "darkness",
  value: 0,
  top: null,
  middle: function* (ctx) {
    yield* ctx.draw(3);
    yield* h.shiftChosen(ctx, { side: "opp", covered: true });
  },
  bottom: null,
};

const darkness1: CardDef = {
  protocol: "darkness",
  value: 1,
  top: null,
  middle: function* (ctx) {
    const id = yield* h.flipChosen(ctx, { side: "opp" });
    if (!id) return;
    const loc = findCardOnField(ctx.state(), id);
    if (!loc) return;
    const choice = yield* ctx.promptOption({
      options: [
        { id: "yes", label: "Shift it" },
        { id: "no", label: "Skip" },
      ],
      reason: "darkness1-shift",
    });
    if (choice !== "yes") return;
    const allowed: LineIdx[] = ([0, 1, 2] as LineIdx[]).filter((l) => l !== loc.lineIdx);
    if (allowed.length === 0) return;
    const toLine = yield* ctx.promptLine({ allowedLines: allowed, reason: "shift-to" });
    yield* ctx.shift(id, toLine);
  },
  bottom: null,
};

const darkness2: CardDef = {
  protocol: "darkness",
  value: 2,
  top: {
    kind: "static-rule",
    apply: (ctx) => {
      const line = lineOf(ctx.state, ctx.thisInstanceId);
      const lineIdx: LineIdx = line ?? 0;
      return {
        kind: "face-down-value",
        lineIdx,
        ownerIdx: ctx.self,
        value: 4,
      };
    },
  },
  middle: function* (ctx) {
    const line = h.lineOfThis(ctx);
    if (line === null) {
      yield* h.flipChosen(ctx, { covered: true }, { optional: true });
      return;
    }
    yield* h.flipChosen(
      ctx,
      { covered: true, inLines: [line] },
      { optional: true },
    );
  },
  bottom: null,
};

const darkness3: CardDef = {
  protocol: "darkness",
  value: 3,
  top: null,
  middle: function* (ctx) {
    const hand = ctx.myHand();
    if (hand.length === 0) return;
    const id = yield* ctx.promptCard({
      filter: { instanceIds: hand.map((c) => c.instanceId) },
      optional: false,
      reason: "darkness3-play",
    });
    if (!id) return;
    const thisLine = h.lineOfThis(ctx);
    const allowed: LineIdx[] =
      thisLine === null ? [0, 1, 2] : h.otherLines(thisLine);
    if (allowed.length === 0) return;
    const lineIdx = yield* ctx.promptLine({
      allowedLines: allowed,
      reason: "darkness3-line",
    });
    yield* ctx.play({ instanceId: id, lineIdx, faceDown: true });
  },
  bottom: null,
};

const darkness4: CardDef = {
  protocol: "darkness",
  value: 4,
  top: null,
  middle: function* (ctx) {
    yield* h.shiftChosen(ctx, { faceDown: true });
  },
  bottom: null,
};

const darkness5: CardDef = {
  protocol: "darkness",
  value: 5,
  top: null,
  middle: function* (ctx) {
    yield* h.discardSelfN(ctx, 1);
  },
  bottom: null,
};

export const darknessCards: CardDef[] = [
  darkness0,
  darkness1,
  darkness2,
  darkness3,
  darkness4,
  darkness5,
];
for (const c of darknessCards) registerCard(c);
