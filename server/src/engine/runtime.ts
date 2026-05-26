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
import { validatePlayCard } from "./actions.js";
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
    validateResponseForPrompt(this.state, pending, response);
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
    const receiver = this.state.players[op.playerIdx];
    const fromOpp = op.from === "opp";
    const source = fromOpp
      ? this.state.players[(1 - op.playerIdx) as PlayerIdx]
      : receiver;
    const drawn: CardInstance[] = [];
    for (let i = 0; i < op.count; i++) {
      if (source.deck.length === 0) {
        // Reshuffle the source's trash into its deck (rules.md:49).
        if (source.trash.length === 0) break;
        const reshuffled = shuffle(source.trash, this.state.rngSeed, this.state.rngCursor);
        this.state.rngCursor = reshuffled.cursor;
        source.deck = reshuffled.result;
        source.trash = [];
      }
      const card = source.deck.pop();
      if (!card) break;
      if (fromOpp) card.ownerIdx = op.playerIdx;
      receiver.hand.push(card);
      drawn.push(card);
    }
    this.log({
      type: "draw",
      playerIdx: op.playerIdx,
      count: drawn.length,
      ...(fromOpp ? { from: "opp" as const } : {}),
    });
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
    // For compile-cause deletes, give the card's `deleted-by-compile` replacement
    // trigger a chance to run BEFORE the removal so it can escape (Speed 2:
    // "When this card would be deleted by compiling: Shift this card"). Triggers
    // can issue prompts, so we can't pump them synchronously — instead we push
    // a deferred wrapper below the triggers on the LIFO stack. The wrapper sees
    // the post-trigger state and skips the removal if the card has been
    // displaced (moved to a different line / side).
    if (op.cause === "compile") {
      const triggers = collectReplacementTriggers(
        this.state,
        "deleted-by-compile",
        op.instanceId,
      );
      if (triggers.length > 0) {
        const before = findCardOnField(this.state, op.instanceId);
        const parent = this.captureParent();
        this.push(
          `delete:compile-defer:${op.instanceId}`,
          this.deferredCompileDelete(op, before, parent),
        );
        fireTriggers(this, this.state, triggers);
        return undefined;
      }
    } else {
      // Non-compile deletes: no card today registers a plain `"deleted"`
      // replacement trigger, so we keep the legacy fire-and-forget call for
      // forwards-compat with any future card that does. (If one shows up, it'd
      // want the same deferred pattern.)
      this.fireReplacement("deleted", op.instanceId);
    }
    return this.applyDelete(op);
  }

  /**
   * Capture the frame that yielded the current Op. `applyOp` is invoked from
   * `pump`'s body immediately after `top = frames[length - 1]; top.gen.next()`,
   * so at the moment any `opX` is on the call stack, `frames[length - 1]` IS
   * the yielding (parent) frame by construction. Capture this reference BEFORE
   * any mutation that may push child frames — once children sit above the
   * parent, `frames[length - 2]` no longer points at it.
   */
  private captureParent(): Frame | null {
    return this.frames[this.frames.length - 1] ?? null;
  }

  /** Perform the actual removal + bookkeeping. Does NOT fire replacement triggers. */
  private applyDelete(op: DeleteOp): OpResult {
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
    // Cards are only ever face-down in the play area. Once this card lands in
    // the trash it may be reshuffled into the deck and drawn, so reset it
    // face-up here (after the log records its on-field orientation).
    removed.removed.faceDown = false;
    recomputeOverrides(this.state);
    this.fireReactive("after-delete", this.state.activePlayerIdx);
    // If the removal newly uncovered a card, its middle text resolves on uncover.
    if (removed.nowUncovered && !removed.nowUncovered.faceDown) {
      this.runMiddleOf(removed.nowUncovered);
    }
    return { deleted: removed.removed };
  }

  /**
   * Body of the deferred compile-delete wrapper. Runs AFTER the replacement
   * triggers above it on the stack have completed. If the card has been
   * displaced (or removed) by a trigger, the original delete is cancelled —
   * Speed 2's escape semantics. Otherwise, the removal proceeds normally.
   *
   * `parent` is captured before any mutation in `opDelete` because `applyDelete`
   * itself may push frames (after-delete reactives, newly-uncovered middles),
   * which would shift `frames[length - 2]` away from the real parent.
   */
  private *deferredCompileDelete(
    op: DeleteOp,
    before: { playerIdx: PlayerIdx; lineIdx: number } | null,
    parent: Frame | null,
  ): Generator<Op, void, OpResult> {
    const after = findCardOnField(this.state, op.instanceId);
    const escaped =
      after === null ||
      (before !== null &&
        (after.playerIdx !== before.playerIdx || after.lineIdx !== before.lineIdx));
    const result: OpResult = escaped ? { deleted: null } : this.applyDelete(op);
    if (parent) parent.pendingInput = result;
  }

  private opFlip(op: FlipOp): OpResult {
    const loc = findCardOnField(this.state, op.instanceId);
    if (!loc) return { flipped: null };
    const triggers = collectReplacementTriggers(this.state, "flipped", op.instanceId);
    if (triggers.length > 0) {
      const parent = this.captureParent();
      this.push(
        `flip:defer:${op.instanceId}`,
        this.deferredFlip(op, parent),
      );
      fireTriggers(this, this.state, triggers);
      return undefined;
    }
    const card = this.state.stacks[loc.playerIdx][loc.lineIdx].cards[loc.stackIdx]!;
    return this.applyFlip(card, loc);
  }

  /** Perform the flip + log + after-flip reactive + uncover-middle. No replacement fire. */
  private applyFlip(
    card: CardInstance,
    loc: { playerIdx: PlayerIdx; lineIdx: number; stackIdx: number },
  ): OpResult {
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

  /**
   * Body of the deferred flip wrapper. After replacement triggers run, the
   * card may have been removed (Metal 6 top: "When this card would be flipped:
   * First, delete this card") — in which case the flip itself has nothing to
   * act on and is cancelled. Otherwise re-locate (the trigger may have shifted
   * it) and apply the flip.
   */
  private *deferredFlip(op: FlipOp, parent: Frame | null): Generator<Op, void, OpResult> {
    const loc = findCardOnField(this.state, op.instanceId);
    let result: OpResult;
    if (!loc) {
      result = { flipped: null };
    } else {
      const card = this.state.stacks[loc.playerIdx][loc.lineIdx].cards[loc.stackIdx]!;
      result = this.applyFlip(card, loc);
    }
    if (parent) parent.pendingInput = result;
  }

  private opShift(op: ShiftOp): OpResult {
    // "shifted" replacement on the moving card — no card defines it today;
    // kept fire-and-forget for forwards compat.
    this.fireReplacement("shifted", op.instanceId);
    const removed = removeFromStack(this.state, op.instanceId);
    if (!removed) return { shifted: false };
    const destStack = this.state.stacks[removed.location.playerIdx][op.toLineIdx];
    const aboutToCover = destStack.cards[destStack.cards.length - 1] ?? null;
    if (aboutToCover) {
      const triggers = collectReplacementTriggers(this.state, "covered", aboutToCover.instanceId);
      if (triggers.length > 0) {
        const parent = this.captureParent();
        this.push(
          `shift:cover-defer:${op.instanceId}`,
          this.deferredShiftPush(op, removed, parent),
        );
        fireTriggers(this, this.state, triggers);
        return undefined;
      }
    }
    return this.applyShiftPush(op, removed);
  }

  /**
   * Perform the shift's push + log + after-shift reactive + nowUncovered middle
   * (i.e. everything after the destination's "covered" replacement has fired).
   * `removed` is the result of `removeFromStack` for the moving card.
   */
  private applyShiftPush(
    op: ShiftOp,
    removed: NonNullable<ReturnType<typeof removeFromStack>>,
  ): OpResult {
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

  /**
   * Body of the deferred shift wrapper. After the destination's "covered"
   * replacement triggers complete, push the moving card onto the destination
   * line. No cancellation: if the trigger self-deleted the to-be-covered card,
   * the destination stack just lost it, and the moving card lands one slot
   * lower — the rules-intended outcome of "First, delete this card".
   */
  private *deferredShiftPush(
    op: ShiftOp,
    removed: NonNullable<ReturnType<typeof removeFromStack>>,
    parent: Frame | null,
  ): Generator<Op, void, OpResult> {
    const result = this.applyShiftPush(op, removed);
    if (parent) parent.pendingInput = result;
  }

  private opPlay(op: PlayOp): OpResult {
    const player = this.state.players[op.playerIdx];
    let card: CardInstance | undefined;
    if (op.fromDeck) {
      if (player.deck.length === 0) {
        // Reshuffle the player's trash into their deck (rules.md:49 applies
        // to deck-sourced plays the same way it does to draws).
        if (player.trash.length === 0) return { played: null };
        const reshuffled = shuffle(player.trash, this.state.rngSeed, this.state.rngCursor);
        this.state.rngCursor = reshuffled.cursor;
        player.deck = reshuffled.result;
        player.trash = [];
      }
      card = player.deck.pop();
    } else {
      if (op.instanceId === undefined) return { played: null };
      const idx = player.hand.findIndex((c) => c.instanceId === op.instanceId);
      if (idx < 0) return { played: null };
      [card] = player.hand.splice(idx, 1);
    }
    if (!card) return { played: null };
    card.faceDown = op.faceDown;

    // Mid-stack insertion ("play under this card", Gravity 0). The anchor must
    // live in the destination line on the same side; otherwise we fall back to
    // a normal top-of-stack play. The inserted card lands covered so no
    // "covered" replacement triggers fire (its neighbours above were already
    // covered) and middle text does not resolve.
    if (op.underInstanceId !== undefined) {
      const anchor = findCardOnField(this.state, op.underInstanceId);
      const sameLane =
        anchor && anchor.playerIdx === op.playerIdx && anchor.lineIdx === op.lineIdx;
      if (sameLane) {
        this.state.stacks[op.playerIdx][op.lineIdx].cards.splice(anchor.stackIdx, 0, card);
        this.log({
          type: "play",
          playerIdx: op.playerIdx,
          instanceId: card.instanceId,
          cardId: card.cardId,
          lineIdx: op.lineIdx,
          faceDown: op.faceDown,
          under: op.underInstanceId,
        });
        recomputeOverrides(this.state);
        this.fireReactive("after-play", op.playerIdx);
        return { played: card };
      }
      // Anchor missing — fall through to top-of-stack play.
    }

    const previouslyUncovered =
      this.state.stacks[op.playerIdx][op.lineIdx].cards[
        this.state.stacks[op.playerIdx][op.lineIdx].cards.length - 1
      ] ?? null;
    if (previouslyUncovered) {
      const triggers = collectReplacementTriggers(
        this.state,
        "covered",
        previouslyUncovered.instanceId,
      );
      if (triggers.length > 0) {
        // Defer the push so the soon-to-be-covered card's replacement trigger
        // runs while it is still uncovered (rules.md: "First, …" semantics).
        const parent = this.captureParent();
        this.push(
          `play:cover-defer:${card.instanceId}`,
          this.deferredPlayCover(op, card, parent),
        );
        fireTriggers(this, this.state, triggers);
        return undefined;
      }
    }
    return this.applyPlayTop(op, card);
  }

  /**
   * Perform a top-of-stack play (push + log + after-play reactive + middle).
   * Does NOT fire the "covered" replacement — caller is responsible for that.
   */
  private applyPlayTop(op: PlayOp, card: CardInstance): OpResult {
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

  /**
   * Body of the deferred play wrapper. After the to-be-covered card's
   * replacement triggers complete, push the new card onto the destination
   * line. No cancellation: if the trigger self-deleted the to-be-covered card
   * (Life 0, Metal 6), the new card simply lands on whatever's now on top of
   * the (possibly empty) line — which matches the rules-intended outcome.
   */
  private *deferredPlayCover(
    op: PlayOp,
    card: CardInstance,
    parent: Frame | null,
  ): Generator<Op, void, OpResult> {
    const result = this.applyPlayTop(op, card);
    if (parent) parent.pendingInput = result;
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
    // Cards are only ever face-down in the play area; a card returned to a hand
    // must be face-up (reset after the log records its on-field orientation).
    removed.removed.faceDown = false;
    recomputeOverrides(this.state);
    this.fireReactive("after-return", this.state.activePlayerIdx);
    if (removed.nowUncovered && !removed.nowUncovered.faceDown) {
      this.runMiddleOf(removed.nowUncovered);
    }
    return { returned: removed.removed };
  }

  private opReveal(op: RevealOp): OpResult {
    const loc = findCardOnField(this.state, op.instanceId);
    let card: CardInstance | null = loc
      ? this.state.stacks[loc.playerIdx][loc.lineIdx].cards[loc.stackIdx]!
      : null;
    if (!card) {
      for (const p of this.state.players) {
        const inHand = p.hand.find((c) => c.instanceId === op.instanceId);
        if (inHand) { card = inHand; break; }
      }
    }
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
    const loc = findCardOnField(this.state, card.instanceId);
    if (!loc) return;
    // Middle text is "active text" — per rules.md:102, active text that is
    // covered is no longer active. Flipping a covered card face-up does not
    // re-resolve its middle.
    const stack = this.state.stacks[loc.playerIdx][loc.lineIdx].cards;
    if (loc.stackIdx !== stack.length - 1) return;
    // Apathy 2 top — "Ignore all middle commands of cards in this line".
    if (ignoreMiddleFor(this.state, loc.playerIdx, loc.lineIdx)) return;
    const ctx = createCardCtx(this.state, card.instanceId, card.ownerIdx);
    this.push(`middle:${card.instanceId}`, def.middle(ctx));
  }
}

function validateResponseForPrompt(
  state: GameState,
  pending: Prompt,
  response: PromptResponse,
): void {
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
    case "play-from-hand":
      if (response.kind !== "play-from-hand-chosen") {
        throw new Error("expected play-from-hand-chosen response");
      }
      if (!pending.allowedLines.includes(response.lineIdx)) {
        throw new Error(`line ${response.lineIdx} not allowed by prompt`);
      }
      if (pending.orientation === "face-up" && response.faceDown) {
        throw new Error("prompt requires face-up play");
      }
      if (pending.orientation === "face-down" && !response.faceDown) {
        throw new Error("prompt requires face-down play");
      }
      validatePlayCard(
        state,
        pending.forPlayerIdx,
        response.instanceId,
        response.lineIdx,
        response.faceDown,
      );
      return;
    case "show-hand":
      if (response.kind !== "ack") throw new Error("expected ack response");
      return;
  }
}

/** Helper for card authors / tests: build a CardFilter that's intuitively typed. */
export function makeCardFilter(filter: CardFilter): CardFilter {
  return filter;
}
