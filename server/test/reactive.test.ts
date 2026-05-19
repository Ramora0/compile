import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { resetCardRegistry, registerMockCard } from "./helpers/mockCards.js";
import { Game } from "../src/engine/game.js";
import { recomputeOverrides } from "../src/engine/reactive/index.js";
import { EffectRuntime } from "../src/engine/runtime.js";
import type { Op, OpResult } from "../src/engine/ops.js";

beforeEach(() => resetCardRegistry());
afterEach(() => resetCardRegistry());

describe("static-rule overrides", () => {
  it("face-up uncovered card with bottom static-rule contributes its override", () => {
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
    placeCard(g, 0, 0, "spirit-0");
    recomputeOverrides(g);
    expect(g.overrides).toHaveLength(1);
    expect(g.overrides[0]?.override).toMatchObject({ kind: "skip-phase", ownerIdx: 0 });
  });

  it("covered face-up card keeps top static-rule active but loses bottom", () => {
    registerMockCard({
      protocol: "spirit",
      value: 1,
      top: {
        kind: "static-rule",
        apply: (ctx) => ({
          kind: "value-modifier",
          lineIdx: 0,
          side: "self",
          ownerIdx: ctx.self,
          delta: () => 1,
        }),
      },
      middle: null,
      bottom: {
        kind: "static-rule",
        apply: (ctx) => ({ kind: "skip-phase", phase: "check-cache", ownerIdx: ctx.self }),
      },
    });
    const g = newGame();
    placeCard(g, 0, 0, "spirit-1"); // bottom card
    placeCard(g, 0, 0, "spirit-1"); // top, covers the first
    recomputeOverrides(g);
    // Both cards' top rules are active (2 value-modifier overrides).
    // Only the uncovered card contributes its bottom (1 skip-phase override).
    const valueMods = g.overrides.filter((o) => o.override.kind === "value-modifier");
    const phaseSkips = g.overrides.filter((o) => o.override.kind === "skip-phase");
    expect(valueMods).toHaveLength(2);
    expect(phaseSkips).toHaveLength(1);
  });

  it("face-down cards contribute no overrides regardless of card def", () => {
    registerMockCard({
      protocol: "fire",
      value: 0,
      top: {
        kind: "static-rule",
        apply: (ctx) => ({ kind: "skip-phase", phase: "check-cache", ownerIdx: ctx.self }),
      },
      middle: null,
      bottom: null,
    });
    const g = newGame();
    placeCard(g, 0, 0, "fire-0", true);
    recomputeOverrides(g);
    expect(g.overrides).toHaveLength(0);
  });
});

describe("phase triggers via Game.run()", () => {
  it("Start: trigger fires on owner's start phase", () => {
    let fired = 0;
    registerMockCard({
      protocol: "spirit",
      value: 2,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-phase",
        phase: "start",
        resolve: function* (ctx) {
          fired++;
          yield* ctx.draw(1);
        },
      },
    });
    const g = newGame();
    placeCard(g, 0, 1, "spirit-2");
    const game = new Game(g);
    game.run();
    expect(fired).toBe(1);
    expect(g.players[0].hand.length).toBe(6);
  });

  it("Start: trigger does NOT fire on the opponent's turn", () => {
    let fired = 0;
    registerMockCard({
      protocol: "fire",
      value: 1,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-phase",
        phase: "start",
        resolve: function* () {
          fired++;
        },
      },
    });
    const g = newGame();
    // Card on player 1's side. Player 0 starts the turn — shouldn't fire.
    placeCard(g, 1, 0, "fire-1");
    const game = new Game(g);
    game.run();
    expect(fired).toBe(0);
  });
});

describe("reactive after-action triggers", () => {
  it("after-draw fires after a draw Op completes", () => {
    let fired = 0;
    registerMockCard({
      protocol: "death",
      value: 1,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-reactive",
        on: "after-draw",
        scope: "self",
        resolve: function* () {
          fired++;
        },
      },
    });
    const g = newGame();
    placeCard(g, 0, 1, "death-1");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "draw", playerIdx: 0, count: 1 };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(1);
  });

  it("scope=opp only fires when the opponent of the source player is the actor", () => {
    let fired = 0;
    registerMockCard({
      protocol: "plague",
      value: 1,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-reactive",
        on: "after-discard",
        scope: "opp",
        resolve: function* () {
          fired++;
        },
      },
    });
    const g = newGame();
    placeCard(g, 0, 0, "plague-1"); // owner = 0; scope=opp ⇒ fires when actorIdx=1
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    const handCard = g.players[1].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "discard", playerIdx: 1, instanceId: handCard.instanceId };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(1);
  });
});

