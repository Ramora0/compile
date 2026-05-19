/**
 * Turn phase machine. The engine progresses through phases until it can't
 * proceed without external input — at which point step() returns "awaiting".
 *
 * Phase hooks (reactive triggers, compile detection, etc.) are registered
 * here as no-ops in Phase 4 and filled in in Phases 5/7/8.
 */

import type { GameState, Phase, PlayerIdx } from "../types.js";
import { compilableLines, leadingLineCount } from "../field.js";

export type StepResult =
  | { kind: "advanced"; from: Phase; to: Phase }
  | { kind: "awaiting-action"; playerIdx: PlayerIdx }
  | { kind: "awaiting-prompt"; playerIdx: PlayerIdx }
  | { kind: "awaiting-compile-choice"; playerIdx: PlayerIdx; lines: number[] }
  | { kind: "awaiting-control-rearrange"; playerIdx: PlayerIdx }
  | { kind: "game-over"; winnerIdx: PlayerIdx };

export const PHASE_ORDER: readonly Phase[] = [
  "start",
  "check-control",
  "check-compile",
  "action",
  "check-cache",
  "end",
] as const;

/**
 * Advance the game state by one phase if possible. Returns a discriminated
 * StepResult so callers know whether they can keep stepping or must collect
 * input (action / prompt / compile choice / rearrange).
 *
 * In Phase 4 most hooks are stubbed:
 *  - start: would fire Start triggers (Phase 7)
 *  - check-control: implemented (rules.md:38) — gains control on 2+ lead
 *  - check-compile: detects forced-compile lines; the compile resolution lives in Phase 8
 *  - action: blocks awaiting external input; cleared via submitAction()
 *  - check-cache: triggers discard prompt when hand >5; resolution in Phase 5
 *  - end: would fire End triggers (Phase 7)
 *
 * Each branch is intentionally small — the heavy lifting moves into
 * dedicated handlers as later phases land.
 */
export function step(state: GameState): StepResult {
  if (state.winnerIdx !== null) {
    return { kind: "game-over", winnerIdx: state.winnerIdx };
  }
  if (state.pendingPrompt) {
    return { kind: "awaiting-prompt", playerIdx: targetOfPrompt(state) };
  }

  switch (state.phase) {
    case "draft":
      // Setup is handled outside this state machine; once createGame returns,
      // phase is "start" already. Treat draft as a logic error here.
      throw new Error("step() called while still in draft phase");

    case "start": {
      // Hook: Start triggers (Phase 7). For now: no-op.
      return advanceTo(state, "check-control");
    }

    case "check-control": {
      const active = state.activePlayerIdx;
      if (state.control !== active && leadingLineCount(state, active) >= 2) {
        state.control = active;
        log(state, { type: "control-gained", playerIdx: active });
      }
      return advanceTo(state, "check-compile");
    }

    case "check-compile": {
      const lines = compilableLines(state, state.activePlayerIdx);
      if (lines.length === 0) {
        return advanceTo(state, "action");
      }
      // Forced-compile: caller must pick a line. The actual Compile resolution
      // lives in Phase 8; for Phase 4 we just signal the requirement.
      return { kind: "awaiting-compile-choice", playerIdx: state.activePlayerIdx, lines };
    }

    case "action": {
      return { kind: "awaiting-action", playerIdx: state.activePlayerIdx };
    }

    case "check-cache": {
      const hand = state.players[state.activePlayerIdx].hand;
      if (hand.length <= 5) return advanceTo(state, "end");
      // Hook: prompt for discards (Phase 5). For now: signal awaiting-prompt
      // by setting a placeholder until prompts are real.
      return { kind: "awaiting-prompt", playerIdx: state.activePlayerIdx };
    }

    case "end": {
      // Hook: End triggers (Phase 7). For now: pass straight to next turn.
      return endTurn(state);
    }

    case "game-over":
      return { kind: "game-over", winnerIdx: state.winnerIdx ?? 0 };
  }
}

function advanceTo(state: GameState, to: Phase): StepResult {
  const from = state.phase;
  state.phase = to;
  log(state, { type: "phase-changed", from, to });
  return { kind: "advanced", from, to };
}

function endTurn(state: GameState): StepResult {
  const from = state.phase;
  state.compiledThisTurn = false;
  state.activePlayerIdx = (1 - state.activePlayerIdx) as PlayerIdx;
  state.turnNumber++;
  state.phase = "start";
  log(state, { type: "turn-started", playerIdx: state.activePlayerIdx, turn: state.turnNumber });
  return { kind: "advanced", from, to: state.phase };
}

function log(state: GameState, ev: Record<string, unknown> & { type: string }): void {
  state.log.push({ t: Date.now(), ...ev });
}

function targetOfPrompt(state: GameState): PlayerIdx {
  // pendingPrompt shape lands in Phase 5; until then default to active player.
  return state.activePlayerIdx;
}

/**
 * Run step() in a loop until external input is required or the game ends.
 * Returns the terminal StepResult.
 */
export function runUntilBlocked(state: GameState, safetyLimit = 1000): StepResult {
  for (let i = 0; i < safetyLimit; i++) {
    const res = step(state);
    if (res.kind !== "advanced") return res;
  }
  throw new Error("phase machine ran past safety limit");
}
