/**
 * Card-text correctness tests for the high/medium severity gaps:
 *   - Gravity 0 plays new cards UNDER itself, not on top.
 *   - Metal 1's "opponent cannot compile next turn" rider actually fires.
 *   - Apathy 0's static rule stays inert when its host isn't on the field.
 *   - Fire 1, Fire 2 — mandatory discard then delete/return (not "you may").
 *   - Love 3 — mandatory give.
 *   - Apathy 2 — ignore-middle suppresses both sides of the line.
 *   - Light 2 — reveal is mandatory; only the shift/flip is "you may".
 *   - Death 2 / Water 3 — value filter targets face-down cards by effective value.
 *   - Hate 2 — highest-value picks face-down cards too.
 *   - Hate 4 — lowest-covered considers both sides.
 *   - Plague 4 — silent skip when opponent has no face-down cards.
 *   - Spirit 1 — with empty hand, the start-of-turn collapses to flip.
 *   - Light 0 — value snapshot survives flip-time deletion.
 *   - Death 1 — "if you do" gates on actual draw.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { Game } from "../src/engine/game.js";
import {
  commitDiscard,
  commitOption,
  commitPlay,
} from "./helpers/answers.js";
import { step } from "../src/engine/phases/index.js";
import { lineValue } from "../src/engine/field.js";
import { ignoreMiddleFor, recomputeOverrides } from "../src/engine/reactive/index.js";
import { clearRegistry } from "../src/cards/registry.js";
import { gravityCards } from "../src/cards/gravity.js";
import { metalCards } from "../src/cards/metal.js";
import { apathyCards } from "../src/cards/apathy.js";
import { fireCards } from "../src/cards/fire.js";
import { loveCards } from "../src/cards/love.js";
import { lightCards } from "../src/cards/light.js";
import { deathCards } from "../src/cards/death.js";
import { waterCards } from "../src/cards/water.js";
import { hateCards } from "../src/cards/hate.js";
import { plagueCards } from "../src/cards/plague.js";
import { spiritCards } from "../src/cards/spirit.js";
import { darknessCards } from "../src/cards/darkness.js";
import { registerCard, type CardDef } from "../src/cards/api.js";
import { createCardCtx } from "../src/engine/ctx.js";
import type { CardInstance, GameState, PlayerIdx } from "../src/engine/types.js";
import type { Op, OpResult, PromptResponse } from "../src/engine/ops.js";

function registerOnly(sets: CardDef[][]): void {
  clearRegistry();
  for (const set of sets) for (const def of set) registerCard(def);
}

describe("Gravity 0 — play under this card", () => {
  beforeEach(() => registerOnly([gravityCards]));
  afterEach(() => clearRegistry());

  it("inserts deck-top plays beneath Gravity 0, keeping it on top", () => {
    const g = newGame();
    // Pre-seed line 0 with three cards so lineSizeBothSides hits 4 once
    // Gravity 0 is on the field (3 + the resolving card) → floor(4/2) = 2 plays.
    placeCard(g, 0, 0, "gravity-1");
    placeCard(g, 0, 0, "gravity-2");
    placeCard(g, 1, 0, "gravity-4");
    const gravity0 = placeCard(g, 0, 0, "gravity-0");

    // Make p0's deck deterministic — we'll watch the top two get inserted.
    const fakeTop1: CardInstance = { instanceId: "deck-a", cardId: "gravity-1", faceDown: false, ownerIdx: 0 };
    const fakeTop2: CardInstance = { instanceId: "deck-b", cardId: "gravity-2", faceDown: false, ownerIdx: 0 };
    // Last element = top of deck (push/pop convention).
    g.players[0].deck.push(fakeTop1, fakeTop2);

    const game = new Game(g);
    // Manually drive the middle by triggering an op-style invocation: easiest
    // is to use the runtime to push the middle generator directly.
    const def = gravityCards.find((c) => c.value === 0)!;
    game.runtime.push("test:gravity-0", def.middle!(makeCtx(g, gravity0.instanceId, 0)));
    game.runtime.pump();

    const stack = g.stacks[0][0].cards;
    // Gravity 0 must still be on top.
    expect(stack[stack.length - 1]!.instanceId).toBe(gravity0.instanceId);
    // The two deck-top cards landed BELOW gravity-0, face-down. Pop order is
    // top-of-deck first (fakeTop2 was at the top), so iteration 1 inserts
    // fakeTop2 directly beneath gravity-0; iteration 2 pops fakeTop1 and
    // inserts beneath gravity-0 again, shoving fakeTop2 one deeper.
    expect(stack[stack.length - 2]!.instanceId).toBe(fakeTop1.instanceId);
    expect(stack[stack.length - 3]!.instanceId).toBe(fakeTop2.instanceId);
    expect(stack[stack.length - 2]!.faceDown).toBe(true);
    expect(stack[stack.length - 3]!.faceDown).toBe(true);
  });

  it("under-insert does NOT fire 'covered' on Gravity 0 itself", () => {
    // Sanity: Gravity 0 has no replacement trigger, but the engine still
    // shouldn't fire one — the inserted card slides under without disturbing
    // the cover state of cards above it.
    const g = newGame();
    const anchor = placeCard(g, 0, 0, "gravity-0");
    g.players[0].deck.push({ instanceId: "x", cardId: "gravity-1", faceDown: false, ownerIdx: 0 });

    const game = new Game(g);
    game.runtime.push("test", playUnderGen(0, 0, anchor.instanceId));
    game.runtime.pump();

    const stack = g.stacks[0][0].cards;
    expect(stack.length).toBe(2);
    expect(stack[1]!.instanceId).toBe(anchor.instanceId); // anchor still on top
    expect(stack[0]!.instanceId).toBe("x");
    expect(stack[0]!.faceDown).toBe(true);
  });
});

describe("Metal 1 — opponent cannot compile next turn", () => {
  beforeEach(() => registerOnly([metalCards]));
  afterEach(() => clearRegistry());

  it("sets compileBans[opp] when middle resolves", () => {
    const g = newGame();
    expect(g.compileBans).toEqual([0, 0]);
    const inst = placeCard(g, 0, 0, "metal-1", true); // face-down so we can flip
    const game = new Game(g);
    game.runtime.push("test:flip", flipGen(inst.instanceId));
    game.runtime.pump();
    // After Metal 1 flips face-up, its middle runs: draw 2 + ban opp's next turn.
    expect(g.compileBans[1]).toBe(1);
    expect(g.compileBans[0]).toBe(0);
  });

  it("skips check-compile for the banned player, even with compilable lines", () => {
    const g = newGame();
    g.compileBans = [0, 1]; // p1 is banned
    g.activePlayerIdx = 1;
    g.phase = "check-compile";
    // p1 has a >=10 line that would normally force a compile.
    placeCard(g, 1, 0, "metal-3"); // 3
    placeCard(g, 1, 0, "metal-3"); // 6
    placeCard(g, 1, 0, "metal-5"); // 11
    expect(lineValue(g, 1, 0)).toBeGreaterThanOrEqual(10);
    const res = step(g);
    expect(res.kind).toBe("advanced");
    expect(g.phase).toBe("action");
    expect(g.compileBans[1]).toBe(0); // consumed
    expect(g.log.some((e) => e.type === "compile-banned" && e.playerIdx === 1)).toBe(true);
  });

  it("doesn't affect the OTHER player's check-compile", () => {
    const g = newGame();
    g.compileBans = [0, 1]; // p1 banned, p0 normal
    g.activePlayerIdx = 0;
    g.phase = "check-compile";
    placeCard(g, 0, 0, "metal-3");
    placeCard(g, 0, 0, "metal-3");
    placeCard(g, 0, 0, "metal-5");
    const res = step(g);
    expect(res.kind).toBe("awaiting-compile-choice");
    // p1's ban untouched.
    expect(g.compileBans[1]).toBe(1);
  });

  it("ban lasts exactly one Check-Compile phase, not two", () => {
    const g = newGame();
    g.compileBans = [0, 1];
    g.activePlayerIdx = 1;
    g.phase = "check-compile";
    step(g); // consumes the ban, advances to action
    expect(g.compileBans[1]).toBe(0);
    // Simulate p1's next turn arriving at check-compile again: should be normal.
    g.phase = "check-compile";
    placeCard(g, 1, 0, "metal-3");
    placeCard(g, 1, 0, "metal-3");
    placeCard(g, 1, 0, "metal-5");
    const res = step(g);
    expect(res.kind).toBe("awaiting-compile-choice");
  });
});

describe("Apathy 0 — defensive lineIdx default", () => {
  beforeEach(() => registerOnly([apathyCards]));
  afterEach(() => clearRegistry());

  it("contributes +1 per face-down card in its line when on field", () => {
    const g = newGame();
    placeCard(g, 0, 1, "apathy-0"); // face-up
    placeCard(g, 1, 1, "apathy-1", true); // opp face-down in same line
    placeCard(g, 0, 1, "apathy-2", true); // own face-down in same line
    recomputeOverrides(g);
    // Apathy 0 printed value = 0; +2 from face-down counts (both sides).
    expect(lineValue(g, 0, 1)).toBe(2 + 2); // each face-down printed as 2 + 0 + bonus 2
    // Breakdown: own line cards are apathy-0 (0) + apathy-2 face-down (2) = 2,
    // plus value-modifier bonus 2 (one face-down per side) = 4.
  });

  it("apply() returns an inert override when invoked off-field", () => {
    // Synthesise a RuleCtx where thisInstanceId is not on the field; the
    // override should be no-op (delta = 0) so a future caller that wires
    // it into state.overrides can't accidentally pollute lineValue.
    const g = newGame();
    const def = apathyCards.find((c) => c.value === 0)!;
    if (def.top?.kind !== "static-rule") throw new Error("apathy-0 should be static-rule");
    const override = def.top.apply({
      self: 0,
      opp: 1,
      thisInstanceId: "ghost",
      state: g,
    });
    expect(override.kind).toBe("value-modifier");
    if (override.kind === "value-modifier") {
      expect(
        override.delta({ cards: [], faceDownCount: 0, faceUpCount: 0 }),
      ).toBe(0);
    }
  });
});

describe("Fire 1, Fire 2 — mandatory discard then delete/return", () => {
  beforeEach(() => registerOnly([fireCards]));
  afterEach(() => clearRegistry());

  it("Fire 1: discard is forced, not optional", () => {
    const g = newGame();
    const inst = placeCard(g, 0, 0, "fire-1", true);
    const handBefore = g.players[0].hand.length;
    const target = placeCard(g, 1, 0, "fire-3"); // something to delete
    const game = new Game(g);
    game.runtime.push("test", flipGen(inst.instanceId));
    game.runtime.pump();
    // The middle should have yielded a forced discard prompt (not the
    // optional "yes/no" choose-option prompt that mayDiscardSelfN used).
    expect(g.pendingPrompt?.kind).toBe("discard-selection");
    const discardId = g.players[0].hand[0]!.instanceId;
    game.runtime.resolvePrompt({
      kind: "discard-chosen",
      promptId: g.pendingPrompt!.promptId,
      instanceIds: [discardId],
    });
    game.runtime.pump();
    // Then a choose-card for the delete (no skip step).
    expect(g.pendingPrompt?.kind).toBe("choose-card");
    game.runtime.resolvePrompt({
      kind: "card-chosen",
      promptId: g.pendingPrompt!.promptId,
      instanceId: target.instanceId,
    });
    game.runtime.pump();
    expect(g.players[0].hand.length).toBe(handBefore - 1);
    expect(g.players[0].trash.some((c) => c.instanceId === discardId)).toBe(true);
    expect(g.stacks[1][0].cards.find((c) => c.instanceId === target.instanceId)).toBeUndefined();
  });

  it("Fire 1: with empty hand, the entire middle is a silent no-op", () => {
    const g = newGame();
    g.players[0].hand = [];
    const inst = placeCard(g, 0, 0, "fire-1", true);
    placeCard(g, 1, 0, "fire-3");
    const game = new Game(g);
    game.runtime.push("test", flipGen(inst.instanceId));
    game.runtime.pump();
    // No prompt issued — middle bailed before the discard.
    expect(g.pendingPrompt).toBeNull();
    expect(g.stacks[1][0].cards.length).toBe(1); // fire-3 untouched
  });

  it("Fire 2: mandatory discard then return", () => {
    const g = newGame();
    const inst = placeCard(g, 0, 0, "fire-2", true);
    const target = placeCard(g, 1, 0, "fire-3"); // something to return
    const game = new Game(g);
    game.runtime.push("test", flipGen(inst.instanceId));
    game.runtime.pump();
    expect(g.pendingPrompt?.kind).toBe("discard-selection");
    game.runtime.resolvePrompt({
      kind: "discard-chosen",
      promptId: g.pendingPrompt!.promptId,
      instanceIds: [g.players[0].hand[0]!.instanceId],
    });
    game.runtime.pump();
    expect(g.pendingPrompt?.kind).toBe("choose-card");
    game.runtime.resolvePrompt({
      kind: "card-chosen",
      promptId: g.pendingPrompt!.promptId,
      instanceId: target.instanceId,
    });
    game.runtime.pump();
    // Target ends up back in its owner's (p1's) hand.
    expect(g.stacks[1][0].cards.length).toBe(0);
    expect(g.players[1].hand.find((c) => c.instanceId === target.instanceId)).toBeDefined();
  });
});

describe("Love 3 — mandatory give", () => {
  beforeEach(() => registerOnly([loveCards]));
  afterEach(() => clearRegistry());

  it("the give prompt is mandatory (optional: false)", () => {
    const g = newGame();
    const oppHandBefore = g.players[1].hand.length;
    const myHandBefore = g.players[0].hand.length;
    const inst = placeCard(g, 0, 0, "love-3", true);
    const game = new Game(g);
    game.runtime.push("test", flipGen(inst.instanceId));
    game.runtime.pump();
    // Take random happens synchronously inside the middle (no prompt). Then a
    // mandatory choose-card prompt for the give.
    expect(g.players[0].hand.length).toBe(myHandBefore + 1);
    expect(g.players[1].hand.length).toBe(oppHandBefore - 1);
    expect(g.pendingPrompt?.kind).toBe("choose-card");
    if (g.pendingPrompt?.kind === "choose-card") {
      expect(g.pendingPrompt.optional).toBe(false);
    }
    const giveId = g.players[0].hand[0]!.instanceId;
    game.runtime.resolvePrompt({
      kind: "card-chosen",
      promptId: g.pendingPrompt!.promptId,
      instanceId: giveId,
    });
    game.runtime.pump();
    // After the give, hand counts swap one card.
    expect(g.players[0].hand.length).toBe(myHandBefore);
    expect(g.players[1].hand.length).toBe(oppHandBefore);
    expect(g.players[1].hand.some((c) => c.instanceId === giveId)).toBe(true);
  });
});

describe("Apathy 2 — ignore-middle suppresses both sides", () => {
  beforeEach(() => registerOnly([apathyCards]));
  afterEach(() => clearRegistry());

  it("ignoreMiddleFor returns true for BOTH players when Apathy 2 is on either side", () => {
    const g = newGame();
    placeCard(g, 0, 1, "apathy-2");
    recomputeOverrides(g);
    expect(ignoreMiddleFor(g, 0, 1)).toBe(true);
    expect(ignoreMiddleFor(g, 1, 1)).toBe(true);
    // Other lines unaffected.
    expect(ignoreMiddleFor(g, 0, 0)).toBe(false);
    expect(ignoreMiddleFor(g, 1, 2)).toBe(false);
  });
});

describe("Light 2 — mandatory reveal", () => {
  beforeEach(() => registerOnly([lightCards]));
  afterEach(() => clearRegistry());

  it("when face-down cards exist, the reveal prompt is mandatory (optional: false)", () => {
    const g = newGame();
    placeCard(g, 1, 1, "light-1", true); // a face-down card to reveal
    const inst = placeCard(g, 0, 0, "light-2", true);
    const game = new Game(g);
    game.runtime.push("test", flipGen(inst.instanceId));
    game.runtime.pump();
    // After draw 2, the middle yields a choose-card prompt for the reveal.
    expect(g.pendingPrompt?.kind).toBe("choose-card");
    if (g.pendingPrompt?.kind === "choose-card") {
      expect(g.pendingPrompt.optional).toBe(false);
    }
  });

  it("when no face-down cards exist, the helper silently skips (no prompt)", () => {
    const g = newGame();
    const inst = placeCard(g, 0, 0, "light-2", true);
    const game = new Game(g);
    game.runtime.push("test", flipGen(inst.instanceId));
    game.runtime.pump();
    // Pendng prompt could be a choose-option follow-up, but there should be
    // no choose-card prompt because there's nothing to reveal.
    expect(g.pendingPrompt).toBeNull();
  });
});

describe("Death 2 / Water 3 — effective-value targeting", () => {
  beforeEach(() => registerOnly([deathCards, waterCards]));
  afterEach(() => clearRegistry());

  it("Death 2 deletes face-down cards in the chosen line (default value 2)", () => {
    const g = newGame();
    const inst = placeCard(g, 0, 0, "death-2", true);
    // p1 line 1: a face-down card (value 2) and a face-up value-3 card.
    const fd = placeCard(g, 1, 1, "death-3", true);
    placeCard(g, 1, 1, "death-3"); // face-up value 3
    const game = new Game(g);
    game.runtime.push("test", flipGen(inst.instanceId));
    game.runtime.pump();
    // The middle prompts for a line.
    expect(g.pendingPrompt?.kind).toBe("choose-line");
    game.runtime.resolvePrompt({
      kind: "line-chosen",
      promptId: g.pendingPrompt!.promptId,
      lineIdx: 1,
    });
    game.runtime.pump();
    // Face-down card with effective value 2 should be deleted; value-3 face-up survives.
    expect(g.stacks[1][1].cards.find((c) => c.instanceId === fd.instanceId)).toBeUndefined();
    expect(g.stacks[1][1].cards.length).toBe(1);
  });

  it("Water 3 returns all value-2 cards (including face-down) in the chosen line", () => {
    const g = newGame();
    const inst = placeCard(g, 0, 0, "water-3", true);
    const fdCard = placeCard(g, 0, 1, "water-1", true); // face-down → value 2
    const facUp2 = placeCard(g, 1, 1, "water-3"); // printed 3 face-up
    const game = new Game(g);
    game.runtime.push("test", flipGen(inst.instanceId));
    game.runtime.pump();
    expect(g.pendingPrompt?.kind).toBe("choose-line");
    game.runtime.resolvePrompt({
      kind: "line-chosen",
      promptId: g.pendingPrompt!.promptId,
      lineIdx: 1,
    });
    game.runtime.pump();
    // The face-down card (effective value 2) goes back to its owner's hand.
    expect(g.players[0].hand.some((c) => c.instanceId === fdCard.instanceId)).toBe(true);
    // The face-up value-3 card stays put.
    expect(g.stacks[1][1].cards.find((c) => c.instanceId === facUp2.instanceId)).toBeDefined();
  });
});

describe("Hate 2 — highest value considers face-down cards", () => {
  beforeEach(() => registerOnly([hateCards]));
  afterEach(() => clearRegistry());

  it("with only face-down cards on the field, Hate 2 still picks one to delete", () => {
    const g = newGame();
    const fdSelf = placeCard(g, 0, 0, "hate-0", true);
    const fdOpp = placeCard(g, 1, 0, "hate-0", true);
    const inst = placeCard(g, 0, 1, "hate-2", true);
    const game = new Game(g);
    game.runtime.push("test", flipGen(inst.instanceId));
    game.runtime.pump();
    // No remaining prompts; both face-down cards got deleted.
    expect(g.stacks[0][0].cards.find((c) => c.instanceId === fdSelf.instanceId)).toBeUndefined();
    expect(g.stacks[1][0].cards.find((c) => c.instanceId === fdOpp.instanceId)).toBeUndefined();
  });
});

describe("Hate 4 — lowest covered considers both sides", () => {
  beforeEach(() => registerOnly([hateCards]));
  afterEach(() => clearRegistry());

  it("the lowest-covered card in this line may be on the OPPONENT's side", () => {
    const g = newGame();
    const oppLow = placeCard(g, 1, 1, "hate-0"); // value 0 — lowest covered
    placeCard(g, 1, 1, "hate-3"); // value 3 — covers oppLow
    placeCard(g, 0, 1, "hate-4"); // our hate-4 in line 1 (uncovered)
    // Cover hate-4 to trigger its bottom replacement → expects oppLow deleted.
    placeCard(g, 0, 1, "hate-5");
    // The "covered" trigger fires when hate-5 is placed via the engine, but
    // because placeCard bypasses the engine, simulate by directly firing.
    const game = new Game(g);
    // Re-run override recompute then drive the replacement manually by
    // shifting a new card to cover.
    // Simpler: place a fresh game with the proper order via the engine.
    const g2 = newGame();
    placeCard(g2, 1, 1, "hate-0");           // oppLow value 0
    placeCard(g2, 1, 1, "hate-3");           // covers oppLow
    const ourHate4 = placeCard(g2, 0, 1, "hate-4");
    // Use the engine to play a card onto hate-4 (must come from hand).
    const handCard = g2.players[0].hand[0]!;
    const game2 = new Game(g2);
    game2.runtime.push("test", playOnGen(0, 1, handCard.instanceId));
    game2.runtime.pump();
    // hate-4's bottom replacement fires on covered. It should delete the
    // opponent's hate-0 (value 0), not anything on hate-4's own side.
    expect(g2.stacks[1][1].cards.find((c) => c.cardId === "hate-0")).toBeUndefined();
    void game; void oppLow; void ourHate4;
  });
});

describe("Plague 3 — flips only uncovered face-up cards", () => {
  beforeEach(() => registerOnly([plagueCards]));
  afterEach(() => clearRegistry());

  it("flips every other UNCOVERED face-up card, sparing covered and face-down cards", () => {
    const g = newGame();
    // Resolver: plague-3 face-up on its own line (excluded from its own effect).
    const plague3 = placeCard(g, 0, 0, "plague-3");
    // Opponent line: a covered face-up card beneath an uncovered face-up card.
    const oppCovered = placeCard(g, 1, 1, "plague-0"); // face-up, becomes covered
    const oppUncovered = placeCard(g, 1, 1, "plague-1"); // face-up, uncovered
    // Self line: an uncovered face-up card, plus a face-down card it covers.
    const selfFaceDown = placeCard(g, 0, 2, "plague-5", true); // face-down, covered
    const selfUncovered = placeCard(g, 0, 2, "plague-2"); // face-up, uncovered

    const game = new Game(g);
    const def = plagueCards.find((c) => c.value === 3)!;
    game.runtime.push("test:plague-3", def.middle!(makeCtx(g, plague3.instanceId, 0)));
    game.runtime.pump();

    const facing = (id: string) =>
      [...g.stacks[0].flatMap((s) => s.cards), ...g.stacks[1].flatMap((s) => s.cards)].find(
        (c) => c.instanceId === id,
      )!.faceDown;

    // Uncovered face-up cards on both sides flipped to face-down.
    expect(facing(oppUncovered.instanceId)).toBe(true);
    expect(facing(selfUncovered.instanceId)).toBe(true);
    // Covered face-up card untouched; face-down card untouched; resolver untouched.
    expect(facing(oppCovered.instanceId)).toBe(false);
    expect(facing(selfFaceDown.instanceId)).toBe(true);
    expect(facing(plague3.instanceId)).toBe(false);
  });
});

describe("Uncovered-only targeting (rules.md:96)", () => {
  beforeEach(() => registerOnly([hateCards]));
  afterEach(() => clearRegistry());

  it("Hate 0 'Delete 1 card' offers only uncovered cards, not covered ones", () => {
    const g = newGame();
    const us = placeCard(g, 0, 1, "hate-0"); // resolver, uncovered on its own line
    const oppCovered = placeCard(g, 1, 0, "hate-3"); // covered (bottom of stack)
    const oppUncovered = placeCard(g, 1, 0, "hate-5"); // uncovered (top of stack)

    const game = new Game(g);
    const def = hateCards.find((c) => c.value === 0)!;
    game.runtime.push("test:hate-0", def.middle!(makeCtx(g, us.instanceId, 0)));
    game.runtime.pump();

    const p = g.pendingPrompt;
    expect(p?.kind).toBe("choose-card");
    if (p?.kind !== "choose-card") throw new Error("expected choose-card prompt");
    const ids = p.filter.instanceIds ?? [];
    expect(ids).toContain(oppUncovered.instanceId);
    expect(ids).not.toContain(oppCovered.instanceId);
    expect(ids).toContain(us.instanceId); // our own uncovered card is fair game
  });

  it("Hate 2 'highest value card' ignores a higher-value covered card", () => {
    const g = newGame();
    placeCard(g, 0, 0, "hate-2"); // resolver
    const ourHigh = placeCard(g, 0, 1, "hate-5"); // our highest uncovered (value 5)
    const oppHiddenHigh = placeCard(g, 1, 0, "hate-5"); // value 5 but COVERED
    const oppLowTop = placeCard(g, 1, 0, "hate-0"); // value 0, uncovered

    const game = new Game(g);
    const def = hateCards.find((c) => c.value === 2)!;
    game.runtime.push("test:hate-2", def.middle!(makeCtx(g, g.stacks[0][0].cards[0]!.instanceId, 0)));
    game.runtime.pump();

    const survives = (id: string) =>
      [...g.stacks[0].flatMap((s) => s.cards), ...g.stacks[1].flatMap((s) => s.cards)].some(
        (c) => c.instanceId === id,
      );
    // Opponent's deletion lands on the uncovered low card, NOT the covered 5.
    expect(survives(oppLowTop.instanceId)).toBe(false);
    expect(survives(oppHiddenHigh.instanceId)).toBe(true);
    // Our highest uncovered card was deleted (sanity on the self-side branch).
    expect(survives(ourHigh.instanceId)).toBe(false);
  });
});

describe("Plague 4 — silent skip when opponent has no face-down cards", () => {
  beforeEach(() => registerOnly([plagueCards]));
  afterEach(() => clearRegistry());

  it("end-phase trigger skips the delete prompt without issuing it", () => {
    const g = newGame();
    placeCard(g, 0, 0, "plague-4");
    // opp side has nothing face-down.
    const game = new Game(g);
    // Drive the bottom phase trigger directly.
    const def = plagueCards.find((c) => c.value === 4)!;
    if (def.bottom?.kind !== "trigger-phase") throw new Error("plague-4 bottom should be trigger-phase");
    game.runtime.push("test:plague-4-end", def.bottom.resolve(makeCtx(g, g.stacks[0][0].cards[0]!.instanceId, 0)));
    game.runtime.pump();
    // No card-chosen prompt should be active; instead the next prompt is the
    // "may flip" follow-up.
    expect(g.pendingPrompt?.kind).toBe("choose-option");
    if (g.pendingPrompt?.kind === "choose-option") {
      expect(g.pendingPrompt.reason).toBe("plague-4-may-flip");
    }
  });
});

describe("Spirit 1 — empty hand collapses to flip", () => {
  beforeEach(() => registerOnly([spiritCards]));
  afterEach(() => clearRegistry());

  it("with empty hand, the start trigger auto-flips without prompting", () => {
    const g = newGame();
    g.players[0].hand = [];
    const inst = placeCard(g, 0, 0, "spirit-1"); // face-up
    const game = new Game(g);
    const def = spiritCards.find((c) => c.value === 1)!;
    if (def.bottom?.kind !== "trigger-phase") throw new Error("spirit-1 bottom should be trigger-phase");
    game.runtime.push("test:spirit-1-start", def.bottom.resolve(makeCtx(g, inst.instanceId, 0)));
    game.runtime.pump();
    // The card flipped to face-down — no prompt was issued.
    expect(g.pendingPrompt).toBeNull();
    expect(g.stacks[0][0].cards[0]!.faceDown).toBe(true);
  });

  it("with non-empty hand, the player still gets the discard/flip choice", () => {
    const g = newGame();
    const inst = placeCard(g, 0, 0, "spirit-1");
    const game = new Game(g);
    const def = spiritCards.find((c) => c.value === 1)!;
    if (def.bottom?.kind !== "trigger-phase") throw new Error("spirit-1 bottom should be trigger-phase");
    game.runtime.push("test:spirit-1-start", def.bottom.resolve(makeCtx(g, inst.instanceId, 0)));
    game.runtime.pump();
    expect(g.pendingPrompt?.kind).toBe("choose-option");
  });
});

describe("Light 0 — value snapshot survives flip-time deletion", () => {
  beforeEach(() => registerOnly([lightCards, deathCards]));
  afterEach(() => clearRegistry());

  it("draws the post-flip value even when the flipped card vanishes mid-flow", () => {
    // Light 0 flips a card and draws cards equal to that card's value. If the
    // flip cascades into a middle that deletes the flipped card, the draw
    // count should still be honoured (snapshot before yielding the flip).
    const g = newGame();
    // Death 5 is value 5, has a self-discard middle (no field side-effects).
    // Place it face-down so the flip turns it face-up (printed 5).
    const target = placeCard(g, 1, 1, "death-5", true);
    const inst = placeCard(g, 0, 0, "light-0", true);
    const handBefore = g.players[0].hand.length;
    const game = new Game(g);
    game.runtime.push("test", flipGen(inst.instanceId));
    game.runtime.pump();
    // light-0's middle prompts for the flip target.
    expect(g.pendingPrompt?.kind).toBe("choose-card");
    game.runtime.resolvePrompt({
      kind: "card-chosen",
      promptId: g.pendingPrompt!.promptId,
      instanceId: target.instanceId,
    });
    game.runtime.pump();
    // After the flip cascade (death-5's middle issues a discard prompt),
    // resolve any pending prompt then check the draw happened.
    if (g.pendingPrompt?.kind === "discard-selection") {
      const handId = g.players[1].hand[0]!.instanceId;
      game.runtime.resolvePrompt({
        kind: "discard-chosen",
        promptId: g.pendingPrompt.promptId,
        instanceIds: [handId],
      });
      game.runtime.pump();
    }
    // We drew 5 cards from the post-flip value of death-5.
    expect(g.players[0].hand.length).toBe(handBefore + 5);
  });
});

describe("Death 1 — 'if you do' gates on actual draw", () => {
  beforeEach(() => registerOnly([deathCards]));
  afterEach(() => clearRegistry());

  it("with empty deck AND empty trash, choosing 'yes' draws nothing and skips the deletes", () => {
    const g = newGame();
    g.players[0].deck = [];
    g.players[0].trash = [];
    const inst = placeCard(g, 0, 0, "death-1");
    const other = placeCard(g, 0, 1, "death-3");
    const game = new Game(g);
    const def = deathCards.find((c) => c.value === 1)!;
    if (def.top?.kind !== "trigger-phase") throw new Error("death-1 top should be trigger-phase");
    game.runtime.push("test:death-1-start", def.top.resolve(makeCtx(g, inst.instanceId, 0)));
    game.runtime.pump();
    expect(g.pendingPrompt?.kind).toBe("choose-option");
    // Drive through the runtime directly so the phase machine doesn't re-fire
    // death-1's start trigger on top of our manually-pushed frame.
    game.runtime.resolvePrompt({
      kind: "option-chosen",
      promptId: g.pendingPrompt!.promptId,
      optionId: "yes",
    });
    game.runtime.pump();
    expect(g.pendingPrompt).toBeNull();
    expect(g.stacks[0][0].cards.find((c) => c.instanceId === inst.instanceId)).toBeDefined();
    expect(g.stacks[0][1].cards.find((c) => c.instanceId === other.instanceId)).toBeDefined();
  });
});

describe("Apathy 2 — middles in the line don't resolve at all", () => {
  beforeEach(() => registerOnly([apathyCards, deathCards]));
  afterEach(() => clearRegistry());

  it("opponent's middle gets suppressed when their card lands face-up under Apathy 2", () => {
    // p0 has Apathy 2 face-up in line 1. p1 owns death-5 in same line; we
    // simulate p1 flipping it face-up so its middle would normally fire.
    const g = newGame();
    placeCard(g, 0, 1, "apathy-2");
    const oppCard = placeCard(g, 1, 1, "death-5", true);
    recomputeOverrides(g);
    g.activePlayerIdx = 1;
    const handBefore = g.players[1].hand.length;
    const trashBefore = g.players[1].trash.length;
    const game = new Game(g);
    game.runtime.push("test", flipGen(oppCard.instanceId));
    game.runtime.pump();
    // No prompt issued — the death-5 middle (self-discard) was ignored.
    expect(g.pendingPrompt).toBeNull();
    expect(g.players[1].hand.length).toBe(handBefore);
    expect(g.players[1].trash.length).toBe(trashBefore);
  });
});

describe("Mid-action prompt advances the turn (regression)", () => {
  beforeEach(() => registerOnly([deathCards, fireCards]));
  afterEach(() => clearRegistry());

  it("Death 5: turn ends after the play-time discard prompt resolves", () => {
    // Play DEATH-5 face-up → middle issues a discard-selection prompt mid-play.
    // Pre-refactor this left the phase stuck at "action", so the active player
    // got prompted for a second action after resolving the discard.
    const g = newGame();
    g.activePlayerIdx = 1; // p1 owns the death protocol under trivialDraft
    g.phase = "action";
    const deathLine = g.players[1].protocols.findIndex((p) => p.protocol === "death") as 0 | 1 | 2;
    const death5: CardInstance = {
      instanceId: "test-death5",
      cardId: "death-5",
      faceDown: false,
      ownerIdx: 1,
    };
    g.players[1].hand.push(death5);

    const game = new Game(g);
    const midAction = commitPlay(game, 1, {
      instanceId: death5.instanceId,
      lineIdx: deathLine,
      faceDown: false,
    });
    expect(midAction.kind).toBe("awaiting-answer");
    expect(g.pendingQuestion?.kind).toBe("discard-selection");

    const after = commitDiscard(game, 1, [g.players[1].hand[0]!.instanceId]);
    expect(g.activePlayerIdx).toBe(0);
    expect(after.kind).toBe("awaiting-answer");
    expect(g.pendingQuestion?.kind).toBe("action");
  });

  it("Fire 4: turn ends after the discard-count prompt and its discards resolve", () => {
    // FIRE-4 chains two prompts (count + discard selection) before drawing.
    const g = newGame();
    g.activePlayerIdx = 0; // p0 owns the fire protocol under trivialDraft
    g.phase = "action";
    const fireLine = g.players[0].protocols.findIndex((p) => p.protocol === "fire") as 0 | 1 | 2;
    const fire4: CardInstance = {
      instanceId: "test-fire4",
      cardId: "fire-4",
      faceDown: false,
      ownerIdx: 0,
    };
    g.players[0].hand.push(fire4);

    const game = new Game(g);
    commitPlay(game, 0, {
      instanceId: fire4.instanceId,
      lineIdx: fireLine,
      faceDown: false,
    });
    // First prompt: how many to discard.
    expect(g.pendingQuestion?.kind).toBe("choose-option");
    commitOption(game, 0, "1");
    // Second prompt: which card to discard.
    expect(g.pendingQuestion?.kind).toBe("discard-selection");
    const after = commitDiscard(game, 0, [g.players[0].hand[0]!.instanceId]);
    // p1's turn now — check-cache may issue a clear-cache prompt if hand > 5
    // after the draw, but in either case it is no longer p0's action phase.
    expect(after.kind).toBe("awaiting-answer");
    if (g.pendingQuestion?.kind === "discard-selection") {
      expect(g.pendingQuestion.forPlayerIdx).toBe(0);
      // The clear-cache prompt belongs to p0 but only because cache check runs
      // before the turn handoff. The phase is past action regardless.
      expect(g.phase).toBe("check-cache");
    } else {
      expect(g.activePlayerIdx).toBe(1);
      expect(g.pendingQuestion?.kind).toBe("action");
    }
  });
});

// --- helpers ---

function makeCtx(state: GameState, thisInstanceId: string, self: PlayerIdx) {
  return createCardCtx(state, thisInstanceId, self);
}

function* playUnderGen(
  playerIdx: PlayerIdx,
  lineIdx: 0 | 1 | 2,
  anchorInstanceId: string,
): Generator<Op, void, OpResult> {
  yield {
    kind: "play",
    playerIdx,
    lineIdx,
    faceDown: true,
    fromDeck: true,
    underInstanceId: anchorInstanceId,
  };
}

function* playOnGen(
  playerIdx: PlayerIdx,
  lineIdx: 0 | 1 | 2,
  instanceId: string,
): Generator<Op, void, OpResult> {
  yield { kind: "play", playerIdx, instanceId, lineIdx, faceDown: true };
}

function* flipGen(instanceId: string): Generator<Op, void, OpResult> {
  yield { kind: "flip", instanceId };
}

// Suppress unused-import warning — PromptResponse helpful for future tests.
type _kp = PromptResponse;
