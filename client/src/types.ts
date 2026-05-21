// Mirror of the subset of server types the UI needs. Keeping these in-sync
// with `server/src/server/redact.ts` and `server/src/engine/{types,ops,actions}.ts`
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

export type Prompt =
  | {
      kind: "choose-card";
      promptId: string;
      forPlayerIdx: PlayerIdx;
      filter: CardFilter;
      optional: boolean;
      reason: string;
    }
  | {
      kind: "choose-line";
      promptId: string;
      forPlayerIdx: PlayerIdx;
      allowedLines: LineIdx[];
      reason: string;
    }
  | {
      kind: "choose-option";
      promptId: string;
      forPlayerIdx: PlayerIdx;
      options: { id: string; label: string }[];
      reason: string;
    }
  | {
      kind: "discard-selection";
      promptId: string;
      forPlayerIdx: PlayerIdx;
      count: number;
      reason: string;
    }
  | {
      kind: "play-from-hand";
      promptId: string;
      forPlayerIdx: PlayerIdx;
      reason: string;
      allowedLines: LineIdx[];
      orientation: "any" | "face-up" | "face-down";
    }
  | {
      kind: "show-hand";
      promptId: string;
      forPlayerIdx: PlayerIdx;
      reason: string;
      ownerIdx: PlayerIdx;
      cards: { instanceId: string; cardId: string }[];
    };

export type PromptResponse =
  | { kind: "card-chosen"; promptId: string; instanceId: string | null }
  | { kind: "line-chosen"; promptId: string; lineIdx: LineIdx }
  | { kind: "option-chosen"; promptId: string; optionId: string }
  | { kind: "discard-chosen"; promptId: string; instanceIds: string[] }
  | {
      kind: "play-from-hand-chosen";
      promptId: string;
      instanceId: string;
      lineIdx: LineIdx;
      faceDown: boolean;
    }
  | { kind: "ack"; promptId: string };

export type ControlState = PlayerIdx | "neutral";

/**
 * Lightweight description of a prompt awaiting the *opponent*. The server
 * sends this in place of the full prompt (which is redacted for the
 * non-target viewer) so the UI can describe what they're doing.
 */
export interface OpponentPromptSummary {
  kind: Prompt["kind"];
  reason: string;
  forPlayerIdx: PlayerIdx;
  /** Only populated for discard-selection. */
  count?: number;
}

export interface RedactedState {
  id: string;
  phase: Phase;
  activePlayerIdx: PlayerIdx;
  turnNumber: number;
  control: ControlState;
  winnerIdx: PlayerIdx | null;
  pendingPrompt: Prompt | null;
  opponentPromptSummary: OpponentPromptSummary | null;
  players: [RedactedPlayer, RedactedPlayer];
  /** stacks[playerIdx][lineIdx] */
  stacks: RedactedCard[][][];
  /** Effective line totals per side from the server (includes face-down-value overrides, value modifiers). */
  lineValues: [number[], number[]];
  /** Active player's compilable lines during check-compile (server-authoritative). */
  compilableLines: number[];
  /**
   * Per-hand-card legal play targets keyed by instanceId. Only populated for
   * cards in the viewer's own hand. The UI highlights drop zones from this;
   * the server's `validatePlayCard` is the source of truth.
   */
  playOptions: Record<string, { faceUpLines: number[]; faceDownLines: number[] }>;
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

export type PlayerAction =
  | { kind: "play"; instanceId: string; lineIdx: LineIdx; faceDown: boolean }
  | { kind: "refresh" };

// ---- socket events (server emits) ----
export interface DraftPromptEv {
  playerIdx: PlayerIdx;
  pickCount: number;
  remainingPool: ProtocolName[];
}

export interface DraftStartedEv {
  youngestPlayerIdx: PlayerIdx;
  order: { playerIdx: PlayerIdx; count: number }[];
  pool: ProtocolName[];
}
