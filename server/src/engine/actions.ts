/**
 * Player actions during the Action phase (rules.md:41–49).
 *   - Play 1 card (face-up into matching protocol's line, OR face-down into any line)
 *   - Refresh (draw to 5)
 *
 * If a player has zero cards in hand they MUST refresh; this is enforced by
 * `validateAction`.
 */

import type { GameState, LineIdx, PlayerIdx } from "./types.js";
import type { Op } from "./ops.js";
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
 * Apply the action to state via the runtime. Returns once the action's
 * synchronous effect chain has been pumped (or a prompt suspends).
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
    runtime.push("action:refresh", refreshGenerator(playerIdx));
  } else {
    runtime.push("action:play", playGenerator(playerIdx, action.instanceId, action.lineIdx, action.faceDown));
  }
  runtime.pump();

  // If still no prompt, advance phase to check-cache.
  if (!runtime.isAwaitingPrompt) {
    state.phase = "check-cache";
  }
}

function* refreshGenerator(playerIdx: PlayerIdx): Generator<Op, void, unknown> {
  yield { kind: "refresh", playerIdx };
}

function* playGenerator(
  playerIdx: PlayerIdx,
  instanceId: string,
  lineIdx: LineIdx,
  faceDown: boolean,
): Generator<Op, void, unknown> {
  yield { kind: "play", playerIdx, instanceId, lineIdx, faceDown };
}

export { consumeControl };
