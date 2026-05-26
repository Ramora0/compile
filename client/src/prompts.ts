/**
 * Derive UI selection targets (which cards / lines / option ids the user
 * can click) from the server's enumerated options. The server already
 * applied every filter, replacement rule, and validation — the client just
 * extracts what was offered.
 */
import type {
  ChooseCardPayload,
  ChooseLinePayload,
  ChooseOptionPayload,
  DiscardSelectionPayload,
  LineIdx,
  PlayerIdx,
  Question,
  RedactedState,
} from "./types.js";

export type CardLocation =
  | { kind: "field"; side: PlayerIdx; lineIdx: LineIdx; stackIdx: number; stackLen: number }
  | { kind: "hand"; ownerIdx: PlayerIdx };

export interface PromptTargets {
  /** Card instanceIds the player may click. */
  cards: Set<string>;
  /** Whether each matching card lives on the field or in a hand. */
  whereByInstance: Map<string, CardLocation>;
  /** Lanes that may be clicked (only populated for choose-line). */
  lines: Set<LineIdx>;
  /** Option ids selectable for choose-option (button list). */
  options: Set<string>;
}

const EMPTY_TARGETS: PromptTargets = {
  cards: new Set(),
  whereByInstance: new Map(),
  lines: new Set(),
  options: new Set(),
};

export function promptTargets(
  q: Question | null,
  state: RedactedState,
): PromptTargets {
  if (!q) return EMPTY_TARGETS;

  switch (q.kind) {
    case "choose-line":
    case "compile-line": {
      // compile-line carries the same `{ lineIdx }` payload shape as choose-line,
      // so it drives the identical board line-highlight + select-then-confirm UI.
      const lines = new Set<LineIdx>();
      for (const o of q.options) {
        lines.add((o.payload as ChooseLinePayload).lineIdx);
      }
      return { cards: new Set(), whereByInstance: new Map(), lines, options: new Set() };
    }
    case "choose-option": {
      const options = new Set<string>();
      for (const o of q.options) {
        options.add((o.payload as ChooseOptionPayload).optionId);
      }
      return { cards: new Set(), whereByInstance: new Map(), lines: new Set(), options };
    }
    case "choose-card": {
      const cards = new Set<string>();
      for (const o of q.options) {
        const p = o.payload as ChooseCardPayload;
        if (p.instanceId) cards.add(p.instanceId);
      }
      return {
        cards,
        whereByInstance: locateCards(state, cards),
        lines: new Set(),
        options: new Set(),
      };
    }
    case "discard-selection": {
      const cards = new Set<string>();
      const where = new Map<string, CardLocation>();
      for (const o of q.options) {
        const p = o.payload as DiscardSelectionPayload;
        cards.add(p.instanceId);
        where.set(p.instanceId, { kind: "hand", ownerIdx: q.forPlayerIdx });
      }
      return { cards, whereByInstance: where, lines: new Set(), options: new Set() };
    }
    case "play-from-hand":
    case "action":
    case "control-rearrange":
    case "draft-pick":
    case "show-hand":
      // These either drive the play UI (drag-drop), the rearrange overlay, the
      // draft screen, or an ack — none of them use the card / line / option
      // highlight layer.
      return EMPTY_TARGETS;
  }
}

function locateCards(state: RedactedState, ids: Set<string>): Map<string, CardLocation> {
  const where = new Map<string, CardLocation>();
  // Field walk.
  for (let side = 0; side < state.stacks.length; side++) {
    const sideStacks = state.stacks[side]!;
    for (let lineIdx = 0; lineIdx < sideStacks.length; lineIdx++) {
      const stack = sideStacks[lineIdx]!;
      for (let stackIdx = 0; stackIdx < stack.length; stackIdx++) {
        const card = stack[stackIdx]!;
        if (!ids.has(card.instanceId)) continue;
        where.set(card.instanceId, {
          kind: "field",
          side: side as PlayerIdx,
          lineIdx: lineIdx as LineIdx,
          stackIdx,
          stackLen: stack.length,
        });
      }
    }
  }
  // Hand walk.
  for (let p = 0; p < state.players.length; p++) {
    const hand = state.players[p as PlayerIdx]!.hand;
    if (!Array.isArray(hand)) continue;
    for (const card of hand) {
      if (!ids.has(card.instanceId)) continue;
      where.set(card.instanceId, { kind: "hand", ownerIdx: p as PlayerIdx });
    }
  }
  return where;
}
