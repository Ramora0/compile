/**
 * Op type definitions. Card effects are generator functions that yield these.
 * The runtime in `runtime.ts` interprets each Op into state mutations.
 *
 * Every Op shape is serializable so a snapshot of {state, opStackDescriptors}
 * can be sent to the frontend or logged. The actual generator objects live
 * outside GameState (in the in-memory engine) for v1.
 */

import type { CardInstance, LineIdx, PlayerIdx, Side } from "./types.js";

export type Op =
  | DrawOp
  | DiscardOp
  | RefreshOp
  | DeleteOp
  | FlipOp
  | ShiftOp
  | PlayOp
  | ReturnOp
  | RevealOp
  | TransferOwnershipOp
  | PromptOp;

export interface DrawOp {
  kind: "draw";
  playerIdx: PlayerIdx;
  count: number;
  /**
   * Source deck. "own" (default) — draw from playerIdx's own deck.
   * "opp" — draw the top of the other player's deck into playerIdx's hand
   * (used by recompile and Love 1). Drawing from opp transfers ownership
   * of the card to the receiver (rules.md:106).
   */
  from?: "own" | "opp";
}
export interface DiscardOp {
  kind: "discard";
  playerIdx: PlayerIdx;
  /** Specific instance to discard, or null to mean "the engine has already chosen via a prompt". */
  instanceId: string;
}
export interface RefreshOp {
  kind: "refresh";
  playerIdx: PlayerIdx;
}
export interface DeleteOp {
  kind: "delete";
  instanceId: string;
  cause?: "compile" | "effect";
}
export interface FlipOp {
  kind: "flip";
  instanceId: string;
}
export interface ShiftOp {
  kind: "shift";
  instanceId: string;
  toLineIdx: LineIdx;
}
export interface PlayOp {
  kind: "play";
  /** Who plays, and onto whose side the card lands. */
  playerIdx: PlayerIdx;
  /**
   * Required when the card comes from playerIdx's hand. Omit when
   * fromDeck=true — the engine pops the top of the player's deck.
   */
  instanceId?: string;
  lineIdx: LineIdx;
  faceDown: boolean;
  /**
   * When true, source the card from the top of playerIdx's deck instead
   * of their hand. Used by effects like "Play the top card of your deck
   * face-down" (Life 0, Gravity 0/6, Water 1). Does NOT fire after-draw
   * triggers — the card never enters hand.
   */
  fromDeck?: boolean;
  /**
   * Insert beneath this anchor instance (Gravity 0 "play face-down under
   * this card"). The anchor must be in the destination line on the same
   * side. The inserted card lands covered, so its middle text does NOT
   * resolve and no "covered" replacement triggers fire — the anchor was
   * already uncovered and stays uncovered. Falls back to a top-of-stack
   * play if the anchor isn't present in that line.
   */
  underInstanceId?: string;
}
export interface ReturnOp {
  kind: "return";
  instanceId: string;
  /** Hand to return to. Default = card's current ownerIdx. */
  toHandOf?: PlayerIdx;
}
export interface RevealOp {
  kind: "reveal";
  instanceId: string;
  toPlayerIdx: PlayerIdx;
}
export interface TransferOwnershipOp {
  kind: "transfer-ownership";
  instanceId: string;
  newOwnerIdx: PlayerIdx;
}

export interface PromptOp {
  kind: "prompt";
  prompt: Prompt;
}

export type OpResult =
  | undefined
  | { drawn: CardInstance[] }
  | { discarded: CardInstance | null }
  | { deleted: CardInstance | null }
  | { flipped: { instanceId: string; nowFaceDown: boolean } | null }
  | { shifted: boolean }
  | { played: CardInstance | null }
  | { returned: CardInstance | null }
  | { revealed: CardInstance | null }
  | PromptResponse;

// ---------- Prompts ----------

export type Prompt =
  | ChooseCardPrompt
  | ChooseLinePrompt
  | ChooseOptionPrompt
  | DiscardSelectionPrompt;

export interface ChooseCardPrompt {
  kind: "choose-card";
  promptId: string;
  forPlayerIdx: PlayerIdx;
  filter: CardFilter;
  optional: boolean;
  reason: string;
}

export interface ChooseLinePrompt {
  kind: "choose-line";
  promptId: string;
  forPlayerIdx: PlayerIdx;
  allowedLines: LineIdx[];
  reason: string;
}

export interface ChooseOptionPrompt {
  kind: "choose-option";
  promptId: string;
  forPlayerIdx: PlayerIdx;
  options: { id: string; label: string }[];
  reason: string;
}

export interface DiscardSelectionPrompt {
  kind: "discard-selection";
  promptId: string;
  forPlayerIdx: PlayerIdx;
  count: number;
  reason: string;
}

export interface CardFilter {
  side?: Side | "any";
  faceUp?: boolean;
  faceDown?: boolean;
  covered?: boolean;
  uncovered?: boolean;
  inLines?: LineIdx[];
  ownerIdx?: PlayerIdx;
  /** Restrict to specific instance IDs. */
  instanceIds?: string[];
}

export type PromptResponse =
  | { kind: "card-chosen"; promptId: string; instanceId: string | null }
  | { kind: "line-chosen"; promptId: string; lineIdx: LineIdx }
  | { kind: "option-chosen"; promptId: string; optionId: string }
  | { kind: "discard-chosen"; promptId: string; instanceIds: string[] };
