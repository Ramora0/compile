import { afterEach, describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { Game } from "../src/engine/game.js";
import { applyAction, validateAction } from "../src/engine/actions.js";
import { registerMockCard, resetCardRegistry } from "./helpers/mockCards.js";
import { commitDiscard } from "./helpers/answers.js";

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

describe("Game.run → Clear Cache", () => {
  afterEach(() => resetCardRegistry());


  it("issues a discard-selection prompt when hand > 5 on entry to check-cache", () => {
    const g = newGame();
    g.phase = "check-cache";
    g.players[0].hand.push(
      { instanceId: "x1", cardId: "spirit-0", faceDown: false, ownerIdx: 0 },
      { instanceId: "x2", cardId: "spirit-0", faceDown: false, ownerIdx: 0 },
    );
    expect(g.players[0].hand.length).toBe(7);
    const game = new Game(g);
    const blocked = game.run();
    expect(blocked.kind).toBe("awaiting-answer");
    expect(g.pendingQuestion?.kind).toBe("discard-selection");
    expect(g.pendingQuestion?.forPlayerIdx).toBe(0);
    if (g.pendingQuestion?.kind === "discard-selection") {
      expect(g.pendingQuestion.picks?.min).toBe(2);
    }
  });

  it("applies the picked discards and advances past check-cache when the prompt resolves", () => {
    const g = newGame();
    g.phase = "check-cache";
    g.players[0].hand.push(
      { instanceId: "x1", cardId: "spirit-0", faceDown: false, ownerIdx: 0 },
      { instanceId: "x2", cardId: "spirit-0", faceDown: false, ownerIdx: 0 },
    );
    const game = new Game(g);
    const blocked = commitDiscard(game, 0, ["x1", "x2"]);
    // Discards landed in trash; hand is back to 5.
    expect(g.players[0].hand.length).toBe(5);
    expect(g.players[0].trash.map((c) => c.instanceId)).toEqual(
      expect.arrayContaining(["x1", "x2"]),
    );
    // And we've moved off check-cache — either turn ended (start of opponent's
    // turn) or we're blocked on the opponent's action phase.
    expect(g.phase === "action" || g.phase === "start").toBe(true);
    expect(blocked.kind).toBe("awaiting-answer");
  });

  it("respects skip-phase override (Spirit 0 bottom) and does not prompt", () => {
    // Register a mock spirit-0 whose bottom skips check-cache for its owner.
    registerMockCard({
      protocol: "spirit",
      value: 0,
      top: null,
      middle: null,
      bottom: {
        kind: "static-rule",
        apply: (ctx) => ({ kind: "skip-phase", phase: "check-cache", ownerIdx: ctx.self }),
      },
    });
    const g = newGame();
    // Plant the mock card face-up and uncovered on p0's side.
    placeCard(g, 0, 0, "spirit-0", false);
    g.phase = "check-cache";
    g.players[0].hand.push(
      { instanceId: "x1", cardId: "spirit-0", faceDown: false, ownerIdx: 0 },
      { instanceId: "x2", cardId: "spirit-0", faceDown: false, ownerIdx: 0 },
    );
    const game = new Game(g);
    const blocked = game.run();
    // Phase skipped means no discard-selection question fired.
    expect(g.pendingQuestion?.kind).not.toBe("discard-selection");
    // Hand stays over the limit because the phase was skipped.
    expect(g.players[0].hand.length).toBe(7);
    expect(blocked.kind).toBe("awaiting-answer");
  });
});
