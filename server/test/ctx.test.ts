import { describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { EffectRuntime } from "../src/engine/runtime.js";
import { _resetCardPromptCounter, createCardCtx, type CardCtxFull } from "../src/engine/ctx.js";
import type { Op, OpResult } from "../src/engine/ops.js";
import type { CardInstance } from "../src/engine/types.js";

function runEffect(
  state: ReturnType<typeof newGame>,
  effect: (ctx: CardCtxFull) => Generator<Op, void, OpResult>,
  thisInstanceId = "ctx-test",
) {
  _resetCardPromptCounter();
  const rt = new EffectRuntime(state);
  const ctx = createCardCtx(state, thisInstanceId, 0);
  rt.push("test", effect(ctx));
  rt.pump();
  return { rt, ctx };
}

describe("CardCtx — read helpers", () => {
  it("myHand and oppHand return live references to player hands", () => {
    const g = newGame();
    const ctx = createCardCtx(g, "x", 0);
    expect(ctx.myHand()).toBe(g.players[0].hand);
    expect(ctx.oppHand()).toBe(g.players[1].hand);
  });

  it("fieldLine returns the line's stack", () => {
    const g = newGame();
    placeCard(g, 1, 2, "fire-1");
    const ctx = createCardCtx(g, "x", 0);
    expect(ctx.fieldLine(1, 2).length).toBe(1);
  });

  it("thisCard locates the card across hand/field", () => {
    const g = newGame();
    const handCard = g.players[0].hand[0]!;
    const ctx = createCardCtx(g, handCard.instanceId, 0);
    expect(ctx.thisCard()?.instanceId).toBe(handCard.instanceId);
  });
});

describe("CardCtx — yield* delegates", () => {
  it("draw returns the drawn cards", () => {
    const g = newGame();
    let drawn: CardInstance[] = [];
    runEffect(g, function* (ctx) {
      drawn = yield* ctx.draw(2);
    });
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).toBeDefined();
  });

  it("delete returns the deleted card", () => {
    const g = newGame();
    const c = placeCard(g, 0, 0, "spirit-3");
    let deleted: CardInstance | null = null;
    runEffect(g, function* (ctx) {
      deleted = yield* ctx.delete(c.instanceId);
    });
    expect(deleted?.instanceId).toBe(c.instanceId);
  });

  it("flip returns the new face-down state", () => {
    const g = newGame();
    const c = placeCard(g, 0, 0, "spirit-3", false);
    let flip: { instanceId: string; nowFaceDown: boolean } | null = null;
    runEffect(g, function* (ctx) {
      flip = yield* ctx.flip(c.instanceId);
    });
    expect(flip?.nowFaceDown).toBe(true);
  });

  it("shift moves a card and returns true on success", () => {
    const g = newGame();
    const c = placeCard(g, 0, 0, "spirit-3");
    let ok = false;
    runEffect(g, function* (ctx) {
      ok = yield* ctx.shift(c.instanceId, 2);
    });
    expect(ok).toBe(true);
    expect(g.stacks[0][2].cards[0]?.instanceId).toBe(c.instanceId);
  });

  it("play places a hand card on the field and returns it", () => {
    const g = newGame();
    const card = g.players[0].hand[0]!;
    let played: CardInstance | null = null;
    runEffect(g, function* (ctx) {
      played = yield* ctx.play({ instanceId: card.instanceId, lineIdx: 0, faceDown: false });
    });
    expect(played?.instanceId).toBe(card.instanceId);
    expect(g.stacks[0][0].cards[0]?.instanceId).toBe(card.instanceId);
  });

  it("return moves a field card back to hand", () => {
    const g = newGame();
    const c = placeCard(g, 0, 1, "spirit-2");
    let returned: CardInstance | null = null;
    runEffect(g, function* (ctx) {
      returned = yield* ctx.return(c.instanceId);
    });
    expect(returned?.instanceId).toBe(c.instanceId);
    expect(g.players[0].hand.find((h) => h.instanceId === c.instanceId)).toBeDefined();
  });

  it("transferOwnership changes ownership", () => {
    const g = newGame();
    const c = placeCard(g, 0, 0, "spirit-3");
    runEffect(g, function* (ctx) {
      yield* ctx.transferOwnership(c.instanceId, 1);
    });
    expect(g.stacks[0][0].cards[0]?.ownerIdx).toBe(1);
  });
});

describe("CardCtx — prompt delegates", () => {
  it("promptCard returns the chosen instanceId after a card-chosen response", () => {
    const g = newGame();
    let captured: string | null | "unset" = "unset";
    const { rt } = runEffect(g, function* (ctx) {
      captured = yield* ctx.promptCard({
        filter: { side: "any" },
        optional: true,
        reason: "test",
      });
    });
    expect(g.pendingPrompt?.kind).toBe("choose-card");
    rt.resolvePrompt({
      kind: "card-chosen",
      promptId: g.pendingPrompt!.promptId,
      instanceId: "abc",
    });
    rt.pump();
    expect(captured).toBe("abc");
  });

  it("promptCard returns null if response carries null instanceId (optional cancellation)", () => {
    const g = newGame();
    let captured: string | null | "unset" = "unset";
    const { rt } = runEffect(g, function* (ctx) {
      captured = yield* ctx.promptCard({
        filter: { side: "any" },
        optional: true,
        reason: "test",
      });
    });
    rt.resolvePrompt({
      kind: "card-chosen",
      promptId: g.pendingPrompt!.promptId,
      instanceId: null,
    });
    rt.pump();
    expect(captured).toBeNull();
  });

  it("promptLine returns the chosen lineIdx", () => {
    const g = newGame();
    let chosen: 0 | 1 | 2 | "unset" = "unset";
    const { rt } = runEffect(g, function* (ctx) {
      chosen = yield* ctx.promptLine({ allowedLines: [0, 1, 2], reason: "test" });
    });
    rt.resolvePrompt({
      kind: "line-chosen",
      promptId: g.pendingPrompt!.promptId,
      lineIdx: 2,
    });
    rt.pump();
    expect(chosen).toBe(2);
  });

  it("promptDiscards returns the chosen instance IDs", () => {
    const g = newGame();
    let ids: string[] | "unset" = "unset";
    const { rt } = runEffect(g, function* (ctx) {
      ids = yield* ctx.promptDiscards({ count: 2, reason: "test" });
    });
    rt.resolvePrompt({
      kind: "discard-chosen",
      promptId: g.pendingPrompt!.promptId,
      instanceIds: ["a", "b"],
    });
    rt.pump();
    expect(ids).toEqual(["a", "b"]);
  });
});
