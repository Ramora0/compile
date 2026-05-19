import { describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { EffectRuntime, _resetPromptCounter } from "../src/engine/runtime.js";
import type { Op, OpResult } from "../src/engine/ops.js";

function runner(state: ReturnType<typeof newGame>, gen: Generator<Op, void, OpResult>) {
  const rt = new EffectRuntime(state);
  rt.push("test", gen);
  rt.pump();
  return rt;
}

describe("EffectRuntime — basic Ops", () => {
  it("draw moves cards from deck to hand", () => {
    const g = newGame();
    const initialHand = g.players[0].hand.length;
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "draw", playerIdx: 0, count: 2 };
    }
    runner(g, effect());
    expect(g.players[0].hand.length).toBe(initialHand + 2);
  });

  it("draw reshuffles trash into deck when deck empties mid-draw", () => {
    const g = newGame();
    // Move all of player 0's deck into trash
    g.players[0].trash = g.players[0].deck.splice(0);
    const trashedSize = g.players[0].trash.length;
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "draw", playerIdx: 0, count: 1 };
    }
    runner(g, effect());
    expect(g.players[0].deck.length).toBe(trashedSize - 1);
    expect(g.players[0].trash.length).toBe(0);
    expect(g.players[0].hand.length).toBe(6);
  });

  it("discard moves a specific card from hand to trash", () => {
    const g = newGame();
    const target = g.players[0].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "discard", playerIdx: 0, instanceId: target.instanceId };
    }
    runner(g, effect());
    expect(g.players[0].hand.find((c) => c.instanceId === target.instanceId)).toBeUndefined();
    expect(g.players[0].trash[0]?.instanceId).toBe(target.instanceId);
  });

  it("refresh draws back up to 5", () => {
    const g = newGame();
    g.players[0].hand = g.players[0].hand.slice(0, 2); // 2 in hand, need 3
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "refresh", playerIdx: 0 };
    }
    runner(g, effect());
    expect(g.players[0].hand.length).toBe(5);
  });

  it("delete moves a card from the field to its owner's trash", () => {
    const g = newGame();
    const c = placeCard(g, 0, 1, "spirit-2");
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "delete", instanceId: c.instanceId };
    }
    runner(g, effect());
    expect(g.stacks[0][1].cards.length).toBe(0);
    expect(g.players[0].trash[0]?.instanceId).toBe(c.instanceId);
  });

  it("flip toggles faceDown on a field card", () => {
    const g = newGame();
    const c = placeCard(g, 0, 1, "spirit-2", true);
    expect(c.faceDown).toBe(true);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "flip", instanceId: c.instanceId };
    }
    runner(g, effect());
    expect(g.stacks[0][1].cards[0]?.faceDown).toBe(false);
  });

  it("shift moves a card to another line on the same side", () => {
    const g = newGame();
    const c = placeCard(g, 0, 0, "spirit-2");
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "shift", instanceId: c.instanceId, toLineIdx: 2 };
    }
    runner(g, effect());
    expect(g.stacks[0][0].cards.length).toBe(0);
    expect(g.stacks[0][2].cards[0]?.instanceId).toBe(c.instanceId);
  });

  it("play moves a card from hand onto the field", () => {
    const g = newGame();
    const card = g.players[0].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: card.instanceId,
        lineIdx: 1,
        faceDown: false,
      };
    }
    runner(g, effect());
    expect(g.players[0].hand.find((c) => c.instanceId === card.instanceId)).toBeUndefined();
    expect(g.stacks[0][1].cards[0]?.instanceId).toBe(card.instanceId);
  });

  it("return moves a field card back to its owner's hand", () => {
    const g = newGame();
    const c = placeCard(g, 1, 2, "fire-1");
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "return", instanceId: c.instanceId };
    }
    runner(g, effect());
    expect(g.stacks[1][2].cards.length).toBe(0);
    expect(g.players[1].hand.find((c) => c.instanceId === c.instanceId)).toBeDefined();
  });

  it("transfer-ownership updates the owner of a field card", () => {
    const g = newGame();
    const c = placeCard(g, 0, 0, "spirit-3");
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "transfer-ownership", instanceId: c.instanceId, newOwnerIdx: 1 };
    }
    runner(g, effect());
    expect(g.stacks[0][0].cards[0]?.ownerIdx).toBe(1);
  });
});

