/**
 * Per-viewer state filtering. Both players see public information (trash,
 * field, protocols, scores) but each player's own hand/deck remains private
 * to themselves; opponents only see counts. Face-down cards on the field
 * reveal their identity to no-one but their owner. Log entries are scrubbed
 * to match: cardId / revealedCardId are nulled for events whose card never
 * became visible to the viewer (opponent discards, face-down plays/shifts,
 * returns to opponent's hand, targeted reveals).
 */

import { legalPlayLines } from "../engine/actions.js";
import { compilableLines, LINE_INDICES, lineValue } from "../engine/field.js";
import { PROTOCOLS } from "../shared/protocols.js";
import type { CardInstance, GameEvent, GameState, PlayerIdx } from "../engine/types.js";

const PROTOCOL_RANK: Map<string, number> = new Map(
  PROTOCOLS.map((p, i) => [p, i]),
);

export interface PlayOption {
  /** Line indices this card can legally be played into face-up right now. */
  faceUpLines: number[];
  /** Line indices this card can legally be played into face-down right now. */
  faceDownLines: number[];
}

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

/**
 * Lightweight description of a prompt awaiting the *other* player. Sent to
 * non-target viewers so the UI can describe what the opponent is being asked
 * to do ("discarding 2 cards", "choosing a card to delete") without leaking
 * the prompt's selectable card-ids, options, or revealed-hand snapshot.
 */
export interface OpponentPromptSummary {
  kind: "choose-card" | "choose-line" | "choose-option" | "discard-selection" | "play-from-hand" | "show-hand";
  reason: string;
  forPlayerIdx: PlayerIdx;
  /** Only populated for discard-selection. */
  count?: number;
}

export interface RedactedState {
  id: string;
  phase: GameState["phase"];
  activePlayerIdx: PlayerIdx;
  turnNumber: number;
  control: GameState["control"];
  winnerIdx: PlayerIdx | null;
  pendingPrompt: GameState["pendingPrompt"];
  /**
   * Set when a pending prompt is awaiting the *other* viewer's input. The
   * targeted viewer gets it through `pendingPrompt` with full detail; this
   * is the safe-to-share summary for the non-target side so the UI can
   * describe what the opponent is doing.
   */
  opponentPromptSummary: OpponentPromptSummary | null;
  players: [RedactedPlayer, RedactedPlayer];
  stacks: RedactedCard[][][];
  /**
   * Effective line totals per side, including face-down-value overrides and
   * value-modifier passives. lineValues[playerIdx][lineIdx]. Computed on the
   * server so clients don't have to replicate value-computation logic.
   */
  lineValues: [number[], number[]];
  /**
   * Active player's compilable line indices during the check-compile phase
   * (empty otherwise). The client renders the compile prompt from this list
   * verbatim — it never recomputes which lines qualify.
   */
  compilableLines: number[];
  /**
   * Per-hand-card legal play targets for the viewer (keyed by instanceId).
   * Empty for spectators (no hand) and for the opponent's hand cards (private).
   * Computed via the engine's `validatePlayCard` so the client UI can highlight
   * legal drop zones without reimplementing protocol-match, play-anywhere, or
   * play-restriction logic.
   */
  playOptions: Record<string, PlayOption>;
  /**
   * Log entries scrubbed per viewer: cardId / revealedCardId are nulled in
   * events that would otherwise leak secret information (opponent discards,
   * face-down plays/shifts, returns to opponent's hand, targeted reveals).
   * The array length is preserved across viewers so animation queues stay
   * in sync.
   */
  log: GameState["log"];
}

export function redactState(state: GameState, viewer: ViewerId): RedactedState {
  return {
    id: state.id,
    phase: state.phase,
    activePlayerIdx: state.activePlayerIdx,
    turnNumber: state.turnNumber,
    control: state.control,
    winnerIdx: state.winnerIdx,
    pendingPrompt:
      state.pendingPrompt && shouldSeePrompt(state.pendingPrompt.forPlayerIdx, viewer)
        ? state.pendingPrompt
        : null,
    opponentPromptSummary: summarizeOpponentPrompt(state.pendingPrompt, viewer),
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
    compilableLines:
      state.phase === "check-compile" && state.winnerIdx === null
        ? compilableLines(state, state.activePlayerIdx)
        : [],
    playOptions: computePlayOptions(state, viewer),
    log: state.log.map((ev) => redactLogEntry(ev, viewer)),
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
      // Opponent's hand → their trash. Trash is public, but the act of
      // discarding-by-name shouldn't broadcast which card just left the hand.
      if (viewer !== playerIdx) return { ...ev, cardId: null };
      return ev;
    case "play":
      // Face-down plays land hidden on the field; only the owner knows the id.
      if (faceDown && viewer !== playerIdx) return { ...ev, cardId: null };
      return ev;
    case "shift":
      // Face-down shifts stay hidden; cardId would leak the moved card.
      if (faceDown && viewer !== playerIdx) return { ...ev, cardId: null };
      return ev;
    case "return":
      // Card lands in toPlayerIdx's hand (private). Hide from everyone else.
      if (viewer !== toPlayerIdx) return { ...ev, cardId: null };
      return ev;
    case "reveal":
      // Targeted reveal: only ev.toPlayerIdx is entitled to see the identity.
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
  // Face-up cards: identity public.
  // Face-down cards: only the owner sees the cardId.
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

function shouldSeePrompt(forPlayerIdx: PlayerIdx, viewer: ViewerId): boolean {
  if (viewer === "spectator") return false;
  return viewer === forPlayerIdx;
}

function summarizeOpponentPrompt(
  prompt: GameState["pendingPrompt"],
  viewer: ViewerId,
): OpponentPromptSummary | null {
  if (!prompt) return null;
  if (viewer === "spectator") return null;
  if (viewer === prompt.forPlayerIdx) return null;
  const base: OpponentPromptSummary = {
    kind: prompt.kind,
    reason: prompt.reason,
    forPlayerIdx: prompt.forPlayerIdx,
  };
  if (prompt.kind === "discard-selection") base.count = prompt.count;
  return base;
}

function computePlayOptions(state: GameState, viewer: ViewerId): Record<string, PlayOption> {
  if (viewer === "spectator") return {};
  const out: Record<string, PlayOption> = {};
  for (const card of state.players[viewer].hand) {
    out[card.instanceId] = legalPlayLines(state, viewer, card.instanceId);
  }
  return out;
}
