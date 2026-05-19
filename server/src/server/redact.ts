/**
 * Per-viewer state filtering. Both players see public information (trash,
 * field, protocols, scores, log) but each player's own hand/deck remains
 * private to themselves; opponents only see counts. Face-down cards on the
 * field reveal their identity to no-one but their owner.
 */

import type { CardInstance, GameState, PlayerIdx } from "../engine/types.js";

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
  /** Deck is always count-only — even your own deck top is unknown until drawn. */
  deckCount: number;
  trash: RedactedCard[];
  protocols: { protocol: string; compiled: boolean }[];
}

export interface RedactedState {
  id: string;
  phase: GameState["phase"];
  activePlayerIdx: PlayerIdx;
  turnNumber: number;
  control: GameState["control"];
  winnerIdx: PlayerIdx | null;
  pendingPrompt: GameState["pendingPrompt"];
  players: [RedactedPlayer, RedactedPlayer];
  stacks: RedactedCard[][][];
  /** Public log entries — currently unfiltered; all events are public. */
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
    players: [
      redactPlayer(state, 0, viewer),
      redactPlayer(state, 1, viewer),
    ],
    stacks: state.stacks.map((side, p) =>
      side.map((stack) =>
        stack.cards.map((c) => redactFieldCard(c, p as PlayerIdx, viewer)),
      ),
    ),
    log: state.log,
  };
}

function redactPlayer(state: GameState, idx: PlayerIdx, viewer: ViewerId): RedactedPlayer {
  const player = state.players[idx];
  const isSelf = viewer === idx;
  return {
    id: player.id,
    hand: isSelf
      ? player.hand.map((c) => publicCard(c))
      : { count: player.hand.length },
    deckCount: player.deck.length,
    trash: player.trash.map((c) => publicCard(c)),
    protocols: player.protocols.map((p) => ({ protocol: p.protocol, compiled: p.compiled })),
  };
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
