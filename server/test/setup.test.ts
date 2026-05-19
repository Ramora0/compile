import { describe, expect, it, beforeEach } from "vitest";
import { PROTOCOLS } from "../src/shared/protocols.js";
import {
  DRAFT_ORDER,
  _resetInstanceCounter,
  createGame,
  trivialDraft,
  validateDraft,
} from "../src/engine/setup.js";

beforeEach(() => _resetInstanceCounter());

describe("draft", () => {
  it("DRAFT_ORDER is 1-2-2-1 starting with player 0", () => {
    expect(DRAFT_ORDER.map((p) => p.count)).toEqual([1, 2, 2, 1]);
    expect(DRAFT_ORDER.map((p) => p.playerIdx)).toEqual([0, 1, 0, 1]);
  });

  it("validateDraft accepts a well-formed draft", () => {
    const picks = trivialDraft();
    const { perPlayer } = validateDraft(picks);
    expect(perPlayer[0]).toHaveLength(3);
    expect(perPlayer[1]).toHaveLength(3);
    const all = [...perPlayer[0], ...perPlayer[1]];
    expect(new Set(all).size).toBe(6); // no overlap
  });

  it("validateDraft rejects wrong pick order", () => {
    const bad = trivialDraft();
    bad[0]!.playerIdx = 1; // youngest must go first
    expect(() => validateDraft(bad)).toThrow(/expected player 0/);
  });

  it("validateDraft rejects wrong pick count", () => {
    const bad = trivialDraft();
    bad[1]!.protocols = bad[1]!.protocols.slice(0, 1); // P1 must take 2
    expect(() => validateDraft(bad)).toThrow(/expected 2 protocols/);
  });

  it("validateDraft rejects duplicate picks", () => {
    const bad = trivialDraft();
    bad[1]!.protocols[0] = bad[0]!.protocols[0]!; // already taken by P0
    expect(() => validateDraft(bad)).toThrow(/not in remaining pool/);
  });
});

describe("createGame", () => {
  it("each player ends with an 18-card deck (13 in deck + 5 in hand)", () => {
    const game = createGame({
      gameId: "g1",
      rngSeed: 42,
      playerIds: ["alice", "bob"],
      draft: trivialDraft(),
    });
    for (const p of game.players) {
      expect(p.deck.length + p.hand.length).toBe(18);
      expect(p.hand.length).toBe(5);
      expect(p.deck.length).toBe(13);
      expect(p.trash).toEqual([]);
    }
  });

  it("each card belongs to one of the player's three protocols", () => {
    const game = createGame({
      gameId: "g1",
      rngSeed: 42,
      playerIds: ["alice", "bob"],
      draft: trivialDraft(),
    });
    for (const p of game.players) {
      const protocolNames = p.protocols.map((s) => s.protocol);
      for (const c of [...p.hand, ...p.deck]) {
        const protocol = c.cardId.split("-")[0]!;
        expect(protocolNames).toContain(protocol);
      }
    }
  });

  it("the two decks share no card instances and no card IDs", () => {
    const game = createGame({
      gameId: "g1",
      rngSeed: 42,
      playerIds: ["alice", "bob"],
      draft: trivialDraft(),
    });
    const ids0 = new Set([
      ...game.players[0].deck.map((c) => c.instanceId),
      ...game.players[0].hand.map((c) => c.instanceId),
    ]);
    const ids1 = new Set([
      ...game.players[1].deck.map((c) => c.instanceId),
      ...game.players[1].hand.map((c) => c.instanceId),
    ]);
    for (const id of ids1) expect(ids0.has(id)).toBe(false);
  });

  it("is deterministic given the same seed and draft", () => {
    const draft = trivialDraft();
    const a = createGame({ gameId: "g", rngSeed: 7, playerIds: ["a", "b"], draft });
    _resetInstanceCounter();
    const b = createGame({ gameId: "g", rngSeed: 7, playerIds: ["a", "b"], draft });
    expect(a.players[0].deck.map((c) => c.cardId)).toEqual(
      b.players[0].deck.map((c) => c.cardId),
    );
    expect(a.players[1].deck.map((c) => c.cardId)).toEqual(
      b.players[1].deck.map((c) => c.cardId),
    );
  });

  it("starts in phase=start, activePlayerIdx=0, control=neutral, turnNumber=1", () => {
    const game = createGame({
      gameId: "g1",
      rngSeed: 42,
      playerIds: ["alice", "bob"],
      draft: trivialDraft(),
    });
    expect(game.phase).toBe("start");
    expect(game.activePlayerIdx).toBe(0);
    expect(game.control).toBe("neutral");
    expect(game.turnNumber).toBe(1);
    expect(game.winnerIdx).toBeNull();
  });

  it("creates 6 empty stacks (3 lines × 2 sides)", () => {
    const game = createGame({
      gameId: "g1",
      rngSeed: 42,
      playerIds: ["alice", "bob"],
      draft: trivialDraft(),
    });
    expect(game.stacks).toHaveLength(2);
    for (const side of game.stacks) {
      expect(side).toHaveLength(3);
      for (const stack of side) expect(stack.cards).toEqual([]);
    }
  });

  it("draft pool size constraint — full 15-protocol pool covers everyone", () => {
    expect(PROTOCOLS.length).toBe(15);
    expect(PROTOCOLS.length).toBeGreaterThanOrEqual(6);
  });
});
