import { describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { Game } from "../src/engine/game.js";
import { performCompile } from "../src/engine/compile.js";

describe("compile", () => {
  it("deletes all cards on both sides of the chosen line", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-5");
    placeCard(g, 0, 0, "spirit-5"); // active = 10
    placeCard(g, 1, 0, "fire-3");
    const game = new Game(g);
    performCompile(game.runtime, g, 0, 0);
    expect(g.stacks[0][0].cards.length).toBe(0);
    expect(g.stacks[1][0].cards.length).toBe(0);
    expect(g.players[0].trash.length).toBe(2);
    expect(g.players[1].trash.length).toBe(1);
  });

  it("flips the protocol to 'Compiled' on first compile of a line", () => {
    const g = newGame();
    placeCard(g, 0, 1, "spirit-5");
    placeCard(g, 0, 1, "spirit-5");
    const game = new Game(g);
    expect(g.players[0].protocols[1].compiled).toBe(false);
    performCompile(game.runtime, g, 0, 1);
    expect(g.players[0].protocols[1].compiled).toBe(true);
  });

  it("recompile (compile a line whose protocol is already compiled) draws top of opp deck", () => {
    const g = newGame();
    g.players[0].protocols[2].compiled = true; // simulate previously compiled
    placeCard(g, 0, 2, "spirit-5");
    placeCard(g, 0, 2, "spirit-5");
    const oppTopBefore = g.players[1].deck[g.players[1].deck.length - 1]!;
    const handBefore = g.players[0].hand.length;
    const game = new Game(g);
    performCompile(game.runtime, g, 0, 2);
    expect(g.players[0].protocols[2].compiled).toBe(true); // unchanged
    expect(g.players[0].hand.length).toBe(handBefore + 1);
    expect(g.players[0].hand.find((c) => c.instanceId === oppTopBefore.instanceId)).toBeDefined();
  });

  it("compiledThisTurn is set; second compile in same turn throws", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-5");
    placeCard(g, 0, 0, "spirit-5");
    const game = new Game(g);
    performCompile(game.runtime, g, 0, 0);
    expect(g.compiledThisTurn).toBe(true);
    expect(() => performCompile(game.runtime, g, 0, 1)).toThrow(/only one compile per turn/);
  });

  it("compiling all 3 protocols sets winnerIdx and ends the game", () => {
    const g = newGame();
    g.players[0].protocols[0].compiled = false;
    g.players[0].protocols[1].compiled = true;
    g.players[0].protocols[2].compiled = true;
    placeCard(g, 0, 0, "spirit-5");
    placeCard(g, 0, 0, "spirit-5");
    const game = new Game(g);
    performCompile(game.runtime, g, 0, 0);
    expect(g.winnerIdx).toBe(0);
    expect(g.phase).toBe("game-over");
  });
});
