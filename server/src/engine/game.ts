/**
 * Top-level engine driver. Wraps a GameState plus an EffectRuntime and
 * orchestrates the turn loop. Phase machine and Op pump take turns:
 *   - Phase machine advances until a phase needs effects (Start/End triggers,
 *     Check Compile, etc.) or input.
 *   - When triggers fire, they push generators onto the runtime stack; the
 *     runtime pumps them to completion (or until a prompt suspends).
 *   - On returning to the phase machine, control loops until the game blocks
 *     on external input.
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
import { applyAction, type PlayerAction } from "./actions.js";
import { consumeControl, rearrangeProtocols } from "./control.js";
import type { GameState, LineIdx, Phase, PlayerIdx } from "./types.js";
import type { PromptResponse } from "./ops.js";

export type EngineBlocked =
  | { kind: "awaiting-action" }
  | { kind: "awaiting-prompt" }
  | { kind: "awaiting-compile-choice"; lines: number[] }
  | { kind: "awaiting-control-rearrange" }
  | { kind: "game-over"; winnerIdx: 0 | 1 };

export class Game {
  readonly runtime: EffectRuntime;

  constructor(public readonly state: GameState) {
    this.runtime = new EffectRuntime(state);
    recomputeOverrides(state);
  }

  /**
   * Drive the engine until external input is needed. Alternates between
   * phase advancement and the effect pump.
   */
  run(): EngineBlocked {
    for (let i = 0; i < 10_000; i++) {
      // Drain any pending effects first.
      this.runtime.pump();
      if (this.runtime.isAwaitingPrompt) return { kind: "awaiting-prompt" };

      const before = this.state.phase;
      const res = this.tickPhase();

      if (res.kind === "advanced") {
        // Phase changed — loop and let any new triggers fire.
        continue;
      }
      if (res.kind === "game-over") return { kind: "game-over", winnerIdx: res.winnerIdx };
      if (res.kind === "awaiting-action") return { kind: "awaiting-action" };
      if (res.kind === "awaiting-prompt") return { kind: "awaiting-prompt" };
      if (res.kind === "awaiting-compile-choice") {
        return { kind: "awaiting-compile-choice", lines: res.lines };
      }
      if (res.kind === "awaiting-control-rearrange") {
        return { kind: "awaiting-control-rearrange" };
      }
    }
    throw new Error("game.run() exceeded safety limit");
  }

  private tickPhase(): StepResult {
    // Hooks that fire ON ENTRY to specific phases. The phase machine itself
    // is purely structural; the engine layers reactive behaviour on top.
    if (this.state.phase === "start" && !this.startTriggersFired) {
      this.fireStartTriggers();
      this.startTriggersFired = true;
    }
    if (this.state.phase === "end" && !this.endTriggersFired) {
      this.fireEndTriggers();
      this.endTriggersFired = true;
    }
    // Skip Check Cache if a static-rule override says to.
    if (
      this.state.phase === "check-cache" &&
      isPhaseSkippedFor(this.state, "check-cache", this.state.activePlayerIdx)
    ) {
      this.state.phase = "end";
      return { kind: "advanced", from: "check-cache", to: "end" };
    }

    const result = step(this.state);

    // Reset trigger guards when leaving the phase.
    if (result.kind === "advanced") {
      if (result.from === "start") this.startTriggersFired = false;
      if (result.from === "end") this.endTriggersFired = false;
    }

    return result;
  }

  private startTriggersFired = false;
  private endTriggersFired = false;

  private fireStartTriggers(): void {
    const triggers = collectPhaseTriggers(this.state, "start", this.state.activePlayerIdx);
    if (triggers.length > 0) fireTriggers(this.runtime, this.state, triggers);
  }

  private fireEndTriggers(): void {
    const triggers = collectPhaseTriggers(this.state, "end", this.state.activePlayerIdx);
    if (triggers.length > 0) fireTriggers(this.runtime, this.state, triggers);
  }

  // ---------- External input handlers ----------

  /** Submit the active player's action (Play or Refresh) during the Action phase. */
  submitAction(playerIdx: PlayerIdx, action: PlayerAction): EngineBlocked {
    applyAction(this.runtime, this.state, playerIdx, action);
    return this.run();
  }

  /**
   * Resolve a forced-compile line choice during Check Compile. If the active
   * player holds Control they may rearrange protocols first; that's submitted
   * separately via {@link submitRearrange} before calling this.
   */
  chooseCompileLine(lineIdx: LineIdx): EngineBlocked {
    if (this.state.phase !== "check-compile") {
      throw new Error(`chooseCompileLine called during phase=${this.state.phase}`);
    }
    const playerIdx = this.state.activePlayerIdx;
    performCompile(this.runtime, this.state, playerIdx, lineIdx);
    if (this.state.winnerIdx !== null) {
      return { kind: "game-over", winnerIdx: this.state.winnerIdx };
    }
    // Compile is the player's only action this turn (rules.md:40).
    if (!this.runtime.isAwaitingPrompt) {
      this.state.phase = "check-cache";
    }
    return this.run();
  }

  /** Apply a Control-component-driven protocol rearrangement on the named side. */
  submitRearrange(side: PlayerIdx, newOrder: readonly [0|1|2, 0|1|2, 0|1|2]): void {
    if (this.state.control !== this.state.activePlayerIdx) {
      throw new Error("only the Control holder may rearrange");
    }
    rearrangeProtocols(this.state, side, newOrder);
    consumeControl(this.state);
    recomputeOverrides(this.state);
  }

  /** Provide a player's response to a pending prompt. */
  resolvePrompt(response: PromptResponse): EngineBlocked {
    this.runtime.resolvePrompt(response);
    return this.run();
  }
}

export { runUntilBlocked, step };
export type { Phase, StepResult };
