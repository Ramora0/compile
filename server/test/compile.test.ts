import { afterEach, describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { Game } from "../src/engine/game.js";
import { performCompile } from "../src/engine/compile.js";
import { registerMockCard, resetCardRegistry } from "./helpers/mockCards.js";

describe("compile", () => {
  afterEach(() => resetCardRegistry());


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

  it("recompile draw transfers ownership of the drawn card to the receiver (rules.md:106)", () => {
    const g = newGame();
    g.players[0].protocols[2].compiled = true;
    placeCard(g, 0, 2, "spirit-5");
    placeCard(g, 0, 2, "spirit-5");
    const oppTopBefore = g.players[1].deck[g.players[1].deck.length - 1]!;
    expect(oppTopBefore.ownerIdx).toBe(1);
    const game = new Game(g);
    performCompile(game.runtime, g, 0, 2);
    const drawn = g.players[0].hand.find((c) => c.instanceId === oppTopBefore.instanceId)!;
    expect(drawn).toBeDefined();
    expect(drawn.ownerIdx).toBe(0);
  });

  it("recompile draw fires after-draw reactives on the drawing player", () => {
    // Mock a card with an after-draw scope:self trigger so we can observe it.
    const fired: { actor: number; thisInstance: string }[] = [];
    registerMockCard({
      protocol: "spirit",
      value: 3,
      top: {
        kind: "trigger-reactive",
        on: "after-draw",
        scope: "self",
        resolve: function* (ctx) {
          fired.push({ actor: ctx.self, thisInstance: ctx.thisInstanceId });
        },
      },
      middle: null,
      bottom: null,
    });
    // Need a separate card on the line to compile; mock a vanilla 5-value.
    registerMockCard({
      protocol: "spirit",
      value: 5,
      top: null,
      middle: null,
      bottom: null,
    });
    const g = newGame();
    g.players[0].protocols[2].compiled = true;
    // Plant the after-draw observer on p0's side (face-up, so its top is active).
    placeCard(g, 0, 0, "spirit-3");
    // Put a 10-value worth of compile fuel on the recompile line.
    placeCard(g, 0, 2, "spirit-5");
    placeCard(g, 0, 2, "spirit-5");
    const game = new Game(g);
    performCompile(game.runtime, g, 0, 2);
    expect(fired.length).toBe(1);
    expect(fired[0]!.actor).toBe(0);
    resetCardRegistry();
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
