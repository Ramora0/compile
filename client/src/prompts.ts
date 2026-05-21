// Client-side mirror of the server's prompt-target logic.
// Walks the redacted state to decide which cards / lanes are valid pick targets
// for a given pending Prompt. The server author is still the source of truth
// for *what to do* with the pick — we just need this to highlight legal targets
// and prevent clicks on illegal ones.

import type {
  CardFilter,
  LineIdx,
  PlayerIdx,
  Prompt,
  RedactedCard,
  RedactedState,
} from "./types.js";

export type CardLocation =
  | { kind: "field"; side: PlayerIdx; lineIdx: LineIdx; stackIdx: number; stackLen: number }
  | { kind: "hand"; ownerIdx: PlayerIdx };

export function matchesFilter(
  card: RedactedCard,
  where: CardLocation,
  filter: CardFilter,
  forPlayerIdx: PlayerIdx,
): boolean {
  if (filter.instanceIds && !filter.instanceIds.includes(card.instanceId)) return false;
  if (filter.ownerIdx !== undefined && card.ownerIdx !== filter.ownerIdx) return false;
  if (filter.faceUp === true && card.faceDown) return false;
  if (filter.faceDown === true && !card.faceDown) return false;

  if (where.kind === "field") {
    if (filter.side === "self" && where.side !== forPlayerIdx) return false;
    if (filter.side === "opp" && where.side === forPlayerIdx) return false;
    if (filter.inLines && !filter.inLines.includes(where.lineIdx)) return false;
    const isUncovered = where.stackIdx === where.stackLen - 1;
    if (filter.covered === true && isUncovered) return false;
    if (filter.uncovered === true && !isUncovered) return false;
  } else {
    // Hand cards only match if the filter explicitly mentioned them by instanceId.
    // Field-shape filters (side / inLines / covered) don't make sense for hand,
    // so require an explicit instanceIds list to opt in.
    if (!filter.instanceIds) return false;
    if (filter.side === "self" && where.ownerIdx !== forPlayerIdx) return false;
    if (filter.side === "opp" && where.ownerIdx === forPlayerIdx) return false;
  }
  return true;
}

export interface PromptTargets {
  /** Card instanceIds the player may click. */
  cards: Set<string>;
  /** Whether each matching card lives on the field or in a hand. */
  whereByInstance: Map<string, CardLocation>;
  /** Lanes that may be clicked (only populated for choose-line). */
  lines: Set<LineIdx>;
}

const EMPTY_TARGETS: PromptTargets = {
  cards: new Set(),
  whereByInstance: new Map(),
  lines: new Set(),
};

export function promptTargets(prompt: Prompt | null, state: RedactedState): PromptTargets {
  if (!prompt) return EMPTY_TARGETS;
  switch (prompt.kind) {
    case "choose-line":
      return { cards: new Set(), whereByInstance: new Map(), lines: new Set(prompt.allowedLines) };
    case "choose-option":
      return EMPTY_TARGETS;
    case "choose-card":
      return collectCardTargets(prompt.filter, prompt.forPlayerIdx, state);
    case "discard-selection": {
      // discard-selection is always from the prompted player's hand.
      const hand = state.players[prompt.forPlayerIdx].hand;
      const cards = new Set<string>();
      const whereByInstance = new Map<string, CardLocation>();
      if (Array.isArray(hand)) {
        for (const c of hand) {
          cards.add(c.instanceId);
          whereByInstance.set(c.instanceId, { kind: "hand", ownerIdx: prompt.forPlayerIdx });
        }
      }
      return { cards, whereByInstance, lines: new Set() };
    }
    case "play-from-hand":
      // Drag-drop UI handles target legality directly — no card/line highlights.
      return EMPTY_TARGETS;
    case "show-hand":
      // Display-only prompt; resolved by an ack button.
      return EMPTY_TARGETS;
  }
}

function collectCardTargets(
  filter: CardFilter,
  forPlayerIdx: PlayerIdx,
  state: RedactedState,
): PromptTargets {
  const cards = new Set<string>();
  const whereByInstance = new Map<string, CardLocation>();

  for (let side = 0; side < state.stacks.length; side++) {
    const sideStacks = state.stacks[side]!;
    for (let lineIdx = 0; lineIdx < sideStacks.length; lineIdx++) {
      const stack = sideStacks[lineIdx]!;
      for (let stackIdx = 0; stackIdx < stack.length; stackIdx++) {
        const card = stack[stackIdx]!;
        const where: CardLocation = {
          kind: "field",
          side: side as PlayerIdx,
          lineIdx: lineIdx as LineIdx,
          stackIdx,
          stackLen: stack.length,
        };
        if (matchesFilter(card, where, filter, forPlayerIdx)) {
          cards.add(card.instanceId);
          whereByInstance.set(card.instanceId, where);
        }
      }
    }
  }

  // Also consider hand cards (only matches when filter pins instanceIds).
  for (let p = 0; p < state.players.length; p++) {
    const hand = state.players[p as PlayerIdx]!.hand;
    if (!Array.isArray(hand)) continue;
    for (const card of hand) {
      const where: CardLocation = { kind: "hand", ownerIdx: p as PlayerIdx };
      if (matchesFilter(card, where, filter, forPlayerIdx)) {
        cards.add(card.instanceId);
        whereByInstance.set(card.instanceId, where);
      }
    }
  }

  return { cards, whereByInstance, lines: new Set() };
}
