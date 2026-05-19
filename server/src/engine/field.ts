/**
 * Field / line operations: stack management, cover/uncover semantics, and
 * line-value computation. This module is card-agnostic — it knows about
 * card *instances* and asks the value resolver / override registry for
 * effective values, but it never reads card text.
 *
 * Stack convention: `cards[cards.length - 1]` is the uncovered (top) card.
 * Earlier indices are progressively more covered (rules.md:94-96).
 */

import type {
  CardInstance,
  GameState,
  LineIdx,
  LineSnapshot,
  PlayerIdx,
  RuleOverride,
  Side,
} from "./types.js";

export const LINE_INDICES: readonly LineIdx[] = [0, 1, 2] as const;

export function getStack(state: GameState, playerIdx: PlayerIdx, lineIdx: LineIdx) {
  return state.stacks[playerIdx][lineIdx];
}

export function uncoveredCard(state: GameState, playerIdx: PlayerIdx, lineIdx: LineIdx): CardInstance | null {
  const stack = getStack(state, playerIdx, lineIdx);
  return stack.cards[stack.cards.length - 1] ?? null;
}

export function isCovered(state: GameState, instanceId: string): boolean {
  for (const side of state.stacks) {
    for (const stack of side) {
      const idx = stack.cards.findIndex((c) => c.instanceId === instanceId);
      if (idx === -1) continue;
      return idx !== stack.cards.length - 1;
    }
  }
  return false;
}

export interface CardLocation {
  playerIdx: PlayerIdx;
  lineIdx: LineIdx;
  /** 0 = bottom of stack, length-1 = uncovered. */
  stackIdx: number;
}

export function findCardOnField(state: GameState, instanceId: string): CardLocation | null {
  for (let p = 0; p < state.stacks.length; p++) {
    const playerIdx = p as PlayerIdx;
    const sideStacks = state.stacks[playerIdx];
    for (let l = 0; l < sideStacks.length; l++) {
      const lineIdx = l as LineIdx;
      const stack = sideStacks[lineIdx];
      const idx = stack.cards.findIndex((c) => c.instanceId === instanceId);
      if (idx >= 0) return { playerIdx, lineIdx, stackIdx: idx };
    }
  }
  return null;
}

/**
 * Place a card on top of the line's stack. Returns the previously uncovered
 * card (now covered), if any. Triggering covered/uncovered lifecycle events
 * is the caller's responsibility (Phase 7 reactive layer).
 */
export function pushOntoStack(
  state: GameState,
  playerIdx: PlayerIdx,
  lineIdx: LineIdx,
  card: CardInstance,
): { covered: CardInstance | null } {
  const stack = getStack(state, playerIdx, lineIdx);
  const previouslyUncovered = stack.cards[stack.cards.length - 1] ?? null;
  stack.cards.push(card);
  return { covered: previouslyUncovered };
}

/**
 * Remove a card from its stack. Returns the card and whatever was directly
 * beneath it (which becomes uncovered as a result). Triggering deleted/uncovered
 * lifecycle events is the caller's responsibility.
 */
export function removeFromStack(
  state: GameState,
  instanceId: string,
): { removed: CardInstance; nowUncovered: CardInstance | null; location: CardLocation } | null {
  const loc = findCardOnField(state, instanceId);
  if (!loc) return null;
  const stack = state.stacks[loc.playerIdx][loc.lineIdx];
  const wasUncovered = loc.stackIdx === stack.cards.length - 1;
  const [removed] = stack.cards.splice(loc.stackIdx, 1);
  if (!removed) return null;
  const nowUncovered = wasUncovered ? (stack.cards[stack.cards.length - 1] ?? null) : null;
  return { removed, nowUncovered, location: loc };
}

/**
 * Snapshot a line/side for value-computation callbacks. Counts only the
 * card facing because value-modifier cards (Apathy 0, etc.) typically key
 * off face-down/face-up counts.
 */
export function lineSnapshot(state: GameState, playerIdx: PlayerIdx, lineIdx: LineIdx): LineSnapshot {
  const stack = getStack(state, playerIdx, lineIdx);
  let faceDown = 0;
  let faceUp = 0;
  for (const c of stack.cards) {
    if (c.faceDown) faceDown++;
    else faceUp++;
  }
  return { cards: stack.cards.slice(), faceDownCount: faceDown, faceUpCount: faceUp };
}

