/**
 * Top-level engine driver. Wraps a GameState plus an EffectRuntime and
 * orchestrates the turn loop. Phase machine and Op pump take turns:
 *   - Phase machine advances until a phase needs effects (Start/End triggers,
 *     Check Compile, etc.) or input.
 *   - When triggers fire, they push generators onto the runtime stack; the
 *     runtime pumps them to completion (or until a prompt suspends).
 *   - On returning to the phase machine, control loops until the game blocks
 *     on external input.
 *
 * External callers drive the engine through a single entry point: `commit`.
 * Whenever `run()` blocks it populates `state.pendingQuestion` with the
 * enumerated options the addressee can pick from.
 */

import { EffectRuntime } from "./runtime.js";
import { runUntilBlocked, step, type StepResult } from "./phases/index.js";
import {
  collectPhaseTriggers,
  fireTriggers,
  isPhaseSkippedFor,
  recomputeOverrides,
} from "./reactive/index.js";
import { performCompile } from "./compile.js";
import { applyAction } from "./actions.js";
import { consumeControl, rearrangeProtocols } from "./control.js";
import type { GameState, LineIdx, Phase, PlayerIdx } from "./types.js";
import type { Op, OpResult, Prompt, PromptResponse } from "./ops.js";
import {
  enumerateActionOptions,
  enumerateCompileOptions,
  enumeratePromptOptions,
  enumerateRearrangeOptions,
} from "./enumerate.js";
import type {
  ActionPayload,
  Answer,
  CompileLinePayload,
  Option,
  Question,
  RearrangePayload,
} from "./question.js";

export type EngineBlocked =
  | { kind: "awaiting-answer" }
  | { kind: "game-over"; winnerIdx: 0 | 1 };

export type QuestionIdGen = () => string;

export class Game {
  readonly runtime: EffectRuntime;
  /** Per-Game monotonic question-id source. May be overridden via constructor for per-Match continuity. */
  private readonly nextQuestionId: QuestionIdGen;
  private localQuestionCounter = 0;
  /**
   * Once the engine has emitted a rearrange question for the current
   * Check-Compile entry / Action-phase entry, don't emit it again. Reset on
   * phase transition.
   */
  private rearrangeAskedThisPhase = false;

  constructor(public readonly state: GameState, nextQuestionId?: QuestionIdGen) {
    this.runtime = new EffectRuntime(state);
    recomputeOverrides(state);
    this.nextQuestionId = nextQuestionId ?? (() => `q${++this.localQuestionCounter}`);
  }

  /**
   * Drive the engine until external input is needed. Alternates between
   * phase advancement and the effect pump. On block, populates
   * `state.pendingQuestion` with the question to surface to the addressee.
   */
  run(): EngineBlocked {
    for (let i = 0; i < 10_000; i++) {
      this.runtime.pump();
      if (this.runtime.isAwaitingPrompt) {
        this.setQuestionForPrompt(this.state.pendingPrompt!);
        return { kind: "awaiting-answer" };
      }

      const res = this.tickPhase();

      if (res.kind === "advanced") continue;
      if (res.kind === "game-over") {
        this.state.pendingQuestion = null;
        return { kind: "game-over", winnerIdx: res.winnerIdx };
      }
      if (res.kind === "awaiting-prompt") {
        this.setQuestionForPrompt(this.state.pendingPrompt!);
        return { kind: "awaiting-answer" };
      }
      if (res.kind === "awaiting-action") {
        if (this.shouldOfferRearrange(res.playerIdx)) {
          this.setRearrangeQuestion(res.playerIdx, "before-action");
        } else {
          this.setActionQuestion(res.playerIdx);
        }
        return { kind: "awaiting-answer" };
      }
      if (res.kind === "awaiting-compile-choice") {
        if (this.shouldOfferRearrange(res.playerIdx)) {
          this.setRearrangeQuestion(res.playerIdx, "before-compile");
        } else {
          this.setCompileQuestion(res.playerIdx);
        }
        return { kind: "awaiting-answer" };
      }
      if (res.kind === "awaiting-control-rearrange") {
        // Phase-machine flagged rearrange explicitly — honour it.
        this.setRearrangeQuestion(res.playerIdx, "before-action");
        return { kind: "awaiting-answer" };
      }
    }
    throw new Error("game.run() exceeded safety limit");
  }

