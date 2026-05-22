import { describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { redactState, type ViewerId } from "../src/server/redact.js";
import type { GameState } from "../src/engine/types.js";

function view(g: GameState, viewer: ViewerId) {
  return redactState(
    {
      state: g,
      matchQuestion: null,
      draft: null,
      opponentOnline: null,
      matchId: g.id,
    },
    viewer,
  );
}

describe("redactState", () => {
  it("self sees their own hand contents; opponent sees count only", () => {
    const g = newGame();
    const view0 = view(g, 0);
    const view1 = view(g, 1);

    expect(Array.isArray(view0.players[0].hand)).toBe(true);
    expect(view0.players[1].hand).toEqual({ count: 5 });
    expect(view1.players[0].hand).toEqual({ count: 5 });
    expect(Array.isArray(view1.players[1].hand)).toBe(true);
  });

  it("self sees their deck cards (sorted), opp sees count only", () => {
    const g = newGame();
    const v = view(g, 0);
    expect(Array.isArray(v.players[0].deck)).toBe(true);
    expect(Array.isArray(v.players[0].deck) ? v.players[0].deck.length : 0).toBe(13);
    expect(v.players[1].deck).toEqual({ count: 13 });
  });

  it("trash is fully visible to all viewers", () => {
    const g = newGame();
    g.players[0].trash.push({
      instanceId: "t1",
      cardId: "spirit-3",
      faceDown: false,
      ownerIdx: 0,
    });
    const opp = view(g, 1);
    expect(opp.players[0].trash[0]?.cardId).toBe("spirit-3");
  });

  it("face-down field cards reveal cardId only to their owner", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-3", true);
    const owner = view(g, 0);
    const opp = view(g, 1);
    expect(owner.stacks[0][0]![0]!.cardId).toBe("spirit-3");
    expect(opp.stacks[0][0]![0]!.cardId).toBeNull();
    expect(opp.stacks[0][0]![0]!.faceDown).toBe(true);
  });

  it("face-up field cards are public", () => {
    const g = newGame();
    placeCard(g, 1, 2, "fire-4", false);
    const v = view(g, 0);
    expect(v.stacks[1][2]![0]!.cardId).toBe("fire-4");
  });

  it("pendingQuestion is delivered only to the targeted player", () => {
    const g = newGame();
    g.pendingQuestion = {
      kind: "choose-line",
      questionId: "q1",
      forPlayerIdx: 1,
      reason: "test",
      options: [
        { id: "line:0", label: "L1", payload: { lineIdx: 0 } },
        { id: "line:1", label: "L2", payload: { lineIdx: 1 } },
      ],
    };
    expect(view(g, 0).pendingQuestion).toBeNull();
    expect(view(g, 1).pendingQuestion?.questionId).toBe("q1");
    expect(view(g, "spectator").pendingQuestion).toBeNull();
  });

  it("opponentQuestion describes what the other player is doing without leaking detail", () => {
    const g = newGame();
    g.pendingQuestion = {
      kind: "discard-selection",
      questionId: "q2",
      forPlayerIdx: 1,
      reason: "check-cache",
      picks: { min: 2, max: 2 },
      options: [
        { id: "discard:i1", label: "fire-3", payload: { instanceId: "i1" } },
      ],
    };
    expect(view(g, 1).opponentQuestion).toBeNull();
    expect(view(g, 0).pendingQuestion).toBeNull();
    expect(view(g, 0).opponentQuestion).toEqual({
      kind: "discard-selection",
      reason: "check-cache",
      forPlayerIdx: 1,
      count: 2,
    });
    expect(view(g, "spectator").opponentQuestion).toBeNull();
  });

  it("opponentQuestion omits sensitive fields (options, hand snapshot)", () => {
    const g = newGame();
    g.pendingQuestion = {
      kind: "show-hand",
      questionId: "q3",
      forPlayerIdx: 0,
      ownerIdx: 1,
      reason: "reveal-opp-hand",
      cards: [{ instanceId: "i1", cardId: "fire-3" }],
      options: [{ id: "ack", label: "OK", payload: {} }],
    };
    const summary = view(g, 1).opponentQuestion;
    expect(summary).toEqual({
      kind: "show-hand",
      reason: "reveal-opp-hand",
      forPlayerIdx: 0,
    });
    expect((summary as unknown as { cards?: unknown }).cards).toBeUndefined();
    expect((summary as unknown as { options?: unknown }).options).toBeUndefined();
  });

  it("log scrubs opponent discards, face-down plays/shifts, returns, and targeted reveals", () => {
    const g = newGame();
    g.log = [
      { t: 1, type: "discard", playerIdx: 0, instanceId: "a", cardId: "spirit-3" },
      { t: 2, type: "play", playerIdx: 0, instanceId: "b", cardId: "fire-4", lineIdx: 0, faceDown: true },
      { t: 3, type: "play", playerIdx: 0, instanceId: "c", cardId: "fire-5", lineIdx: 1, faceDown: false },
      { t: 4, type: "shift", playerIdx: 0, instanceId: "d", cardId: "water-2", fromLineIdx: 0, toLineIdx: 1, faceDown: true },
      { t: 5, type: "return", instanceId: "e", cardId: "death-1", fromPlayerIdx: 1, fromLineIdx: 2, toPlayerIdx: 0, faceDown: false },
      { t: 6, type: "reveal", instanceId: "f", toPlayerIdx: 0, revealedCardId: "love-2" },
      { t: 7, type: "delete", playerIdx: 0, instanceId: "g", cardId: "metal-3", lineIdx: 0, faceDown: false, cause: "effect" },
    ];

    const own = view(g, 0).log;
    const opp = view(g, 1).log;
    const spec = view(g, "spectator").log;

    expect(own.length).toBe(7);
    expect(opp.length).toBe(7);
    expect(spec.length).toBe(7);

    expect(own[0]!.cardId).toBe("spirit-3");
    expect(opp[0]!.cardId).toBeNull();
    expect(spec[0]!.cardId).toBeNull();

    expect(own[1]!.cardId).toBe("fire-4");
    expect(opp[1]!.cardId).toBeNull();

    expect(own[2]!.cardId).toBe("fire-5");
    expect(opp[2]!.cardId).toBe("fire-5");

    expect(own[3]!.cardId).toBe("water-2");
    expect(opp[3]!.cardId).toBeNull();

    expect(own[4]!.cardId).toBe("death-1");
    expect(opp[4]!.cardId).toBeNull();
    expect(spec[4]!.cardId).toBeNull();

    expect(own[5]!.revealedCardId).toBe("love-2");
    expect(opp[5]!.revealedCardId).toBeNull();
    expect(spec[5]!.revealedCardId).toBeNull();

    expect(own[6]!.cardId).toBe("metal-3");
    expect(opp[6]!.cardId).toBe("metal-3");
  });
});
