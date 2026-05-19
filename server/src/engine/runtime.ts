/**
 * Op runtime: dispatches Ops yielded by card-effect generators, manages the
 * effect stack with LIFO interrupt semantics, and suspends on prompts.
 *
 * Reactive triggers (covered/flipped/deleted lifecycle, after-action) are
 * stubbed here as `// reactive hook` comments; Phase 7 fills them in by
 * calling into a registry.
 */

import {
  findCardOnField,
  pushOntoStack,
  removeFromStack,
} from "./field.js";
import { shuffle } from "./random.js";
import {
  collectReactiveTriggers,
  collectReplacementTriggers,
  fireTriggers,
  ignoreMiddleFor,
  recomputeOverrides,
} from "./reactive/index.js";
import { getCard } from "../cards/registry.js";
import { createCardCtx } from "./ctx.js";
import type { CardInstance, GameState, PlayerIdx } from "./types.js";
import type { ReactiveTrigger, ReplacementTrigger } from "../cards/api.js";
import type {
  CardFilter,
  DiscardOp,
  DrawOp,
  DeleteOp,
  FlipOp,
  Op,
  OpResult,
  PlayOp,
  Prompt,
  PromptOp,
  PromptResponse,
  RefreshOp,
  ReturnOp,
  RevealOp,
  ShiftOp,
  TransferOwnershipOp,
} from "./ops.js";

export type CardEffect<TCtx> = (ctx: TCtx) => Generator<Op, void, OpResult>;

interface Frame {
  source: string;
  gen: Generator<Op, void, OpResult>;
  /** Result to feed into the next .next() call when this frame is resumed. */
  pendingInput: OpResult;
}

let promptCounter = 0;
function nextPromptId(): string {
  promptCounter++;
  return `pr${promptCounter}`;
}

/** For tests — reset the monotonic prompt counter for stable IDs across runs. */
export function _resetPromptCounter(): void {
  promptCounter = 0;
}

export class EffectRuntime {
  private frames: Frame[] = [];
  /** Resolver for the currently-pending prompt; undefined if no prompt active. */
  private promptResolver: ((response: PromptResponse) => void) | undefined;

  constructor(private readonly state: GameState) {}

  /** Push a new effect generator onto the stack. */
  push(source: string, gen: Generator<Op, void, OpResult>): void {
    this.frames.push({ source, gen, pendingInput: undefined });
    this.state.opStack.push({ source });
  }

  /** True iff there's an effect to drive. */
  get isActive(): boolean {
    return this.frames.length > 0;
  }

  get isAwaitingPrompt(): boolean {
    return this.state.pendingPrompt !== null;
  }

  /**
   * Drive the effect stack until it's empty, a prompt is pending, or `safetyLimit`
   * iterations elapse. Returns when no further synchronous progress is possible.
   */
  pump(safetyLimit = 5000): void {
    let i = 0;
    while (this.frames.length > 0 && !this.isAwaitingPrompt) {
      if (i++ > safetyLimit) throw new Error("effect runtime ran past safety limit");

      const top = this.frames[this.frames.length - 1]!;
      const yielded = top.gen.next(top.pendingInput);
      top.pendingInput = undefined;

      if (yielded.done) {
        this.frames.pop();
        this.state.opStack.pop();
        continue;
      }

      const op = yielded.value;
      const result = this.applyOp(op);

      if (op.kind === "prompt") {
        // Don't set pendingInput — it'll be set when the prompt resolves.
        // The pump will exit on the next loop check via isAwaitingPrompt.
        continue;
      }

      // For Ops that may have pushed nested frames, the new top is the child.
      // We DON'T feed result to the parent yet; we feed it once the children drain
      // and the parent is at the top again.
      const newTop = this.frames[this.frames.length - 1]!;
      if (newTop === top) {
        top.pendingInput = result;
      } else {
        // Stash on the parent for later.
        top.pendingInput = result;
      }
    }
  }