describe("replacement triggers", () => {
  it("'covered' fires on the previously-uncovered card when a new card is played on top", () => {
    let fired = 0;
    registerMockCard({
      protocol: "fire",
      value: 0,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "covered",
        resolve: function* () {
          fired++;
        },
      },
    });
    const g = newGame();
    placeCard(g, 0, 1, "fire-0");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    const handCard = g.players[0].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: handCard.instanceId,
        lineIdx: 1,
        faceDown: false,
      };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(1);
  });

  it("'deleted' fires on the deleted card before the removal", () => {
    let observedOnField: boolean | null = null;
    registerMockCard({
      protocol: "speed",
      value: 0,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "deleted",
        resolve: function* (ctx) {
          // The card is still on the field at this point.
          observedOnField = !!ctx.thisCard();
          yield* ctx.draw(0); // no-op yield to exercise generator
        },
      },
    });
    const g = newGame();
    const c = placeCard(g, 0, 2, "speed-0");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "delete", instanceId: c.instanceId };
    }
    rt.push("test", effect());
    rt.pump();
    expect(observedOnField).toBe(true);
  });

  it("'deleted-by-compile' fires only when cause = compile", () => {
    let normal = 0;
    let byCompile = 0;
    registerMockCard({
      protocol: "speed",
      value: 2,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "deleted-by-compile",
        resolve: function* () {
          byCompile++;
        },
      },
    });
    registerMockCard({
      protocol: "speed",
      value: 3,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "deleted",
        resolve: function* () {
          normal++;
        },
      },
    });
    const g = newGame();
    const c1 = placeCard(g, 0, 0, "speed-2");
    const c2 = placeCard(g, 0, 1, "speed-3");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "delete", instanceId: c1.instanceId, cause: "compile" };
      yield { kind: "delete", instanceId: c2.instanceId };
    }
    rt.push("test", effect());
    rt.pump();
    expect(byCompile).toBe(1);
    expect(normal).toBe(1);
  });
});

describe("middle effects on play / flip-up / uncover", () => {
  it("face-up play resolves the card's middle text", () => {
    let fired = 0;
    registerMockCard({
      protocol: "spirit",
      value: 3,
      top: null,
      middle: function* (ctx) {
        fired++;
        yield* ctx.draw(1);
      },
      bottom: null,
    });
    const g = newGame();
    // Force the player to have a "spirit-3" in hand. Replace one card to make it deterministic.
    g.players[0].hand[0] = {
      instanceId: "manual-spirit3",
      cardId: "spirit-3",
      faceDown: false,
      ownerIdx: 0,
    };
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: "manual-spirit3",
        lineIdx: 0,
        faceDown: false,
      };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(1);
    // 1 hand slot consumed by play, 1 drawn by the middle effect → net same.
    expect(g.players[0].hand.length).toBe(5);
  });

  it("face-down play does NOT resolve middle text", () => {
    let fired = 0;
    registerMockCard({
      protocol: "fire",
      value: 4,
      top: null,
      middle: function* () {
        fired++;
      },
      bottom: null,
    });
    const g = newGame();
    g.players[0].hand[0] = {
      instanceId: "manual-fire4",
      cardId: "fire-4",
      faceDown: false,
      ownerIdx: 0,
    };
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: "manual-fire4",
        lineIdx: 0,
        faceDown: true,
      };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(0);
  });

  it("uncovering a face-up card by deletion resolves its middle text", () => {
    let fired = 0;
    registerMockCard({
      protocol: "light",
      value: 1,
      top: null,
      middle: function* () {
        fired++;
      },
      bottom: null,
    });
    const g = newGame();
    placeCard(g, 0, 0, "light-1", false); // bottom; face-up
    placeCard(g, 0, 0, "light-1", false); // top; covers bottom
    recomputeOverrides(g);
    const top = g.stacks[0][0].cards[1]!;
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "delete", instanceId: top.instanceId };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(1);
  });
});
