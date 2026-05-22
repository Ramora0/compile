/**
 * Per-viewer state filtering. Both players see public information (trash,
 * field, protocols, scores) but each player's own hand/deck remains private
 * to themselves; opponents only see counts. Face-down cards on the field
 * reveal their identity to no-one but their owner. Log entries are scrubbed
 * to match: cardId / revealedCardId are nulled for events whose card never
 * became visible to the viewer (opponent discards, face-down plays/shifts,
 * returns to opponent's hand, targeted reveals).
 */

import { LINE_INDICES, lineValue } from "../engine/field.js";
import { PROTOCOLS, type ProtocolName } from "../shared/protocols.js";
import type { CardInstance, GameEvent, GameState, PlayerIdx } from "../engine/types.js";
import type {
  OpponentQuestionSummary,
  Question,
} from "../engine/question.js";
import type { DraftPick } from "../engine/setup.js";

const PROTOCOL_RANK: Map<string, number> = new Map(
  PROTOCOLS.map((p, i) => [p, i]),
);

export type ViewerId = PlayerIdx | "spectator";

export interface RedactedCard {
  instanceId: string;
  /** Hidden when the viewer shouldn't see the identity (face-down + not owner). */
  cardId: string | null;
  faceDown: boolean;
  ownerIdx: PlayerIdx;
}

export interface RedactedPlayer {
  id: string;
  /** Full hand for self; opponent sees only the count. */
  hand: RedactedCard[] | { count: number };
  /**
   * For self: the full set of deck cards sorted by protocol then value, so the
   * viewer can browse what's left without learning draw order. For opponent /
   * spectator: count-only.
   */
  deck: RedactedCard[] | { count: number };
  trash: RedactedCard[];
  protocols: { protocol: string; compiled: boolean }[];
}

/** Public summary of the draft phase (whose turn, pool, picks so far). */
export interface RedactedDraft {
  picks: DraftPick[];
  remainingPool: ProtocolName[];
  whoseTurn: PlayerIdx | null;
  pickCount: 1 | 2;
}

export interface RedactedState {
  id: string;
  phase: GameState["phase"];
  activePlayerIdx: PlayerIdx;
  turnNumber: number;
  control: GameState["control"];
  /**
   * Set once a winner is determined. Mirrors `state.winnerIdx`; carried
   * separately so the client doesn't have to inspect winnerIdx separately.
   */
  gameOver: { winnerIdx: PlayerIdx } | null;
  /**
   * The single externally-visible question awaiting an answer. Full detail
   * (options, etc.) is sent only to the addressee; opponents see
   * `opponentQuestion` instead.
   */
  pendingQuestion: Question | null;
  /**
   * Set when a pending question is awaiting the *other* viewer's input. The
   * targeted viewer gets it through `pendingQuestion` with full detail; this
   * is the safe-to-share summary for the non-target side so the UI can
   * describe what the opponent is doing.
   */
  opponentQuestion: OpponentQuestionSummary | null;
  /**
   * Draft snapshot (whose turn, remaining pool, picks so far). Null once
   * the in-game state has begun.
   */
  draft: RedactedDraft | null;
  /** Opponent's connection presence; null = unknown / no opponent yet. */
  opponentOnline: boolean | null;
  players: [RedactedPlayer, RedactedPlayer];
  stacks: RedactedCard[][][];
  /**
   * Effective line totals per side, including face-down-value overrides and
   * value-modifier passives. lineValues[playerIdx][lineIdx]. Computed on the
   * server so clients don't have to replicate value-computation logic.
   */
  lineValues: [number[], number[]];
  /**
   * Log entries scrubbed per viewer: cardId / revealedCardId are nulled in
   * events that would otherwise leak secret information. The array length is
   * preserved across viewers so animation queues stay in sync.
   */
  log: GameState["log"];
}

export interface RedactInput {
  /** In-game state. Null if the match is still in draft. */
  state: GameState | null;
  /** Match-level question (draft) overlay, when no Game exists yet. */
  matchQuestion: Question | null;
  draft: RedactedDraft | null;
  opponentOnline: boolean | null;
  /** Stable game/match id surfaced when there's no GameState yet. */
  matchId: string;
}

const EMPTY_STACKS = [
  [[], [], []],
  [[], [], []],
] as RedactedCard[][][];

export function redactState(input: RedactInput, viewer: ViewerId): RedactedState {
  const { state, matchQuestion, draft, opponentOnline, matchId } = input;

  // Determine which (single) question to surface and how to redact it.
  const rawQuestion = state?.pendingQuestion ?? matchQuestion ?? null;
  const pendingQuestion =
    rawQuestion && shouldSeeQuestion(rawQuestion.forPlayerIdx, viewer)
      ? redactQuestionForViewer(rawQuestion, viewer)
      : null;
  const opponentQuestion =
    rawQuestion && !shouldSeeQuestion(rawQuestion.forPlayerIdx, viewer) && viewer !== "spectator"
      ? summarizeQuestion(rawQuestion)
      : null;

  if (!state) {
    return {
      id: matchId,
      phase: "draft",
      activePlayerIdx: 0,
      turnNumber: 0,
      control: "neutral",
      gameOver: null,
      pendingQuestion,
      opponentQuestion,
      draft,
      opponentOnline,
      players: [emptyPlayer(0), emptyPlayer(1)],
      stacks: EMPTY_STACKS,
      lineValues: [
        [0, 0, 0],
        [0, 0, 0],
      ],
      log: [],
    };
  }

  return {
    id: state.id,
    phase: state.phase,
    activePlayerIdx: state.activePlayerIdx,
    turnNumber: state.turnNumber,
    control: state.control,
    gameOver: state.winnerIdx !== null ? { winnerIdx: state.winnerIdx } : null,
    pendingQuestion,
    opponentQuestion,
    draft,
    opponentOnline,
    players: [
      redactPlayer(state, 0, viewer),
      redactPlayer(state, 1, viewer),
    ],
    stacks: state.stacks.map((side, p) =>
      side.map((stack) =>
        stack.cards.map((c) => redactFieldCard(c, p as PlayerIdx, viewer)),
      ),
    ),
    lineValues: [
      LINE_INDICES.map((l) => lineValue(state, 0, l)),
      LINE_INDICES.map((l) => lineValue(state, 1, l)),
    ],
    log: state.log.map((ev) => redactLogEntry(ev, viewer)),
  };
}

