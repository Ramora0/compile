/**
 * Player actions during the Action phase (rules.md:41–49).
 *   - Play 1 card (face-up into matching protocol's line, OR face-down into any line)
 *   - Refresh (draw to 5)
 *
 * If a player has zero cards in hand they MUST refresh; this is enforced by
 * `validateAction`.
 */

import type { GameState, LineIdx, PlayerIdx } from "./types.js";
import type { Op, OpResult } from "./ops.js";
import type { EffectRuntime } from "./runtime.js";
import { lineOfProtocol } from "./field.js";
import { playRestrictedFor, playAnywhereFor } from "./reactive/index.js";
import { consumeControl } from "./control.js";

export type PlayerAction =
  | { kind: "play"; instanceId: string; lineIdx: LineIdx; faceDown: boolean }
  | { kind: "refresh" };

/**
 * Validates a candidate action against current game state. Throws on invalid.
 * Returns silently if the action is legal.
 */
export function validateAction(state: GameState, playerIdx: PlayerIdx, action: PlayerAction): void {
  if (state.activePlayerIdx !== playerIdx) {
    throw new Error("not your turn");
  }
  if (state.phase !== "action") {
    throw new Error(`action submitted during phase=${state.phase}`);
  }
  const player = state.players[playerIdx];

  if (action.kind === "refresh") {
    // Refreshing is always legal during the action phase (rules.md:41 — Refresh is one of two action options).
    return;
  }

  // kind === "play"
  if (player.hand.length === 0) {
    throw new Error("must Refresh: hand is empty (rules.md:41)");
  }
  const card = player.hand.find((c) => c.instanceId === action.instanceId);
  if (!card) throw new Error(`card ${action.instanceId} not in hand`);

  if (!action.faceDown && !playAnywhereFor(state, playerIdx)) {
    // Face-up: must be played into the matching protocol's line (rules.md:47),
    // unless an active play-anywhere override is in effect (e.g. Spirit 1 top).
    const protocolName = card.cardId.split("-")[0]!;
    const matchingLine = lineOfProtocol(state, playerIdx, protocolName);
    if (matchingLine === null || matchingLine !== action.lineIdx) {
      throw new Error(
        `face-up play of ${card.cardId} requires line containing protocol "${protocolName}"`,
      );
    }
  }

  if (playRestrictedFor(state, playerIdx, action.lineIdx, action.faceDown)) {
    throw new Error(`play forbidden by an active rule override on line ${action.lineIdx}`);
  }
}

/**
 * Apply the action to state via the runtime. The action's outer generator
 * sits at the bottom of the runtime's LIFO stack — every interrupt (middle
 * text, replacement/reactive triggers, prompts) pushes above it. The frame
 * only resumes once all interrupts have drained, at which point it advances
 * phase to check-cache. This matches rules.md:100 ("interrupts any other
 * text until it is resolved, LIFO") rather than the previous shape, which
 * advanced phase only when the *first* synchronous pump returned promptless.
 *
 * Note: rearrange-on-Compile/Refresh (rules.md:51, :57) is handled OUTSIDE
 * this function — the server collects the rearrange decision before calling
 * `submitAction(refresh)` if the active player holds Control.
 */
export function applyAction(
  runtime: EffectRuntime,
  state: GameState,
  playerIdx: PlayerIdx,
  action: PlayerAction,
): void {
  validateAction(state, playerIdx, action);

  if (action.kind === "refresh") {
    runtime.push("action:refresh", refreshGenerator(state, playerIdx));
  } else {
    runtime.push(
      "action:play",
      playGenerator(state, playerIdx, action.instanceId, action.lineIdx, action.faceDown),
    );
  }
  runtime.pump();
}

function* refreshGenerator(state: GameState, playerIdx: PlayerIdx): Generator<Op, void, OpResult> {
  yield { kind: "refresh", playerIdx };
  state.phase = "check-cache";
}

function* playGenerator(
  state: GameState,
  playerIdx: PlayerIdx,
  instanceId: string,
  lineIdx: LineIdx,
  faceDown: boolean,
): Generator<Op, void, OpResult> {
  yield { kind: "play", playerIdx, instanceId, lineIdx, faceDown };
  state.phase = "check-cache";
}

export { consumeControl };