  private tickPhase(): StepResult {
    if (this.state.phase === "start" && !this.startTriggersFired) {
      this.fireStartTriggers();
      this.startTriggersFired = true;
    }
    if (this.state.phase === "end" && !this.endTriggersFired) {
      this.fireEndTriggers();
      this.endTriggersFired = true;
    }
    if (
      this.state.phase === "check-cache" &&
      isPhaseSkippedFor(this.state, "check-cache", this.state.activePlayerIdx)
    ) {
      this.state.phase = "end";
      return { kind: "advanced", from: "check-cache", to: "end" };
    }
    if (this.state.phase === "check-cache" && !this.checkCacheTriggered) {
      this.checkCacheTriggered = true;
      const hand = this.state.players[this.state.activePlayerIdx].hand;
      if (hand.length > 5) {
        this.runtime.push(
          "check-cache:clear",
          clearCacheGenerator(this.state.activePlayerIdx, hand.length - 5),
        );
        return { kind: "advanced", from: "check-cache", to: "check-cache" };
      }
    }

    const result = step(this.state);

    if (result.kind === "advanced") {
      if (result.from === "start") this.startTriggersFired = false;
      if (result.from === "end") this.endTriggersFired = false;
      if (result.from === "check-cache" && result.to !== "check-cache") {
        this.checkCacheTriggered = false;
      }
      // Reset rearrange-asked flag whenever we cross a phase boundary, so the
      // question can re-fire on the next eligible entry.
      this.rearrangeAskedThisPhase = false;
    }

    return result;
  }

  private startTriggersFired = false;
  private endTriggersFired = false;
  private checkCacheTriggered = false;

  private fireStartTriggers(): void {
    const triggers = collectPhaseTriggers(this.state, "start", this.state.activePlayerIdx);
    if (triggers.length > 0) fireTriggers(this.runtime, this.state, triggers);
  }

  private fireEndTriggers(): void {
    const triggers = collectPhaseTriggers(this.state, "end", this.state.activePlayerIdx);
    if (triggers.length > 0) fireTriggers(this.runtime, this.state, triggers);
  }

  private shouldOfferRearrange(playerIdx: PlayerIdx): boolean {
    if (this.rearrangeAskedThisPhase) return false;
    return this.state.control === playerIdx;
  }

  // ---------- Question construction ----------

  private setQuestionForPrompt(prompt: Prompt): void {
    const options = enumeratePromptOptions(this.state, prompt);
    const base = {
      questionId: prompt.promptId,
      forPlayerIdx: prompt.forPlayerIdx,
      reason: prompt.reason,
      options,
    };
    let q: Question;
    switch (prompt.kind) {
      case "choose-card":
        q = { ...base, kind: "choose-card", optional: prompt.optional };
        break;
      case "choose-line":
        q = { ...base, kind: "choose-line" };
        break;
      case "choose-option":
        q = { ...base, kind: "choose-option" };
        break;
      case "discard-selection":
        q = {
          ...base,
          kind: "discard-selection",
          picks: { min: prompt.count, max: prompt.count },
        };
        break;
      case "play-from-hand":
        q = { ...base, kind: "play-from-hand" };
        break;
      case "show-hand":
        q = {
          ...base,
          kind: "show-hand",
          ownerIdx: prompt.ownerIdx,
          cards: prompt.cards,
        };
        break;
    }
    this.state.pendingQuestion = q;
  }

