import { describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { redactState } from "../src/server/redact.js";

describe("redactState", () => {
  it("self sees their own hand contents; opponent sees count only", () => {
    const g = newGame();
    const view0 = redactState(g, 0);
    const view1 = redactState(g, 1);

    expect(Array.isArray(view0.players[0].hand)).toBe(true);
    expect(view0.players[1].hand).toEqual({ count: 5 });
    expect(view1.players[0].hand).toEqual({ count: 5 });
    expect(Array.isArray(view1.players[1].hand)).toBe(true);
  });

  it("self sees their deck cards (sorted), opp sees count only", () => {
    const g = newGame();
    const view = redactState(g, 0);
    expect(Array.isArray(view.players[0].deck)).toBe(true);
    expect(Array.isArray(view.players[0].deck) ? view.players[0].deck.length : 0).toBe(13);
    expect(view.players[1].deck).toEqual({ count: 13 });
  });

  it("trash is fully visible to all viewers", () => {
    const g = newGame();
    g.players[0].trash.push({
      instanceId: "t1",
      cardId: "spirit-3",
      faceDown: false,
      ownerIdx: 0,
    });
    const opp = redactState(g, 1);
    expect(opp.players[0].trash[0]?.cardId).toBe("spirit-3");
  });

  it("face-down field cards reveal cardId only to their owner", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-3", true); // face-down on p0's side
    const owner = redactState(g, 0);
    const opp = redactState(g, 1);
    expect(owner.stacks[0][0]![0]!.cardId).toBe("spirit-3");
    expect(opp.stacks[0][0]![0]!.cardId).toBeNull();
    expect(opp.stacks[0][0]![0]!.faceDown).toBe(true);
  });

  it("face-up field cards are public", () => {
    const g = newGame();
    placeCard(g, 1, 2, "fire-4", false);
    const view = redactState(g, 0);
    expect(view.stacks[1][2]![0]!.cardId).toBe("fire-4");
  });

  it("pendingPrompt is delivered only to the targeted player", () => {
    const g = newGame();
    g.pendingPrompt = {
      kind: "choose-line",
      promptId: "p1",
      forPlayerIdx: 1,
      allowedLines: [0, 1, 2],
      reason: "test",
    };
    expect(redactState(g, 0).pendingPrompt).toBeNull();
    expect(redactState(g, 1).pendingPrompt?.promptId).toBe("p1");
    expect(redactState(g, "spectator").pendingPrompt).toBeNull();
  });

  it("opponentPromptSummary describes what the other player is doing without leaking detail", () => {
    const g = newGame();
    g.pendingPrompt = {
      kind: "discard-selection",
      promptId: "p2",
      forPlayerIdx: 1,
      count: 2,
      reason: "check-cache",
    };
    // The targeted player gets the full prompt; their opponent gets the summary.
    expect(redactState(g, 1).opponentPromptSummary).toBeNull();
    expect(redactState(g, 0).pendingPrompt).toBeNull();
    expect(redactState(g, 0).opponentPromptSummary).toEqual({
      kind: "discard-selection",
      reason: "check-cache",
      forPlayerIdx: 1,
      count: 2,
    });
    // Spectators don't see prompts in either field.
    expect(redactState(g, "spectator").opponentPromptSummary).toBeNull();
  });

  it("opponentPromptSummary omits sensitive fields (filter, options, hand snapshot)", () => {
    const g = newGame();
    g.pendingPrompt = {
      kind: "show-hand",
      promptId: "p3",
      forPlayerIdx: 0,
      ownerIdx: 1,
      cards: [{ instanceId: "i1", cardId: "fire-3" }],
      reason: "reveal-opp-hand",
    };
    const summary = redactState(g, 1).opponentPromptSummary;
    expect(summary).toEqual({
      kind: "show-hand",
      reason: "reveal-opp-hand",
      forPlayerIdx: 0,
    });
    // The card snapshot must NOT leak through the summary.
    expect((summary as unknown as { cards?: unknown }).cards).toBeUndefined();
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

    const own = redactState(g, 0).log;
    const opp = redactState(g, 1).log;
    const spec = redactState(g, "spectator").log;

    // Same length for everyone — animation queues key off log indices.
    expect(own.length).toBe(7);
    expect(opp.length).toBe(7);
    expect(spec.length).toBe(7);

    // Discarder sees their own cardId; opponent + spectator do not.
    expect(own[0]!.cardId).toBe("spirit-3");
    expect(opp[0]!.cardId).toBeNull();
    expect(spec[0]!.cardId).toBeNull();

    // Face-down play: only the owner sees the cardId.
    expect(own[1]!.cardId).toBe("fire-4");
    expect(opp[1]!.cardId).toBeNull();

    // Face-up play: cardId is public to all.
    expect(own[2]!.cardId).toBe("fire-5");
    expect(opp[2]!.cardId).toBe("fire-5");

    // Face-down shift: only the owner sees the cardId.
    expect(own[3]!.cardId).toBe("water-2");
    expect(opp[3]!.cardId).toBeNull();

    // Return to P0's hand: only P0 sees the cardId.
    expect(own[4]!.cardId).toBe("death-1");
    expect(opp[4]!.cardId).toBeNull();
    expect(spec[4]!.cardId).toBeNull();

    // Targeted reveal: only toPlayerIdx (P0) learns the identity.
    expect(own[5]!.revealedCardId).toBe("love-2");
    expect(opp[5]!.revealedCardId).toBeNull();
    expect(spec[5]!.revealedCardId).toBeNull();

    // Delete: card ends in public trash; cardId stays in the log for all.
    expect(own[6]!.cardId).toBe("metal-3");
    expect(opp[6]!.cardId).toBe("metal-3");
  });
});