describe("EffectRuntime — generator semantics", () => {
  it("feeds the Op result back into the generator", () => {
    const g = newGame();
    const c = placeCard(g, 0, 1, "spirit-2");
    let receivedResult: OpResult = undefined;
    function* effect(): Generator<Op, void, OpResult> {
      receivedResult = yield { kind: "delete", instanceId: c.instanceId };
    }
    runner(g, effect());
    expect(receivedResult).toEqual({ deleted: expect.objectContaining({ instanceId: c.instanceId }) });
  });

  it("nested-frame LIFO: parent resumes after child drains", () => {
    const g = newGame();
    const sequence: string[] = [];
    function* child(): Generator<Op, void, OpResult> {
      sequence.push("child:start");
      yield { kind: "draw", playerIdx: 0, count: 1 };
      sequence.push("child:end");
    }
    function* parent(rt: EffectRuntime): Generator<Op, void, OpResult> {
      sequence.push("parent:start");
      yield { kind: "draw", playerIdx: 0, count: 1 };
      // Simulate a trigger spawning a child generator.
      rt.push("child", child());
      yield { kind: "draw", playerIdx: 0, count: 1 };
      sequence.push("parent:end");
    }
    const rt = new EffectRuntime(g);
    rt.push("parent", parent(rt));
    rt.pump();
    expect(sequence).toEqual([
      "parent:start",
      // child pushed mid-parent; child runs to completion before parent resumes
      "child:start",
      "child:end",
      "parent:end",
    ]);
  });
});

describe("EffectRuntime — prompts", () => {
  it("prompts suspend the pump until resolved", () => {
    _resetPromptCounter();
    const g = newGame();
    let resumed = false;
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "prompt",
        prompt: {
          kind: "choose-line",
          promptId: "p1",
          forPlayerIdx: 0,
          allowedLines: [0, 1],
          reason: "test",
        },
      };
      resumed = true;
    }
    const rt = new EffectRuntime(g);
    rt.push("test", effect());
    rt.pump();

    expect(g.pendingPrompt?.promptId).toBe("p1");
    expect(resumed).toBe(false);

    rt.resolvePrompt({ kind: "line-chosen", promptId: "p1", lineIdx: 1 });
    rt.pump();

    expect(g.pendingPrompt).toBeNull();
    expect(resumed).toBe(true);
  });

  it("rejects mismatched promptId on response", () => {
    const g = newGame();
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "prompt",
        prompt: {
          kind: "choose-option",
          promptId: "p2",
          forPlayerIdx: 0,
          options: [{ id: "a", label: "A" }],
          reason: "test",
        },
      };
    }
    const rt = new EffectRuntime(g);
    rt.push("test", effect());
    rt.pump();
    expect(() =>
      rt.resolvePrompt({ kind: "option-chosen", promptId: "wrong", optionId: "a" }),
    ).toThrow(/promptId mismatch/);
  });

  it("rejects wrong response shape for the pending prompt kind", () => {
    const g = newGame();
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "prompt",
        prompt: {
          kind: "choose-line",
          promptId: "p3",
          forPlayerIdx: 0,
          allowedLines: [0],
          reason: "test",
        },
      };
    }
    const rt = new EffectRuntime(g);
    rt.push("test", effect());
    rt.pump();
    expect(() =>
      rt.resolvePrompt({ kind: "card-chosen", promptId: "p3", instanceId: "x" }),
    ).toThrow(/expected line-chosen/);
  });

  it("discard-selection prompt validates count", () => {
    const g = newGame();
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "prompt",
        prompt: {
          kind: "discard-selection",
          promptId: "p4",
          forPlayerIdx: 0,
          count: 2,
          reason: "test",
        },
      };
    }
    const rt = new EffectRuntime(g);
    rt.push("test", effect());
    rt.pump();
    expect(() =>
      rt.resolvePrompt({ kind: "discard-chosen", promptId: "p4", instanceIds: ["a"] }),
    ).toThrow(/expected 2 cards/);
  });
});
