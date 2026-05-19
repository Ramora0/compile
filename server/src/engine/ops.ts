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
  /** Whose hand the card comes from, and onto whose side it lands. */
  playerIdx: PlayerIdx;
  instanceId: string;
  lineIdx: LineIdx;
  faceDown: boolean;
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
