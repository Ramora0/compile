import { describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { runUntilBlocked, step } from "../src/engine/phases/index.js";

describe("phase machine", () => {
  it("step from start advances through check-control to check-compile", () => {
    const g = newGame();
    expect(g.phase).toBe("start");
    expect(step(g).kind).toBe("advanced");
    expect(g.phase).toBe("check-control");
    expect(step(g).kind).toBe("advanced");
    expect(g.phase).toBe("check-compile");
  });

  it("with no compilable lines, falls through to action and blocks", () => {
    const g = newGame();
    const res = runUntilBlocked(g);
    expect(res.kind).toBe("awaiting-action");
    expect(g.phase).toBe("action");
  });

  it("control component: player gains control when leading 2+ lines", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-5"); // p0 leads line 0
    placeCard(g, 0, 1, "spirit-5"); // p0 leads line 1
    runUntilBlocked(g);
    expect(g.control).toBe(0);
  });

  it("control component: not gained on a single-line lead", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-5");
    runUntilBlocked(g);
    expect(g.control).toBe("neutral");
  });

  it("does not regrant control to the same player who already holds it", () => {
    const g = newGame();
    g.control = 0;
    placeCard(g, 0, 0, "spirit-5");
    placeCard(g, 0, 1, "spirit-5");
    runUntilBlocked(g);
    expect(g.control).toBe(0);
    // No duplicate "control-gained" log entry
    const entries = g.log.filter((e) => e.type === "control-gained");
    expect(entries.length).toBe(0);
  });

  it("forced compile: signals awaiting-compile-choice with the eligible lines", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-5");
    placeCard(g, 0, 0, "spirit-5"); // 10
    placeCard(g, 1, 0, "fire-3");
    const res = runUntilBlocked(g);
    expect(res.kind).toBe("awaiting-compile-choice");
    if (res.kind === "awaiting-compile-choice") {
      expect(res.lines).toEqual([0]);
      expect(res.playerIdx).toBe(0);
    }
  });

  it("end phase advances to the next player's start, increments turn, resets compiledThisTurn", () => {
    const g = newGame();
    g.phase = "end";
    g.compiledThisTurn = true;
    const turn = g.turnNumber;
    step(g);
    expect(g.activePlayerIdx).toBe(1);
    expect(g.phase).toBe("start");
    expect(g.turnNumber).toBe(turn + 1);
    expect(g.compiledThisTurn).toBe(false);
  });

  it("check-cache advances unconditionally — Clear Cache discards are pumped by Game.tickPhase before step() lands here", () => {
    // The discard prompt for hand > 5 is issued by the Game-level hook
    // (see game.test.ts for the end-to-end behavior). At the step() layer,
    // by the time we reach check-cache the runtime has already drained the
    // discards, so step just transitions to end.
    const g = newGame();
    g.phase = "check-cache";
    expect(step(g).kind).toBe("advanced");
    expect(g.phase).toBe("end");
  });

  it("check-cache passes through when hand <= 5", () => {
    const g = newGame();
    g.phase = "check-cache";
    expect(g.players[0].hand.length).toBe(5);
    expect(step(g).kind).toBe("advanced");
    expect(g.phase).toBe("end");
  });

  it("game-over short-circuits the step function", () => {
    const g = newGame();
    g.winnerIdx = 1;
    const res = step(g);
    expect(res.kind).toBe("game-over");
    if (res.kind === "game-over") expect(res.winnerIdx).toBe(1);
  });

  it("awaiting-prompt reports the prompt's forPlayerIdx, not just the active player", () => {
    // Opponent-targeted prompts (e.g. discardOppN) should surface the
    // opponent as the awaiting player even though the active player owns
    // the effect that triggered them.
    const g = newGame();
    g.phase = "action";
    g.activePlayerIdx = 0;
    g.pendingPrompt = {
      kind: "choose-option",
      promptId: "test-1",
      forPlayerIdx: 1,
      options: [{ id: "a", label: "A" }],
      reason: "test",
    };
    const res = step(g);
    expect(res.kind).toBe("awaiting-prompt");
    if (res.kind === "awaiting-prompt") expect(res.playerIdx).toBe(1);
  });
});