/**
 * Default face-down card value. Per rules.md card examples (Apathy 0 etc.),
 * face-down cards still contribute value; the printed default is 2.
 *
 * If a card never reveals its face-down value in rules.md, this default may
 * need adjustment — the override `face-down-value` lets specific cards
 * (e.g. "All face-down cards in this stack have a value of 4") supersede it.
 */
export const DEFAULT_FACE_DOWN_VALUE = 2;

/** Face-up cards expose their printed value via cardId — `protocol-N`. */
export function printedValue(card: CardInstance): number {
  const parts = card.cardId.split("-");
  const v = parts[parts.length - 1];
  const n = v ? Number.parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) throw new Error(`bad cardId: ${card.cardId}`);
  return n;
}

/**
 * Compute the effective value of a single card on the field, consulting
 * face-down-value overrides for that line. Does not apply line-wide
 * modifiers — those are handled in lineValue.
 */
export function cardValue(
  state: GameState,
  card: CardInstance,
  playerIdx: PlayerIdx,
  lineIdx: LineIdx,
): number {
  if (!card.faceDown) return printedValue(card);
  const override = state.overrides.find(
    (o) =>
      o.override.kind === "face-down-value" &&
      o.override.lineIdx === lineIdx &&
      o.override.ownerIdx === playerIdx,
  );
  if (override && override.override.kind === "face-down-value") {
    return override.override.value;
  }
  return DEFAULT_FACE_DOWN_VALUE;
}

/**
 * Total value of a single side of a line, including:
 *  - per-card face-down-value overrides
 *  - per-line value-modifier overrides ("Your total value in this line is increased by 1 for each face-down card", etc.)
 */
export function lineValue(state: GameState, playerIdx: PlayerIdx, lineIdx: LineIdx): number {
  const stack = getStack(state, playerIdx, lineIdx);
  let total = 0;
  for (const c of stack.cards) total += cardValue(state, c, playerIdx, lineIdx);

  const snap = lineSnapshot(state, playerIdx, lineIdx);
  for (const o of state.overrides) {
    if (o.override.kind !== "value-modifier") continue;
    const mod = o.override;
    if (mod.lineIdx !== lineIdx) continue;
    if (mod.ownerIdx !== playerIdx && mod.side === "self") continue;
    if (mod.ownerIdx === playerIdx && mod.side === "opp") continue;
    total += mod.delta(snap);
  }
  return total;
}

/** Whose value is higher in this line? null if tied. */
export function lineLeader(state: GameState, lineIdx: LineIdx): PlayerIdx | null {
  const v0 = lineValue(state, 0, lineIdx);
  const v1 = lineValue(state, 1, lineIdx);
  if (v0 > v1) return 0;
  if (v1 > v0) return 1;
  return null;
}

export function leadingLineCount(state: GameState, playerIdx: PlayerIdx): number {
  let count = 0;
  for (const l of LINE_INDICES) if (lineLeader(state, l) === playerIdx) count++;
  return count;
}

/**
 * Lines a player is currently *required* to compile (>=10 AND > opponent).
 * The Check Compile phase will turn this into a forced action; if multiple
 * are eligible, the player chooses one.
 */
export function compilableLines(state: GameState, playerIdx: PlayerIdx): LineIdx[] {
  const opp = (1 - playerIdx) as PlayerIdx;
  const out: LineIdx[] = [];
  for (const l of LINE_INDICES) {
    const my = lineValue(state, playerIdx, l);
    const their = lineValue(state, opp, l);
    if (my >= 10 && my > their) out.push(l);
  }
  return out;
}

/** Helper for tests / play validators: which line carries a given protocol on a side? */
export function lineOfProtocol(
  state: GameState,
  playerIdx: PlayerIdx,
  protocol: string,
): LineIdx | null {
  const slots = state.players[playerIdx].protocols;
  for (const l of LINE_INDICES) {
    if (slots[l].protocol === protocol) return l;
  }
  return null;
}

/** All overrides whose source instance is no longer eligible — to be detached by the reactive layer. */
export function staleOverrides(state: GameState): RuleOverride[] {
  // Implemented in Phase 7 once reactive lifecycle is wired up.
  return [];
}

export type { Side };
