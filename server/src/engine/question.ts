/**
 * Unified Question / Answer types — the single client-facing interface
 * for every player decision in the game (draft picks, action choice,
 * compile-line choice, control rearrange, and every mid-effect prompt).
 *
 * The engine populates `state.pendingQuestion` whenever it blocks; the
 * client picks an option by id and emits an Answer. The internal Prompt
 * type (server/src/engine/ops.ts) stays as the runtime's resume mechanism
 * — a Question wraps a Prompt 1:1 when the block came from a generator.
 */
import type { LineIdx, PlayerIdx } from "./types.js";
import type { ProtocolName } from "../shared/protocols.js";

// ---------- Option payloads ----------

export type DraftPickPayload = { protocols: ProtocolName[] };
export type ActionPayload =
  | { kind: "play"; instanceId: string; lineIdx: LineIdx; faceDown: boolean }
  | { kind: "refresh" };
export type CompileLinePayload = { lineIdx: LineIdx };
export type RearrangePayload =
  | { kind: "rearrange"; side: PlayerIdx; newOrder: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] }
  | { kind: "skip" };
export type ChooseCardPayload = { instanceId: string | null };
export type ChooseLinePayload = { lineIdx: LineIdx };
export type ChooseOptionPayload = { optionId: string };
export type DiscardSelectionPayload = { instanceId: string };
export type PlayFromHandPayload = { instanceId: string; lineIdx: LineIdx; faceDown: boolean };
export type AckPayload = Record<string, never>;

export type OptionPayload =
  | DraftPickPayload
  | ActionPayload
  | CompileLinePayload
  | RearrangePayload
  | ChooseCardPayload
  | ChooseLinePayload
  | ChooseOptionPayload
  | DiscardSelectionPayload
  | PlayFromHandPayload
  | AckPayload;

export interface Option {
  id: string;
  label: string;
  payload: OptionPayload;
}

// ---------- Question variants ----------

interface QuestionBase {
  questionId: string;
  forPlayerIdx: PlayerIdx;
  reason: string;
  options: Option[];
  /** Only set for multi-select questions (discard-selection). */
  picks?: { min: number; max: number };
}

export type Question =
  | (QuestionBase & { kind: "draft-pick"; pickCount: 1 | 2 })
  | (QuestionBase & { kind: "action" })
  | (QuestionBase & { kind: "compile-line" })
  | (QuestionBase & { kind: "control-rearrange" })
  | (QuestionBase & { kind: "choose-card"; optional: boolean })
  | (QuestionBase & { kind: "choose-line" })
  | (QuestionBase & { kind: "choose-option" })
  | (QuestionBase & { kind: "discard-selection" })
  | (QuestionBase & { kind: "play-from-hand" })
  | (QuestionBase & {
      kind: "show-hand";
      ownerIdx: PlayerIdx;
      cards: { instanceId: string; cardId: string }[];
    });

export type QuestionKind = Question["kind"];

/** Opponent-visible summary (no options, no revealed cards). */
export interface OpponentQuestionSummary {
  kind: QuestionKind;
  reason: string;
  forPlayerIdx: PlayerIdx;
  /** Only populated for discard-selection. */
  count?: number;
}

// ---------- Answer ----------

export type Answer =
  | { kind: "single"; questionId: string; optionId: string }
  | { kind: "multi"; questionId: string; optionIds: string[] };