  private setActionQuestion(playerIdx: PlayerIdx): void {
    this.state.pendingQuestion = {
      kind: "action",
      questionId: this.nextQuestionId(),
      forPlayerIdx: playerIdx,
      reason: "action-phase",
      options: enumerateActionOptions(this.state, playerIdx),
    };
  }

  private setCompileQuestion(playerIdx: PlayerIdx): void {
    this.state.pendingQuestion = {
      kind: "compile-line",
      questionId: this.nextQuestionId(),
      forPlayerIdx: playerIdx,
      reason: "check-compile",
      options: enumerateCompileOptions(this.state, playerIdx),
    };
  }

  private rearrangeContext: "before-action" | "before-compile" | null = null;

  private setRearrangeQuestion(
    playerIdx: PlayerIdx,
    context: "before-action" | "before-compile",
  ): void {
    this.rearrangeAskedThisPhase = true;
    this.rearrangeContext = context;
    // Allow rearranging either side; pre-build the option set for the active
    // player's own side (most common). The client receives all 6 perms + skip;
    // dual-side rearrange isn't currently exposed in the UI — keep that for a
    // follow-up if needed.
    this.state.pendingQuestion = {
      kind: "control-rearrange",
      questionId: this.nextQuestionId(),
      forPlayerIdx: playerIdx,
      reason: context === "before-compile" ? "rearrange-before-compile" : "rearrange-before-action",
      options: enumerateRearrangeOptions(playerIdx),
    };
  }

  // ---------- Commit (single entry point) ----------

  /**
   * Apply an Answer to the current pending question. Validates the answer
   * matches the outstanding question, dispatches by question kind, and runs
   * the engine to the next block point.
   */
  commit(playerIdx: PlayerIdx, answer: Answer): EngineBlocked {
    const q = this.state.pendingQuestion;
    if (!q) throw new Error("no pending question");
    if (q.forPlayerIdx !== playerIdx) {
      throw new Error(`question is for player ${q.forPlayerIdx}, not ${playerIdx}`);
    }
    if (answer.questionId !== q.questionId) {
      throw new Error(`stale answer: expected ${q.questionId}, got ${answer.questionId}`);
    }

    if (answer.kind === "multi") {
      return this.commitMulti(q, answer.optionIds);
    }

    const opt = q.options.find((o) => o.id === answer.optionId);
    if (!opt) throw new Error(`unknown optionId: ${answer.optionId}`);

    this.state.pendingQuestion = null;

    switch (q.kind) {
      case "action":
        return this.applyActionPayload(playerIdx, opt.payload as ActionPayload);
      case "compile-line":
        return this.applyCompilePayload(opt.payload as CompileLinePayload);
      case "control-rearrange":
        return this.applyRearrangePayload(playerIdx, opt.payload as RearrangePayload);
      case "choose-card":
      case "choose-line":
      case "choose-option":
      case "play-from-hand":
      case "show-hand":
        return this.applyPromptPayload(q, opt);
      case "discard-selection":
        throw new Error("discard-selection requires a multi-answer");
      case "draft-pick":
        throw new Error("draft-pick is handled at the match layer, not the Game");
    }
  }

  private commitMulti(q: Question, optionIds: string[]): EngineBlocked {
    if (q.kind !== "discard-selection") {
      throw new Error(`multi-answer not valid for question kind ${q.kind}`);
    }
    if (q.picks && (optionIds.length < q.picks.min || optionIds.length > q.picks.max)) {
      throw new Error(
        `expected ${q.picks.min}-${q.picks.max} picks, got ${optionIds.length}`,
      );
    }
    const instanceIds: string[] = [];
    for (const id of optionIds) {
      const opt = q.options.find((o) => o.id === id);
      if (!opt) throw new Error(`unknown optionId: ${id}`);
      const payload = opt.payload as { instanceId: string };
      instanceIds.push(payload.instanceId);
    }
    this.state.pendingQuestion = null;
    const promptId = q.questionId;
    this.runtime.resolvePrompt({
      kind: "discard-chosen",
      promptId,
      instanceIds,
    });
    return this.run();
  }

