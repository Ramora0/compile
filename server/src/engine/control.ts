/**
 * Control component (rules.md:34, 51, 57, 98).
 *
 *  - The component starts in a neutral position.
 *  - During Check Control, if the active player leads in ≥2 lines, they gain it.
 *    (Implemented in phases/index.ts.)
 *  - When the holder takes the Compile or Refresh action, they MAY rearrange
 *    one player's protocols before that action resolves. The cards in those
 *    lines stay in place — only the protocol headers move. Then the component
 *    returns to neutral.
 *
 * Use of the component is optional; the holder may skip the rearrange.
 */

import type { GameState, PlayerIdx, ProtocolSlot } from "./types.js";

/**
 * Apply a protocol rearrangement on the named side. `newOrder` is a permutation
 * of [0,1,2] indicating the new line index for each existing slot.
 *
 * Cards in lines do NOT move (rules.md:98); we shuffle the protocol slots only.
 */
export function rearrangeProtocols(
  state: GameState,
  side: PlayerIdx,
  newOrder: readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2],
): void {
  const sorted = [...newOrder].sort((a, b) => a - b);
  if (sorted[0] !== 0 || sorted[1] !== 1 || sorted[2] !== 2) {
    throw new Error(`rearrange: newOrder must be a permutation of [0,1,2], got [${newOrder.join(",")}]`);
  }
  const slots = state.players[side].protocols;
  const next: ProtocolSlot[] = newOrder.map((src) => slots[src]);
  state.players[side].protocols = [next[0]!, next[1]!, next[2]!];
  state.log.push({
    t: Date.now(),
    type: "protocols-rearranged",
    side,
    newOrder: [...newOrder],
  });
}

/** Reset Control to neutral after a use (Compile/Refresh). */
export function consumeControl(state: GameState): void {
  if (state.control !== "neutral") {
    state.log.push({ t: Date.now(), type: "control-released", from: state.control });
    state.control = "neutral";
  }
}

/** True if the active player currently holds Control (rules.md:51 / :57). */
export function activeHoldsControl(state: GameState): boolean {
  return state.control === state.activePlayerIdx;
}
