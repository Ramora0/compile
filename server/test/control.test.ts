import { describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import {
  activeHoldsControl,
  consumeControl,
  rearrangeProtocols,
} from "../src/engine/control.js";
import { Game } from "../src/engine/game.js";
import {
  commitCompile,
  commitRearrange,
  commitRefresh,
} from "./helpers/answers.js";

describe("rearrangeProtocols", () => {
  it("permutes the slots without moving the cards in their lines", () => {
    const g = newGame();
    const before = g.players[0].protocols.map((p) => p.protocol);
    placeCard(g, 0, 0, "spirit-3"); // place a card in line 0
    rearrangeProtocols(g, 0, [2, 0, 1]);
    const after = g.players[0].protocols.map((p) => p.protocol);
    expect(after[0]).toBe(before[2]);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    // Card position is by line index, which didn't move; the card stays in line 0.
    expect(g.stacks[0][0].cards[0]?.cardId).toBe("spirit-3");
  });

  it("rejects non-permutations", () => {
    const g = newGame();
    expect(() => rearrangeProtocols(g, 0, [0, 0, 1])).toThrow(/permutation/);
  });
});

describe("Control component lifecycle", () => {
  it("rearrange answer consumes the Control component", () => {
    const g = newGame();
    g.control = 0; // active player holds it
    g.phase = "action";
    const game = new Game(g);
    expect(activeHoldsControl(g)).toBe(true);
    commitRearrange(game, 0, { side: 0, newOrder: [1, 0, 2] });
    expect(g.control).toBe("neutral");
  });

  it("rearrange question is only emitted when the active player holds Control", () => {
    const g = newGame();
    g.control = 1; // opponent holds it
    g.phase = "action";
    const game = new Game(g);
    game.run();
    expect(g.pendingQuestion?.kind).toBe("action"); // no rearrange offered
  });

  it("consumeControl is a no-op when control is already neutral", () => {
    const g = newGame();
    consumeControl(g);
    expect(g.control).toBe("neutral");
    const releaseEntries = g.log.filter((e) => e.type === "control-released");
    expect(releaseEntries).toHaveLength(0);
  });

  it("Refresh consumes Control even when the holder skips the rearrange (rules.md:51)", () => {
    const g = newGame();
    g.control = 0;
    g.phase = "action";
    const game = new Game(g);
    // First answer the offered rearrange question with skip, then refresh.
    commitRearrange(game, 0, "skip");
    commitRefresh(game, 0);
    expect(g.control).toBe("neutral");
  });

  it("Refresh does not affect Control when the active player does not hold it", () => {
    const g = newGame();
    g.control = 1; // opponent holds it
    g.phase = "action";
    const game = new Game(g);
    commitRefresh(game, 0);
    expect(g.control).toBe(1);
  });

  it("Compile consumes Control even when the holder skips the rearrange (rules.md:57)", () => {
    const g = newGame();
    g.control = 0;
    g.phase = "check-compile";
    // The compile-line question is only offered when compilable lines exist.
    // Force a compilable state, then skip the offered rearrange, then choose
    // the line.
    g.stacks[0][0].cards.push({ instanceId: "fake-10", cardId: "spirit-5", faceDown: false, ownerIdx: 0 });
    g.stacks[0][0].cards.push({ instanceId: "fake-11", cardId: "spirit-5", faceDown: false, ownerIdx: 0 });
    const game = new Game(g);
    commitRearrange(game, 0, "skip");
    commitCompile(game, 0, 0);
    expect(g.control).toBe("neutral");
  });
});
