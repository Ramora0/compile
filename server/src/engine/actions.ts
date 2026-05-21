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
  if (action.kind === "refresh") {
    // Refreshing is always legal during the action phase (rules.md:41 — Refresh is one of two action options).
    return;
  }
  if (state.players[playerIdx].hand.length === 0) {
    throw new Error("must Refresh: hand is empty (rules.md:41)");
  }
  validatePlayCard(state, playerIdx, action.instanceId, action.lineIdx, action.faceDown);
}

/**
 * Core play-legality check, independent of the Action phase. Used by both
 * `validateAction` (the player's primary turn action) and the
 * `play-from-hand` prompt resolver (cards like Speed 0 / Darkness 3 that hand
 * the player the play UI mid-effect). Throws on illegal plays.
 *
 * Note: callers wanting tighter restrictions (e.g. "another line only",
 * "face-down only") should narrow `allowedLines` / `orientation` on the
 * prompt itself rather than layering more checks here — this stays the
 * canonical baseline.
 */
export function validatePlayCard(
  state: GameState,
  playerIdx: PlayerIdx,
  instanceId: string,
  lineIdx: LineIdx,
  faceDown: boolean,
): void {
  const player = state.players[playerIdx];
  if (player.hand.length === 0) {
    throw new Error("hand is empty");
  }
  const card = player.hand.find((c) => c.instanceId === instanceId);
  if (!card) throw new Error(`card ${instanceId} not in hand`);

  if (!faceDown && !playAnywhereFor(state, playerIdx)) {
    // Face-up: must be played into the matching protocol's line (rules.md:47),
    // unless an active play-anywhere override is in effect (e.g. Spirit 1 top).
    const protocolName = card.cardId.split("-")[0]!;
    const matchingLine = lineOfProtocol(state, playerIdx, protocolName);
    if (matchingLine === null || matchingLine !== lineIdx) {
      throw new Error(
        `face-up play of ${card.cardId} requires line containing protocol "${protocolName}"`,
      );
    }
  }

  if (playRestrictedFor(state, playerIdx, lineIdx, faceDown)) {
    throw new Error(`play forbidden by an active rule override on line ${lineIdx}`);
  }
}

/**
 * Lines into which the named hand card can currently be played, split by
 * orientation. Computed by trying every (line, faceDown) combination through
 * `validatePlayCard` — keeps the rules in a single place so the client UI
 * doesn't have to reimplement play legality (rules.md:46–48 plus active
 * play-anywhere / play-restriction overrides).
 *
 * Caller is responsible for ensuring `instanceId` is currently in
 * `state.players[playerIdx].hand`.
 */
export function legalPlayLines(
  state: GameState,
  playerIdx: PlayerIdx,
  instanceId: string,
): { faceUpLines: LineIdx[]; faceDownLines: LineIdx[] } {
  const faceUpLines: LineIdx[] = [];
  const faceDownLines: LineIdx[] = [];
  for (const l of [0, 1, 2] as LineIdx[]) {
    try {
      validatePlayCard(state, playerIdx, instanceId, l, false);
      faceUpLines.push(l);
    } catch { /* illegal — skip */ }
    try {
      validatePlayCard(state, playerIdx, instanceId, l, true);
      faceDownLines.push(l);
    } catch { /* illegal — skip */ }
  }
  return { faceUpLines, faceDownLines };
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
 * `submitAction(refresh)` if the active player holds Control. Control is then
 * consumed by the Refresh resolution itself (refreshGenerator), so a Control
 * holder who Refreshes without rearranging still loses Control.
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
  // rules.md:51 — "Then, the Control component goes back to its neutral state."
  // Holding Control and Refreshing consumes it whether or not the holder
  // rearranged first (rearrange would have already neutralized via submitRearrange).
  if (state.control === playerIdx) consumeControl(state);
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
