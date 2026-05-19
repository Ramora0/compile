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
  deckCount: number;
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
    };

export type PromptResponse =
  | { kind: "card-chosen"; promptId: string; instanceId: string | null }
  | { kind: "line-chosen"; promptId: string; lineIdx: LineIdx }
  | { kind: "option-chosen"; promptId: string; optionId: string }
  | { kind: "discard-chosen"; promptId: string; instanceIds: string[] };

export type ControlState = PlayerIdx | "neutral";

export interface RedactedState {
  id: string;
  phase: Phase;
  activePlayerIdx: PlayerIdx;
  turnNumber: number;
  control: ControlState;
  winnerIdx: PlayerIdx | null;
  pendingPrompt: Prompt | null;
  players: [RedactedPlayer, RedactedPlayer];
  /** stacks[playerIdx][lineIdx] */
  stacks: RedactedCard[][][];
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