  /**
   * Resolve a pending prompt. Throws if there is no pending prompt, the
   * promptId doesn't match, or the response shape is wrong for the prompt kind.
   */
  resolvePrompt(response: PromptResponse): void {
    const pending = this.state.pendingPrompt;
    if (!pending) throw new Error("no pending prompt");
    if (pending.promptId !== response.promptId) {
      throw new Error(`promptId mismatch: pending=${pending.promptId} got=${response.promptId}`);
    }
    validateResponseForPrompt(pending, response);
    this.state.pendingPrompt = null;

    // Feed the response into the parent generator on the next pump tick.
    const top = this.frames[this.frames.length - 1];
    if (top) top.pendingInput = response;
  }

  // ------------- Op dispatch -------------

  private applyOp(op: Op): OpResult {
    switch (op.kind) {
      case "draw":
        return this.opDraw(op);
      case "discard":
        return this.opDiscard(op);
      case "refresh":
        return this.opRefresh(op);
      case "delete":
        return this.opDelete(op);
      case "flip":
        return this.opFlip(op);
      case "shift":
        return this.opShift(op);
      case "play":
        return this.opPlay(op);
      case "return":
        return this.opReturn(op);
      case "reveal":
        return this.opReveal(op);
      case "transfer-ownership":
        return this.opTransferOwnership(op);
      case "prompt":
        return this.opPrompt(op);
    }
  }

  private opDraw(op: DrawOp): OpResult {
    const player = this.state.players[op.playerIdx];
    const drawn: CardInstance[] = [];
    for (let i = 0; i < op.count; i++) {
      if (player.deck.length === 0) {
        // Reshuffle trash into deck (rules.md:49).
        if (player.trash.length === 0) break;
        const reshuffled = shuffle(player.trash, this.state.rngSeed, this.state.rngCursor);
        this.state.rngCursor = reshuffled.cursor;
        player.deck = reshuffled.result;
        player.trash = [];
      }
      const card = player.deck.pop();
      if (!card) break;
      player.hand.push(card);
      drawn.push(card);
    }
    this.log({ type: "draw", playerIdx: op.playerIdx, count: drawn.length });
    if (drawn.length > 0) this.fireReactive("after-draw", op.playerIdx);
    return { drawn };
  }

  private opDiscard(op: DiscardOp): OpResult {
    const player = this.state.players[op.playerIdx];
    const idx = player.hand.findIndex((c) => c.instanceId === op.instanceId);
    if (idx < 0) return { discarded: null };
    const [card] = player.hand.splice(idx, 1);
    if (!card) return { discarded: null };
    player.trash.push(card);
    this.log({
      type: "discard",
      playerIdx: op.playerIdx,
      instanceId: card.instanceId,
      cardId: card.cardId,
    });
    this.fireReactive("after-discard", op.playerIdx);
    return { discarded: card };
  }

  private opRefresh(op: RefreshOp): OpResult {
    const player = this.state.players[op.playerIdx];
    const need = Math.max(0, 5 - player.hand.length);
    if (need === 0) return { drawn: [] };
    return this.opDraw({ kind: "draw", playerIdx: op.playerIdx, count: need });
  }

  private opDelete(op: DeleteOp): OpResult {
    // Replacement triggers run BEFORE the removal (rules.md "First, ..." pattern).
    this.fireReplacement(
      op.cause === "compile" ? "deleted-by-compile" : "deleted",
      op.instanceId,
    );
    const removed = removeFromStack(this.state, op.instanceId);
    if (!removed) {
      recomputeOverrides(this.state);
      return { deleted: null };
    }
    const owner = this.state.players[removed.removed.ownerIdx];
    owner.trash.push(removed.removed);
    this.log({
      type: "delete",
      instanceId: removed.removed.instanceId,
      cardId: removed.removed.cardId,
      playerIdx: removed.removed.ownerIdx,
      lineIdx: removed.location.lineIdx,
      faceDown: removed.removed.faceDown,
      cause: op.cause ?? "effect",
    });
    recomputeOverrides(this.state);
    this.fireReactive("after-delete", this.state.activePlayerIdx);
    // If the removal newly uncovered a card, its middle text resolves on uncover.
    if (removed.nowUncovered && !removed.nowUncovered.faceDown) {
      this.runMiddleOf(removed.nowUncovered);
    }
    return { deleted: removed.removed };
  }

