// Core engine types. Most shapes are filled in by Phase 5; Op and Prompt
// definitions live in ./ops.ts and are referenced here as type-only imports.

import type { CardValue, ProtocolName } from "../shared/protocols.js";
import type { Prompt } from "./ops.js";
import type { Question } from "./question.js";

export type PlayerIdx = 0 | 1;
export type LineIdx = 0 | 1 | 2;
export type Side = "self" | "opp";

export type Phase =
  | "draft"
  | "start"
  | "check-control"
  | "check-compile"
  | "action"
  | "check-cache"
  | "end"
  | "game-over";

export interface CardInstance {
  readonly instanceId: string;
  readonly cardId: string;
  faceDown: boolean;
  /** Owner can change at runtime via Give / Take effects (rules.md:106). */
  ownerIdx: PlayerIdx;
}

/**
 * Context handed to a card effect generator. Methods do not act directly —
 * they produce Ops which the engine pumps. Implemented in Phase 6.
 */
export interface CardCtx {
  readonly self: PlayerIdx;
  readonly opp: PlayerIdx;
  readonly thisInstanceId: string;
}

/** Context handed to a static rule's apply() — read-only view of game state. */
export interface RuleCtx {
  readonly self: PlayerIdx;
  readonly opp: PlayerIdx;
  readonly thisInstanceId: string;
  /** Live game state. Passives that key off cross-side or per-line counts
   *  (e.g. Apathy 0's "1 per face-down card in this line") need this. */
  readonly state: GameState;
}

/**
 * A persistent rule modification produced by a static-rule passive.
 * Composed by the override registry (Phase 7). The discriminant determines
 * how the engine's value/play/phase logic consults it.
 */
export type RuleOverride =
  | { kind: "skip-phase"; phase: "check-cache" | "check-control"; ownerIdx: PlayerIdx }
  | {
      kind: "value-modifier";
      lineIdx: LineIdx;
      side: Side;
      ownerIdx: PlayerIdx;
      delta: (lineSnapshot: LineSnapshot) => number;
    }
  | {
      kind: "face-down-value";
      lineIdx: LineIdx;
      ownerIdx: PlayerIdx;
      value: number;
    }
  | {
      kind: "play-restriction";
      lineIdx: LineIdx | "any";
      affects: PlayerIdx;
      forbid: "any-card" | "face-down" | "face-up";
    }
  | {
      kind: "compile-restriction";
      affects: PlayerIdx;
      turnsRemaining: number;
    }
  | {
      kind: "ignore-middle";
      lineIdx: LineIdx;
      /**
       * "self" — suppresses middles on the override-owner's side only.
       * "opp"  — suppresses middles on the opponent's side only.
       * "any"  — suppresses middles on both sides ("cards in this line"),
       *          used by Apathy 2 ("Ignore all middle commands of cards in
       *          this line").
       */
      side: Side | "any";
      ownerIdx: PlayerIdx;
    }
  | {
      kind: "manipulable-while-covered";
      instanceId: string;
    }
  | {
      /** Allows `affects` player to play any card face-up into any line, ignoring protocol match. */
      kind: "play-anywhere";
      affects: PlayerIdx;
    };

/** Read-only snapshot of one line/side passed into value-modifier callbacks. */
export interface LineSnapshot {
  readonly cards: readonly CardInstance[];
  readonly faceDownCount: number;
  readonly faceUpCount: number;
}

export interface ProtocolSlot {
  readonly protocol: ProtocolName;
  compiled: boolean;
}

export interface PlayerState {
  readonly id: string;
  hand: CardInstance[];
  /** Top of deck = end of array (so push/pop is O(1) for draws). */
  deck: CardInstance[];
  trash: CardInstance[];
  protocols: [ProtocolSlot, ProtocolSlot, ProtocolSlot];
}

/** Stack of cards in a single line on a single side. Top of stack = last index = uncovered. */
export interface Stack {
  cards: CardInstance[];
}

export type ControlState = PlayerIdx | "neutral";

export interface GameState {
  readonly id: string;
  readonly rngSeed: number;
  rngCursor: number;
  players: [PlayerState, PlayerState];
  /** stacks[playerIdx][lineIdx] */
  stacks: [[Stack, Stack, Stack], [Stack, Stack, Stack]];
  phase: Phase;
  activePlayerIdx: PlayerIdx;
  turnNumber: number;
  control: ControlState;
  pendingPrompt: Prompt | null;
  /**
   * The single externally-visible question the engine is currently asking.
   * Populated by Game.run() at every block point; wraps a Prompt 1:1 when the
   * block came from a generator, or is freshly built for phase-machine blocks
   * (action / compile-line / control-rearrange). Cleared by Game.commit().
   */
  pendingQuestion: Question | null;
  /** Descriptors of in-flight effect frames. The runnable generators live outside GameState. */
  opStack: { source: string }[];
  overrides: { sourceInstanceId: string; override: RuleOverride }[];
  log: GameEvent[];
  winnerIdx: PlayerIdx | null;
  /** Compile already performed this turn — only one allowed per turn. */
  compiledThisTurn: boolean;
  /**
   * Pending compile bans. `compileBans[p]` is the number of upcoming
   * Check-Compile phases on player p's turn to skip. Metal 1 increments
   * `compileBans[opp]` so the opponent cannot compile on their next turn;
   * the count is decremented (and the phase skipped) when that player's
   * Check-Compile phase fires.
   */
  compileBans: [number, number];
}

export interface GameEvent {
  readonly t: number;
  readonly type: string;
  readonly [k: string]: unknown;
}

export type { CardValue, ProtocolName };
