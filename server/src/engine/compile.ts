/**
 * Compile resolution (rules.md:54–57). Triggered from the Check Compile
 * phase when the active player has at least one compilable line. If multiple
 * lines qualify, the player picks one; only one compile happens per turn.
 *
 * Deletion is routed through the runtime as `delete` Ops (cause: "compile")
 * so replacement triggers (Speed 2's "When this card would be deleted by
 * compiling") fire correctly. After deletion, either the protocol flips to
 * "Compiled" (first-time) or the player draws the top of the opponent's
 * deck (Recompile).
 */

import type { GameState, LineIdx, PlayerIdx } from "./types.js";
import type { EffectRuntime } from "./runtime.js";
import type { Op, OpResult } from "./ops.js";
import { recomputeOverrides } from "./reactive/index.js";

export interface CompileResult {
  lineIdx: LineIdx;
  recompile: boolean;
  deletedFromActive: number;
  deletedFromOpponent: number;
}

/**
 * Build a compile-effect generator. The runtime will pump it; if any deleted
 * card has a "deleted-by-compile" replacement trigger, that trigger runs
 * mid-stream because each Op is dispatched in turn (LIFO interrupts).
 */
export function* compileEffect(
  state: GameState,
  playerIdx: PlayerIdx,
  lineIdx: LineIdx,
): Generator<Op, CompileResult, OpResult> {
  if (state.compiledThisTurn) {
    throw new Error("only one compile per turn");
  }
  const opp = (1 - playerIdx) as PlayerIdx;
  const slot = state.players[playerIdx].protocols[lineIdx];
  const isRecompile = slot.compiled;

  const myCards = state.stacks[playerIdx][lineIdx].cards.slice();
  const oppCards = state.stacks[opp][lineIdx].cards.slice();

  // Delete the active player's stack first, then the opponent's.
  for (const c of myCards) {
    yield { kind: "delete", instanceId: c.instanceId, cause: "compile" };
  }
  for (const c of oppCards) {
    yield { kind: "delete", instanceId: c.instanceId, cause: "compile" };
  }

  if (!isRecompile) {
    slot.compiled = true;
    state.log.push({
      t: Date.now(),
      type: "protocol-compiled",
      playerIdx,
      lineIdx,
      protocol: slot.protocol,
    });
  } else {
    // Recompile (rules.md:55): draw the top of opponent's deck into the
    // active player's hand. Routed through the Op pump so after-draw
    // reactives (e.g. Spirit 3) fire and the trash-reshuffle uses the
    // seeded RNG.
    yield { kind: "draw", playerIdx, count: 1, from: "opp" };
    state.log.push({
      t: Date.now(),
      type: "protocol-recompiled",
      playerIdx,
      lineIdx,
      protocol: slot.protocol,
    });
  }

  state.compiledThisTurn = true;
  recomputeOverrides(state);

  // Check victory.
  if (state.players[playerIdx].protocols.every((p) => p.compiled)) {
    state.winnerIdx = playerIdx;
    state.phase = "game-over";
    state.log.push({ t: Date.now(), type: "game-over", winnerIdx: playerIdx });
  }

  return {
    lineIdx,
    recompile: isRecompile,
    deletedFromActive: myCards.length,
    deletedFromOpponent: oppCards.length,
  };
}

/**
 * Convenience launcher: push the compile generator onto the runtime's stack
 * and pump it. Returns once compile is fully resolved (or a prompt suspends
 * mid-compile, e.g. a deleted-by-compile replacement triggered a prompt).
 *
 * The wrapper advances phase to check-cache *after* the compile drains —
 * including any interrupts that suspended on prompts. Compile is the active
 * player's whole action on its turn (rules.md:40); once it's resolved, the
 * turn proceeds to check-cache regardless of how many interrupts fired.
 */
export function performCompile(
  runtime: EffectRuntime,
  state: GameState,
  playerIdx: PlayerIdx,
  lineIdx: LineIdx,
): void {
  function* wrapper(): Generator<Op, void, OpResult> {
    yield* compileEffect(state, playerIdx, lineIdx);
    if (state.winnerIdx === null) {
      state.phase = "check-cache";
    }
  }
  runtime.push(`compile:${playerIdx}:${lineIdx}`, wrapper());
  runtime.pump();
}