  private opFlip(op: FlipOp): OpResult {
    const loc = findCardOnField(this.state, op.instanceId);
    if (!loc) return { flipped: null };
    const card = this.state.stacks[loc.playerIdx][loc.lineIdx].cards[loc.stackIdx]!;
    // Replacement triggers run BEFORE the flip resolves.
    this.fireReplacement("flipped", card.instanceId);
    card.faceDown = !card.faceDown;
    this.log({
      type: "flip",
      instanceId: card.instanceId,
      cardId: card.cardId,
      playerIdx: loc.playerIdx,
      lineIdx: loc.lineIdx,
      nowFaceDown: card.faceDown,
    });
    recomputeOverrides(this.state);
    this.fireReactive("after-flip", this.state.activePlayerIdx);
    // Newly face-up: resolve middle text (rules.md:100 "When active text enters play by … flipping").
    if (!card.faceDown) this.runMiddleOf(card);
    return { flipped: { instanceId: card.instanceId, nowFaceDown: card.faceDown } };
  }

  private opShift(op: ShiftOp): OpResult {
    this.fireReplacement("shifted", op.instanceId);
    const removed = removeFromStack(this.state, op.instanceId);
    if (!removed) return { shifted: false };
    // Fire 'covered' on the dest line's current top BEFORE the push.
    const destStack = this.state.stacks[removed.location.playerIdx][op.toLineIdx];
    const aboutToCover = destStack.cards[destStack.cards.length - 1] ?? null;
    if (aboutToCover) this.fireReplacement("covered", aboutToCover.instanceId);
    pushOntoStack(this.state, removed.location.playerIdx, op.toLineIdx, removed.removed);
    this.log({
      type: "shift",
      instanceId: removed.removed.instanceId,
      cardId: removed.removed.cardId,
      playerIdx: removed.location.playerIdx,
      fromLineIdx: removed.location.lineIdx,
      toLineIdx: op.toLineIdx,
      faceDown: removed.removed.faceDown,
    });
    recomputeOverrides(this.state);
    this.fireReactive("after-shift", this.state.activePlayerIdx);
    if (removed.nowUncovered && !removed.nowUncovered.faceDown) {
      this.runMiddleOf(removed.nowUncovered);
    }
    return { shifted: true };
  }

  private opPlay(op: PlayOp): OpResult {
    const player = this.state.players[op.playerIdx];
    const idx = player.hand.findIndex((c) => c.instanceId === op.instanceId);
    if (idx < 0) return { played: null };
    const [card] = player.hand.splice(idx, 1);
    if (!card) return { played: null };
    card.faceDown = op.faceDown;
    // Fire 'covered' on the soon-to-be-covered card BEFORE the push so its
    // bottom replacement trigger is still considered visible (uncovered).
    const previouslyUncovered =
      this.state.stacks[op.playerIdx][op.lineIdx].cards[
        this.state.stacks[op.playerIdx][op.lineIdx].cards.length - 1
      ] ?? null;
    if (previouslyUncovered) this.fireReplacement("covered", previouslyUncovered.instanceId);
    pushOntoStack(this.state, op.playerIdx, op.lineIdx, card);
    this.log({
      type: "play",
      playerIdx: op.playerIdx,
      instanceId: card.instanceId,
      cardId: card.cardId,
      lineIdx: op.lineIdx,
      faceDown: op.faceDown,
    });
    recomputeOverrides(this.state);
    this.fireReactive("after-play", op.playerIdx);
    if (!card.faceDown) this.runMiddleOf(card);
    return { played: card };
  }

  private opReturn(op: ReturnOp): OpResult {
    this.fireReplacement("returned", op.instanceId);
    const removed = removeFromStack(this.state, op.instanceId);
    if (!removed) {
      recomputeOverrides(this.state);
      return { returned: null };
    }
    const targetIdx = op.toHandOf ?? removed.removed.ownerIdx;
    this.state.players[targetIdx].hand.push(removed.removed);
    this.log({
      type: "return",
      instanceId: removed.removed.instanceId,
      cardId: removed.removed.cardId,
      fromPlayerIdx: removed.location.playerIdx,
      fromLineIdx: removed.location.lineIdx,
      toPlayerIdx: targetIdx,
      faceDown: removed.removed.faceDown,
    });
    recomputeOverrides(this.state);
    this.fireReactive("after-return", this.state.activePlayerIdx);
    if (removed.nowUncovered && !removed.nowUncovered.faceDown) {
      this.runMiddleOf(removed.nowUncovered);
    }
    return { returned: removed.removed };
  }

