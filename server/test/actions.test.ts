import { describe, expect, it } from "vitest";
import { newGame } from "./helpers/harness.js";
import { Game } from "../src/engine/game.js";
import { applyAction, validateAction } from "../src/engine/actions.js";

describe("validateAction", () => {
  it("rejects actions submitted by the inactive player", () => {
    const g = newGame();
    expect(() => validateAction(g, 1, { kind: "refresh" })).toThrow(/not your turn/);
  });

  it("rejects play of a card not in hand", () => {
    const g = newGame();
    g.phase = "action";
    expect(() =>
      validateAction(g, 0, { kind: "play", instanceId: "missing", lineIdx: 0, faceDown: false }),
    ).toThrow(/not in hand/);
  });

  it("rejects face-up play into the wrong line", () => {
    const g = newGame();
    g.phase = "action";
    const handCard = g.players[0].hand[0]!;
    const handProtocol = handCard.cardId.split("-")[0]!;
    const matchingLine = g.players[0].protocols.findIndex((p) => p.protocol === handProtocol);
    const wrongLine = ((matchingLine + 1) % 3) as 0 | 1 | 2;
    expect(() =>
      validateAction(g, 0, {
        kind: "play",
        instanceId: handCard.instanceId,
        lineIdx: wrongLine,
        faceDown: false,
      }),
    ).toThrow(/face-up play/);
  });

  it("allows face-down play into any line", () => {
    const g = newGame();
    g.phase = "action";
    const handCard = g.players[0].hand[0]!;
    expect(() =>
      validateAction(g, 0, {
        kind: "play",
        instanceId: handCard.instanceId,
        lineIdx: 2,
        faceDown: true,
      }),
    ).not.toThrow();
  });

  it("rejects play with empty hand (must Refresh)", () => {
    const g = newGame();
    g.phase = "action";
    g.players[0].hand = [];
    expect(() =>
      validateAction(g, 0, { kind: "play", instanceId: "any", lineIdx: 0, faceDown: false }),
    ).toThrow(/must Refresh/);
  });
});

describe("applyAction → refresh", () => {
  it("draws back up to 5 and advances phase to check-cache", () => {
    const g = newGame();
    g.phase = "action";
    g.players[0].hand = g.players[0].hand.slice(0, 1); // 1 in hand
    const game = new Game(g);
    applyAction(game.runtime, g, 0, { kind: "refresh" });
    expect(g.players[0].hand.length).toBe(5);
    expect(g.phase).toBe("check-cache");
  });
});

describe("applyAction → play", () => {
  it("places the card on the field and advances to check-cache", () => {
    const g = newGame();
    g.phase = "action";
    const card = g.players[0].hand[0]!;
    const protocol = card.cardId.split("-")[0]!;
    const matchingLine = g.players[0].protocols.findIndex((p) => p.protocol === protocol) as 0 | 1 | 2;
    const game = new Game(g);
    applyAction(game.runtime, g, 0, {
      kind: "play",
      instanceId: card.instanceId,
      lineIdx: matchingLine,
      faceDown: false,
    });
    expect(g.players[0].hand.find((c) => c.instanceId === card.instanceId)).toBeUndefined();
    expect(g.stacks[0][matchingLine].cards[0]?.instanceId).toBe(card.instanceId);
    expect(g.phase).toBe("check-cache");
  });
});