function emptyPlayer(idx: PlayerIdx): RedactedPlayer {
  return {
    id: `p${idx}`,
    hand: { count: 0 },
    deck: { count: 0 },
    trash: [],
    protocols: [],
  };
}

/**
 * Scrub identity fields in a log event the viewer shouldn't be able to learn
 * from. Keeps the event in place (animation queues key off log length) but
 * nulls cardId / revealedCardId when the event's outcome leaves the card
 * hidden from this viewer.
 */
function redactLogEntry(ev: GameEvent, viewer: ViewerId): GameEvent {
  const playerIdx = typeof ev.playerIdx === "number" ? (ev.playerIdx as PlayerIdx) : null;
  const toPlayerIdx = typeof ev.toPlayerIdx === "number" ? (ev.toPlayerIdx as PlayerIdx) : null;
  const faceDown = ev.faceDown === true;

  switch (ev.type) {
    case "discard":
      if (viewer !== playerIdx) return { ...ev, cardId: null };
      return ev;
    case "play":
      if (faceDown && viewer !== playerIdx) return { ...ev, cardId: null };
      return ev;
    case "shift":
      if (faceDown && viewer !== playerIdx) return { ...ev, cardId: null };
      return ev;
    case "return":
      if (viewer !== toPlayerIdx) return { ...ev, cardId: null };
      return ev;
    case "reveal":
      if (viewer !== toPlayerIdx) return { ...ev, revealedCardId: null };
      return ev;
    default:
      return ev;
  }
}

function redactPlayer(state: GameState, idx: PlayerIdx, viewer: ViewerId): RedactedPlayer {
  const player = state.players[idx];
  const isSelf = viewer === idx;
  return {
    id: player.id,
    hand: isSelf
      ? player.hand.map((c) => publicCard(c))
      : { count: player.hand.length },
    deck: isSelf
      ? player.deck.map((c) => publicCard(c)).sort(byProtocolThenValue)
      : { count: player.deck.length },
    trash: player.trash.map((c) => publicCard(c)),
    protocols: player.protocols.map((p) => ({ protocol: p.protocol, compiled: p.compiled })),
  };
}

function byProtocolThenValue(a: RedactedCard, b: RedactedCard): number {
  const [ap, av] = splitCardId(a.cardId);
  const [bp, bv] = splitCardId(b.cardId);
  const ar = PROTOCOL_RANK.get(ap) ?? Number.MAX_SAFE_INTEGER;
  const br = PROTOCOL_RANK.get(bp) ?? Number.MAX_SAFE_INTEGER;
  if (ar !== br) return ar - br;
  return av - bv;
}

function splitCardId(id: string | null): [string, number] {
  if (!id) return ["", 0];
  const m = id.match(/^([a-z]+)-(\d+)$/);
  if (!m) return [id, 0];
  return [m[1]!, Number(m[2]!)];
}

function redactFieldCard(c: CardInstance, ownerIdx: PlayerIdx, viewer: ViewerId): RedactedCard {
  if (!c.faceDown) {
    return { instanceId: c.instanceId, cardId: c.cardId, faceDown: false, ownerIdx };
  }
  const reveal = viewer === ownerIdx;
  return {
    instanceId: c.instanceId,
    cardId: reveal ? c.cardId : null,
    faceDown: true,
    ownerIdx,
  };
}

function publicCard(c: CardInstance): RedactedCard {
  return {
    instanceId: c.instanceId,
    cardId: c.cardId,
    faceDown: c.faceDown,
    ownerIdx: c.ownerIdx,
  };
}

function shouldSeeQuestion(forPlayerIdx: PlayerIdx, viewer: ViewerId): boolean {
  if (viewer === "spectator") return false;
  return viewer === forPlayerIdx;
}

function summarizeQuestion(q: Question): OpponentQuestionSummary {
  const out: OpponentQuestionSummary = {
    kind: q.kind,
    reason: q.reason,
    forPlayerIdx: q.forPlayerIdx,
  };
  if (q.kind === "discard-selection" && q.picks) out.count = q.picks.min;
  return out;
}

/**
 * Redact a Question for the addressee. Currently a no-op (the addressee may
 * see the full option list); reserved for future per-option filtering (e.g.
 * a show-hand question carrying card identities the viewer is entitled to
 * see only because they're the target).
 */
function redactQuestionForViewer(q: Question, _viewer: ViewerId): Question {
  return q;
}