  private opReveal(op: RevealOp): OpResult {
    const loc = findCardOnField(this.state, op.instanceId);
    const card = loc
      ? this.state.stacks[loc.playerIdx][loc.lineIdx].cards[loc.stackIdx]!
      : null;
    this.log({
      type: "reveal",
      instanceId: op.instanceId,
      toPlayerIdx: op.toPlayerIdx,
      revealedCardId: card?.cardId ?? null,
    });
    return { revealed: card };
  }

  private opTransferOwnership(op: TransferOwnershipOp): OpResult {
    const loc = findCardOnField(this.state, op.instanceId);
    if (loc) {
      const card = this.state.stacks[loc.playerIdx][loc.lineIdx].cards[loc.stackIdx]!;
      card.ownerIdx = op.newOwnerIdx;
    } else {
      for (const p of this.state.players) {
        for (const c of [...p.hand, ...p.deck, ...p.trash]) {
          if (c.instanceId === op.instanceId) c.ownerIdx = op.newOwnerIdx;
        }
      }
    }
    this.log({ type: "ownership-transfer", instanceId: op.instanceId, newOwnerIdx: op.newOwnerIdx });
    return undefined;
  }

  private opPrompt(op: PromptOp): OpResult {
    const promptId = op.prompt.promptId || nextPromptId();
    const prompt: Prompt = { ...op.prompt, promptId };
    this.state.pendingPrompt = prompt;
    this.log({ type: "prompt-issued", promptId, kind: prompt.kind, forPlayerIdx: prompt.forPlayerIdx });
    // The actual response comes in via resolvePrompt().
    return undefined;
  }

  private log(ev: Record<string, unknown> & { type: string }): void {
    this.state.log.push({ t: Date.now(), ...ev });
  }

  // ------------- Reactive helpers -------------

  /** Fire after-action triggers matching `(on, actorIdx)` per their scope. */
  private fireReactive(on: ReactiveTrigger, actorIdx: PlayerIdx): void {
    const matches = collectReactiveTriggers(this.state, on, actorIdx);
    if (matches.length === 0) return;
    fireTriggers(this, this.state, matches);
  }

  /** Fire replacement triggers attached to `instanceId` on the named lifecycle event. */
  private fireReplacement(on: ReplacementTrigger, instanceId: string): void {
    const matches = collectReplacementTriggers(this.state, on, instanceId);
    if (matches.length === 0) return;
    fireTriggers(this, this.state, matches);
  }

  /**
   * When a card "enters play" face-up (rules.md:100), its middle text resolves.
   * The effect is pushed onto the runtime stack so it interleaves correctly
   * with any in-flight parent effect.
   */
  private runMiddleOf(card: CardInstance): void {
    const def = getCard(card.cardId);
    if (!def?.middle) return;
    // Apathy 2 top — "Ignore all middle commands of cards in this line".
    const loc = findCardOnField(this.state, card.instanceId);
    if (loc && ignoreMiddleFor(this.state, loc.playerIdx, loc.lineIdx)) return;
    const ctx = createCardCtx(this.state, card.instanceId, card.ownerIdx);
    this.push(`middle:${card.instanceId}`, def.middle(ctx));
  }
}

function validateResponseForPrompt(pending: Prompt, response: PromptResponse): void {
  switch (pending.kind) {
    case "choose-card":
      if (response.kind !== "card-chosen") throw new Error("expected card-chosen response");
      return;
    case "choose-line":
      if (response.kind !== "line-chosen") throw new Error("expected line-chosen response");
      return;
    case "choose-option":
      if (response.kind !== "option-chosen") throw new Error("expected option-chosen response");
      return;
    case "discard-selection":
      if (response.kind !== "discard-chosen") throw new Error("expected discard-chosen response");
      if (response.instanceIds.length !== pending.count) {
        throw new Error(`expected ${pending.count} cards, got ${response.instanceIds.length}`);
      }
      return;
  }
}

/** Helper for card authors / tests: build a CardFilter that's intuitively typed. */
export function makeCardFilter(filter: CardFilter): CardFilter {
  return filter;
}
