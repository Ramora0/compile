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

  it("deck is count-only for everyone", () => {
    const g = newGame();
    const view = redactState(g, 0);
    expect(view.players[0].deckCount).toBe(13);
    expect(view.players[1].deckCount).toBe(13);
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
});
