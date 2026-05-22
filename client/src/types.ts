// Mirror of the subset of server types the UI needs. Keeping these in-sync
// with `server/src/server/redact.ts` and `server/src/engine/question.ts`
// is a manual exercise; the client doesn't import from the server package.

export type PlayerIdx = 0 | 1;
export type LineIdx = 0 | 1 | 2;
export type Phase =
  | "draft"
  | "start"
  | "check-control"
  | "check-compile"
  | "action"
  | "check-cache"
  | "end"
  | "game-over";

export const PROTOCOLS = [
  "apathy", "darkness", "death", "fire", "gravity", "hate",
  "life", "light", "love", "metal", "plague", "psychic",
  "speed", "spirit", "water",
] as const;
export type ProtocolName = (typeof PROTOCOLS)[number];

export interface RedactedCard {
  instanceId: string;
  cardId: string | null;
  faceDown: boolean;
  ownerIdx: PlayerIdx;
}

export interface RedactedPlayer {
  id: string;
  hand: RedactedCard[] | { count: number };
  deck: RedactedCard[] | { count: number };
  trash: RedactedCard[];
  protocols: { protocol: string; compiled: boolean }[];
}

export type ControlState = PlayerIdx | "neutral";

// ---------- Question / Option / Answer ----------

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

interface QuestionBase {
  questionId: string;
  forPlayerIdx: PlayerIdx;
  reason: string;
  options: Option[];
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

export interface OpponentQuestionSummary {
  kind: QuestionKind;
  reason: string;
  forPlayerIdx: PlayerIdx;
  /** Only populated for discard-selection. */
  count?: number;
}

export type Answer =
  | { kind: "single"; questionId: string; optionId: string }
  | { kind: "multi"; questionId: string; optionIds: string[] };

// ---------- Draft snapshot ----------

export interface DraftPick {
  playerIdx: PlayerIdx;
  protocols: ProtocolName[];
}

export interface RedactedDraft {
  picks: DraftPick[];
  remainingPool: ProtocolName[];
  whoseTurn: PlayerIdx | null;
  pickCount: 1 | 2;
}

// ---------- Redacted state ----------

export interface RedactedState {
  id: string;
  phase: Phase;
  activePlayerIdx: PlayerIdx;
  turnNumber: number;
  control: ControlState;
  gameOver: { winnerIdx: PlayerIdx } | null;
  pendingQuestion: Question | null;
  opponentQuestion: OpponentQuestionSummary | null;
  draft: RedactedDraft | null;
  opponentOnline: boolean | null;
  players: [RedactedPlayer, RedactedPlayer];
  /** stacks[playerIdx][lineIdx] */
  stacks: RedactedCard[][][];
  lineValues: [number[], number[]];
  log: LogEntry[];
}

export interface LogEntry {
  readonly t: number;
  readonly type: string;
  readonly playerIdx?: PlayerIdx;
  readonly lineIdx?: LineIdx;
  readonly fromLineIdx?: LineIdx;
  readonly toLineIdx?: LineIdx;
  readonly fromPlayerIdx?: PlayerIdx;
  readonly toPlayerIdx?: PlayerIdx;
  readonly instanceId?: string;
  readonly cardId?: string | null;
  readonly faceDown?: boolean;
  readonly nowFaceDown?: boolean;
  readonly cause?: string;
  readonly protocol?: string;
  readonly count?: number;
  readonly turn?: number;
  readonly turnNumber?: number;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly winnerIdx?: PlayerIdx;
  readonly newOwnerIdx?: PlayerIdx;
  readonly fromIdx?: PlayerIdx;
  readonly toIdx?: PlayerIdx;
  readonly side?: PlayerIdx;
  readonly newOrder?: readonly number[];
  readonly promptId?: string;
  readonly kind?: string;
  readonly forPlayerIdx?: PlayerIdx;
  readonly revealedCardId?: string | null;
  readonly [k: string]: unknown;
}

// ---------- Card filter (for prompt-target visualization) ----------

export type CardFilter = {
  side?: "self" | "opp" | "any";
  faceUp?: boolean;
  faceDown?: boolean;
  covered?: boolean;
  uncovered?: boolean;
  inLines?: LineIdx[];
  ownerIdx?: PlayerIdx;
  instanceIds?: string[];
};
