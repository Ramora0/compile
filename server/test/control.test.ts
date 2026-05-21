import { describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import {
  activeHoldsControl,
  consumeControl,
  rearrangeProtocols,
} from "../src/engine/control.js";
import { Game } from "../src/engine/game.js";

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
  it("Game.submitRearrange consumes the Control component", () => {
    const g = newGame();
    g.control = 0; // active player holds it
    const game = new Game(g);
    expect(activeHoldsControl(g)).toBe(true);
    game.submitRearrange(0, [1, 0, 2]);
    expect(g.control).toBe("neutral");
  });

  it("submitRearrange throws when the active player does not hold Control", () => {
    const g = newGame();
    g.control = 1; // opponent holds it
    const game = new Game(g);
    expect(() => game.submitRearrange(0, [1, 0, 2])).toThrow(/only the Control holder/);
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
    game.submitAction(0, { kind: "refresh" });
    expect(g.control).toBe("neutral");
  });

  it("Refresh does not affect Control when the active player does not hold it", () => {
    const g = newGame();
    g.control = 1; // opponent holds it
    g.phase = "action";
    const game = new Game(g);
    game.submitAction(0, { kind: "refresh" });
    expect(g.control).toBe(1);
  });

  it("Compile consumes Control even when the holder skips the rearrange (rules.md:57)", () => {
    const g = newGame();
    g.control = 0;
    g.phase = "check-compile";
    // chooseCompileLine trusts its caller (it's gated by the Check Compile phase,
    // which only emits awaiting-compile-choice for compilable lines). We're
    // exercising the Control-reset side effect, not the compile mechanics, so an
    // empty line is fine here.
    const game = new Game(g);
    game.chooseCompileLine(0);
    expect(g.control).toBe("neutral");
  });
});