  // ---------- Payload application ----------

  private applyActionPayload(playerIdx: PlayerIdx, payload: ActionPayload): EngineBlocked {
    if (payload.kind === "refresh") {
      applyAction(this.runtime, this.state, playerIdx, { kind: "refresh" });
    } else {
      applyAction(this.runtime, this.state, playerIdx, {
        kind: "play",
        instanceId: payload.instanceId,
        lineIdx: payload.lineIdx,
        faceDown: payload.faceDown,
      });
    }
    return this.run();
  }

  private applyCompilePayload(payload: CompileLinePayload): EngineBlocked {
    if (this.state.phase !== "check-compile") {
      throw new Error(`compile-line answered during phase=${this.state.phase}`);
    }
    const playerIdx = this.state.activePlayerIdx;
    performCompile(this.runtime, this.state, playerIdx, payload.lineIdx);
    if (this.state.winnerIdx !== null) {
      this.state.pendingQuestion = null;
      return { kind: "game-over", winnerIdx: this.state.winnerIdx };
    }
    return this.run();
  }

  private applyRearrangePayload(
    playerIdx: PlayerIdx,
    payload: RearrangePayload,
  ): EngineBlocked {
    if (this.state.control !== playerIdx) {
      throw new Error("only the Control holder may rearrange");
    }
    if (payload.kind === "rearrange") {
      rearrangeProtocols(this.state, payload.side, payload.newOrder);
      consumeControl(this.state);
      recomputeOverrides(this.state);
    }
    this.rearrangeContext = null;
    // rearrangeAskedThisPhase stays true so run() doesn't re-emit the same
    // rearrange question; it'll surface the next phase-appropriate question
    // (compile-line or action).
    return this.run();
  }

  private applyPromptPayload(q: Question, opt: Option): EngineBlocked {
    const promptId = q.questionId;
    let response: PromptResponse;
    switch (q.kind) {
      case "choose-card": {
        const p = opt.payload as { instanceId: string | null };
        response = { kind: "card-chosen", promptId, instanceId: p.instanceId };
        break;
      }
      case "choose-line": {
        const p = opt.payload as { lineIdx: LineIdx };
        response = { kind: "line-chosen", promptId, lineIdx: p.lineIdx };
        break;
      }
      case "choose-option": {
        const p = opt.payload as { optionId: string };
        response = { kind: "option-chosen", promptId, optionId: p.optionId };
        break;
      }
      case "play-from-hand": {
        const p = opt.payload as { instanceId: string; lineIdx: LineIdx; faceDown: boolean };
        response = {
          kind: "play-from-hand-chosen",
          promptId,
          instanceId: p.instanceId,
          lineIdx: p.lineIdx,
          faceDown: p.faceDown,
        };
        break;
      }
      case "show-hand":
        response = { kind: "ack", promptId };
        break;
      default:
        throw new Error(`applyPromptPayload: unexpected kind ${q.kind}`);
    }
    this.runtime.resolvePrompt(response);
    return this.run();
  }
}

function* clearCacheGenerator(
  playerIdx: PlayerIdx,
  count: number,
): Generator<Op, void, OpResult> {
  const resp = (yield {
    kind: "prompt",
    prompt: {
      kind: "discard-selection",
      promptId: "",
      forPlayerIdx: playerIdx,
      count,
      reason: "check-cache",
    },
  }) as PromptResponse | undefined;
  if (!resp || resp.kind !== "discard-chosen") {
    throw new Error("expected discard-chosen response for check-cache");
  }
  for (const instanceId of resp.instanceIds) {
    yield { kind: "discard", playerIdx, instanceId };
  }
}

export { runUntilBlocked, step };
export type { Phase, StepResult };
