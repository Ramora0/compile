/**
 * Reusable card-effect helpers. Each generator delegate is meant to be
 * called with `yield*` from a card's `middle` (or passive `resolve`) body.
 *
 * The helpers cover the patterns that recur across the 90 cards: discards,
 * prompted flip / delete / shift / return, deck-top plays, hand transfers,
 * line-wide effects, and protocol manipulation.
 *
 * Conventions:
 *   - "self" = the card's owner; "opp" = the other player.
 *   - "this card" filters omit the resolving card via opts.excludeSelf.
 *   - Optional prompts (text "You may …") set opts.optional = true.
 *   - All prompts return null/[] when no candidates exist (silent fail).
 */

import type { CardCtxFull } from "../engine/ctx.js";
import type { CardFilter, Op, OpResult } from "../engine/ops.js";
import type { CardInstance, GameState, LineIdx, PlayerIdx, Side } from "../engine/types.js";
import { cardValue, findCardOnField, printedValue } from "../engine/field.js";
import { matchesCardFilter } from "../engine/cardFilter.js";
import { rearrangeProtocols } from "../engine/control.js";

export type Eff<T = void> = Generator<Op, T, OpResult>;

// ===================== Discard / refresh =====================

/** "You discard N card(s)." Forced; no-op if hand is empty. */
export function* discardSelfN(ctx: CardCtxFull, n: number): Eff {
  if (n <= 0 || ctx.myHand().length === 0) return;
  const ids = yield* ctx.promptDiscards({
    count: Math.min(n, ctx.myHand().length),
    reason: `discard-${n}`,
  });
  for (const id of ids) yield* ctx.discard(id, ctx.self);
}

/** "Your opponent discards N card(s)." Forced. */
export function* discardOppN(ctx: CardCtxFull, n: number): Eff {
  const handLen = ctx.oppHand().length;
  if (n <= 0 || handLen === 0) return;
  const ids = yield* ctx.promptDiscards({
    count: Math.min(n, handLen),
    reason: `opp-discard-${n}`,
    forPlayerIdx: ctx.opp,
  });
  for (const id of ids) yield* ctx.discard(id, ctx.opp);
}

/**
 * "You may discard N. If you do, …" — returns true if the player chose to discard.
 */
export function* mayDiscardSelfN(ctx: CardCtxFull, n: number, reason = "may-discard"): Eff<boolean> {
  if (ctx.myHand().length < n) return false;
  const choice = yield* ctx.promptOption({
    options: [{ id: "yes", label: `Discard ${n}` }, { id: "no", label: "Skip" }],
    reason,
  });
  if (choice !== "yes") return false;
  yield* discardSelfN(ctx, n);
  return true;
}

/**
 * "Discard 1 or more cards. <do something> the amount discarded plus 1." — Fire 4, Plague 2.
 * Returns the number of cards discarded.
 */
export function* discardSelfOneOrMore(ctx: CardCtxFull, reason = "discard-1+"): Eff<number> {
  const handLen = ctx.myHand().length;
  if (handLen === 0) return 0;
  const opts = Array.from({ length: handLen }, (_, i) => ({
    id: String(i + 1),
    label: `Discard ${i + 1}`,
  }));
  const choice = yield* ctx.promptOption({ options: opts, reason });
  const n = Math.min(handLen, Number.parseInt(choice, 10) || 1);
  yield* discardSelfN(ctx, n);
  return n;
}

// ===================== Confirmation prompts =====================

/**
 * "You may X. If you do, …" — a single yes/skip option prompt. Returns true
 * iff the player chose to do the thing. Used by every card with a binary
 * opt-in gate (Darkness 1's optional shift, Death 1's optional draw, …).
 *
 *     if (!(yield* h.confirm(ctx, "Shift it", "darkness-1-shift"))) return;
 */
export function* confirm(ctx: CardCtxFull, label: string, reason: string): Eff<boolean> {
  const choice = yield* ctx.promptOption({
    options: [
      { id: "yes", label },
      { id: "no", label: "Skip" },
    ],
    reason,
  });
  return choice === "yes";
}

// ===================== Field iteration / filters =====================

export interface FieldEntry {
  card: CardInstance;
  playerIdx: PlayerIdx;
  lineIdx: LineIdx;
  covered: boolean;
}

export function listFieldCards(state: GameState): FieldEntry[] {
  const out: FieldEntry[] = [];
  for (let p = 0; p < 2; p++) {
    for (let l = 0; l < 3; l++) {
      const stack = state.stacks[p as PlayerIdx][l as LineIdx].cards;
      for (let i = 0; i < stack.length; i++) {
        out.push({
          card: stack[i]!,
          playerIdx: p as PlayerIdx,
          lineIdx: l as LineIdx,
          covered: i !== stack.length - 1,
        });
      }
    }
  }
  return out;
}

/**
 * The uncovered (top) card of every stack — the cards that ordinary "1 card"
 * text may manipulate (rules.md:96). Selection that bypasses `chooseField`
 * (e.g. value-based picks) should source from here so the uncovered-only rule
 * stays consistent.
 */
export function uncoveredFieldCards(state: GameState): FieldEntry[] {
  return listFieldCards(state).filter((e) => !e.covered);
}

/** Every covered card — reachable only by text that says "covered"/"all". */
export function coveredFieldCards(state: GameState): FieldEntry[] {
  return listFieldCards(state).filter((e) => e.covered);
}

export interface FieldFilter {
  side?: "self" | "opp" | "any";
  faceUp?: boolean;
  faceDown?: boolean;
  covered?: boolean;
  uncovered?: boolean;
  inLines?: LineIdx[];
  excludeInstanceId?: string;
  /** Match face-up printed value in this set. Excludes face-down cards. */
  printedValueIn?: number[];
  /**
   * Match the card's *effective* value in this set — printed value for face-up
   * cards, the face-down value (default 2; Darkness 2 makes face-down cards
   * worth 4 in its line) for face-down cards. Use this for rules text like
   * "all cards with a value of 2" (Water 3) or "values of 1 or 2" (Death 2)
   * that the rulebook reads as referring to current value, not just printed.
   */
  valueIn?: number[];
  /** Custom predicate — applied last. */
  where?: (e: FieldEntry) => boolean;
}

export function filterField(ctx: CardCtxFull, f: FieldFilter): FieldEntry[] {
  const all = listFieldCards(ctx.state());
  return all.filter((e) => {
    const { card, playerIdx, lineIdx, covered } = e;
    // Common side / face / covered / line semantics live in the one shared
    // predicate (engine/cardFilter.ts), so this and the engine's option
    // enumeration can't drift. The card-only extras below layer on top.
    if (f.excludeInstanceId && card.instanceId === f.excludeInstanceId) return false;
    if (!matchesCardFilter(f, ctx.self, { kind: "field", side: playerIdx, lineIdx, covered }, card)) {
      return false;
    }
    if (f.printedValueIn) {
      if (card.faceDown) return false;
      if (!f.printedValueIn.includes(printedValue(card))) return false;
    }
    if (f.valueIn) {
      const v = cardValue(ctx.state(), card, playerIdx, lineIdx);
      if (!f.valueIn.includes(v)) return false;
    }
    if (f.where && !f.where(e)) return false;
    return true;
  });
}

/** Build an engine CardFilter from candidate instance IDs. */
export function filterByIds(ids: string[]): CardFilter {
  return { instanceIds: ids };
}

// ===================== Prompt + verb composites =====================

interface ChooseOpts {
  optional?: boolean;
  reason?: string;
  forPlayerIdx?: PlayerIdx;
}

export function* chooseField(
  ctx: CardCtxFull,
  filter: FieldFilter,
  opts: ChooseOpts = {},
): Eff<string | null> {
  // rules.md:96 — a single-target selection ("1 card", "1 of your cards", …)
  // may only reach the UNCOVERED (top) card of a line. Covered cards are
  // selectable only by text that says "covered"/"all", which those cards
  // express by passing `covered: true`. So default to uncovered-only unless the
  // caller opts into covered (`covered: true`) or explicitly opts out with
  // `uncovered: false` (a rare "any card, covered or not" effect).
  const scoped: FieldFilter =
    filter.covered === undefined && filter.uncovered === undefined
      ? { ...filter, uncovered: true }
      : filter;
  const cands = filterField(ctx, scoped);
  if (cands.length === 0) return null;
  const id = yield* ctx.promptCard({
    filter: filterByIds(cands.map((c) => c.card.instanceId)),
    optional: opts.optional ?? false,
    reason: opts.reason ?? "choose",
    ...(opts.forPlayerIdx !== undefined ? { forPlayerIdx: opts.forPlayerIdx } : {}),
  });
  return id;
}

export function* flipChosen(ctx: CardCtxFull, filter: FieldFilter, opts: ChooseOpts = {}): Eff<string | null> {
  const id = yield* chooseField(ctx, filter, { reason: "flip", ...opts });
  if (!id) return null;
  yield* ctx.flip(id);
  return id;
}

export function* deleteChosen(ctx: CardCtxFull, filter: FieldFilter, opts: ChooseOpts = {}): Eff<string | null> {
  const id = yield* chooseField(ctx, filter, { reason: "delete", ...opts });
  if (!id) return null;
  yield* ctx.delete(id);
  return id;
}

export function* returnChosen(ctx: CardCtxFull, filter: FieldFilter, opts: ChooseOpts = {}): Eff<string | null> {
  const id = yield* chooseField(ctx, filter, { reason: "return", ...opts });
  if (!id) return null;
  yield* ctx.return(id);
  return id;
}

/** Choose a card on the field then prompt for a destination line on its side and shift it. */
export function* shiftChosen(
  ctx: CardCtxFull,
  filter: FieldFilter,
  opts: ChooseOpts & { destLine?: LineIdx; allowSameLine?: boolean } = {},
): Eff<string | null> {
  const id = yield* chooseField(ctx, filter, { reason: "shift", ...opts });
  if (!id) return null;
  const loc = findCardOnField(ctx.state(), id);
  if (!loc) return null;
  let toLine: LineIdx;
  if (opts.destLine !== undefined) {
    toLine = opts.destLine;
  } else {
    const allowed: LineIdx[] = ([0, 1, 2] as LineIdx[]).filter(
      (l) => opts.allowSameLine || l !== loc.lineIdx,
    );
    if (allowed.length === 0) return null;
    toLine = yield* ctx.promptLine({ allowedLines: allowed, reason: "shift-to" });
  }
  yield* ctx.shift(id, toLine);
  return id;
}

/**
 * Reveal a face-down card to self, then optionally shift OR flip it. (Light 2)
 *
 * The reveal itself is *mandatory* whenever a matching card exists — only the
 * follow-up shift/flip is "you may". If no card matches (e.g. opponent has no
 * face-down cards) the helper silently skips, matching how other selection
 * helpers degrade when there are no candidates.
 */
export function* revealThenMayShiftOrFlip(ctx: CardCtxFull, filter: FieldFilter): Eff {
  const id = yield* chooseField(ctx, filter, { reason: "reveal", optional: false });
  if (!id) return;
  yield* ctx.reveal(id);
  const choice = yield* ctx.promptOption({
    options: [
      { id: "shift", label: "Shift it" },
      { id: "flip", label: "Flip it" },
      { id: "skip", label: "Do nothing" },
    ],
    reason: "reveal-then",
  });
  if (choice === "flip") {
    yield* ctx.flip(id);
  } else if (choice === "shift") {
    const loc = findCardOnField(ctx.state(), id);
    if (loc) {
      const allowed: LineIdx[] = ([0, 1, 2] as LineIdx[]).filter((l) => l !== loc.lineIdx);
      if (allowed.length > 0) {
        const toLine = yield* ctx.promptLine({ allowedLines: allowed, reason: "shift-to" });
        yield* ctx.shift(id, toLine);
      }
    }
  }
}

// ===================== Line-wide effects =====================

/** Flip every card matching the filter. Iterates a snapshot so flips don't recurse on the live list. */
export function* flipAllMatching(ctx: CardCtxFull, filter: FieldFilter): Eff {
  const targets = filterField(ctx, filter).map((e) => e.card.instanceId);
  for (const id of targets) yield* ctx.flip(id);
}

export function* deleteAllMatching(ctx: CardCtxFull, filter: FieldFilter): Eff {
  const targets = filterField(ctx, filter).map((e) => e.card.instanceId);
  for (const id of targets) yield* ctx.delete(id);
}

export function* returnAllMatching(ctx: CardCtxFull, filter: FieldFilter): Eff {
  const targets = filterField(ctx, filter).map((e) => e.card.instanceId);
  for (const id of targets) yield* ctx.return(id);
}

export function* shiftAllMatching(ctx: CardCtxFull, filter: FieldFilter, toLineIdx: LineIdx): Eff {
  const targets = filterField(ctx, filter).map((e) => e.card.instanceId);
  for (const id of targets) yield* ctx.shift(id, toLineIdx);
}

// ===================== Hand operations =====================

/**
 * "Play 1 card." Hands the player the normal play UI (drag-drop from hand
 * onto a lane with face-up/face-down drop zones) via a single combined
 * `play-from-hand` prompt — no refresh, must play if hand is non-empty.
 *
 * Used by every card whose middle reads "Play 1 card …":
 *   - Speed 0:    no restrictions (allowedLines = all, orientation = "any")
 *   - Darkness 3: allowedLines = other lines, orientation = "face-down"
 *
 * The engine validates face-up-protocol-match and play-restriction overrides
 * automatically on the response, so the helper stays a thin wrapper.
 */
export function* playFromHand(
  ctx: CardCtxFull,
  opts: {
    reason?: string;
    allowedLines?: LineIdx[];
    orientation?: "any" | "face-up" | "face-down";
  } = {},
): Eff<CardInstance | null> {
  const choice = yield* ctx.promptPlay({
    reason: opts.reason ?? "play-card",
    ...(opts.allowedLines !== undefined ? { allowedLines: opts.allowedLines } : {}),
    ...(opts.orientation !== undefined ? { orientation: opts.orientation } : {}),
  });
  if (!choice) return null;
  return yield* ctx.play(choice);
}

/**
 * Move a card directly between hands (no Op exists for it; cards are private
 * to the owner's hand anyway). Used for Love 1 / 3 give-and-take.
 */
export function moveCardBetweenHands(
  state: GameState,
  fromIdx: PlayerIdx,
  toIdx: PlayerIdx,
  instanceId: string,
): CardInstance | null {
  const from = state.players[fromIdx];
  const idx = from.hand.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) return null;
  const [card] = from.hand.splice(idx, 1);
  if (!card) return null;
  card.ownerIdx = toIdx;
  state.players[toIdx].hand.push(card);
  state.log.push({ t: Date.now(), type: "hand-transfer", instanceId, fromIdx, toIdx });
  return card;
}

/** Random pick from opponent's hand (Love 3). Determinism via state.rngCursor. */
export function takeRandomFromOpp(state: GameState, takerIdx: PlayerIdx): CardInstance | null {
  const opp = (1 - takerIdx) as PlayerIdx;
  const hand = state.players[opp].hand;
  if (hand.length === 0) return null;
  const i = state.rngCursor % hand.length;
  state.rngCursor = (state.rngCursor + 1) >>> 0;
  return moveCardBetweenHands(state, opp, takerIdx, hand[i]!.instanceId);
}

/**
 * "Give 1 card from your hand to your opponent." Optional. Returns true if a
 * card was given. Used by Love 1's bottom ("You may give...").
 */
export function* mayGiveOneToOpp(ctx: CardCtxFull, reason = "give"): Eff<boolean> {
  if (ctx.myHand().length === 0) return false;
  const id = yield* ctx.promptCard({
    filter: filterByIds(ctx.myHand().map((c) => c.instanceId)),
    optional: true,
    reason,
  });
  if (!id) return false;
  moveCardBetweenHands(ctx.state(), ctx.self, ctx.opp, id);
  return true;
}

/**
 * "Give 1 card from your hand to your opponent." Mandatory (Love 3) — the
 * player must choose a card if their hand has any. Silently skips when the
 * hand is empty.
 */
export function* giveOneToOpp(ctx: CardCtxFull, reason = "give"): Eff<boolean> {
  if (ctx.myHand().length === 0) return false;
  const id = yield* ctx.promptCard({
    filter: filterByIds(ctx.myHand().map((c) => c.instanceId)),
    optional: false,
    reason,
  });
  if (!id) return false;
  moveCardBetweenHands(ctx.state(), ctx.self, ctx.opp, id);
  return true;
}

/** "Reveal your opponent's hand." Light 4, Psychic 0. */
export function* revealOppHand(ctx: CardCtxFull): Eff {
  const snapshot = ctx.oppHand().map((c) => ({
    instanceId: c.instanceId,
    cardId: c.cardId,
  }));
  for (const c of snapshot) {
    yield* ctx.reveal(c.instanceId, ctx.self);
  }
  if (snapshot.length === 0) return;
  yield* ctx.promptShowHand({
    reason: "reveal-opp-hand",
    ownerIdx: ctx.opp,
    cards: snapshot,
  });
}

/** "Reveal 1 card from your hand." Love 4. */
export function* revealOneFromOwnHand(ctx: CardCtxFull): Eff<string | null> {
  if (ctx.myHand().length === 0) return null;
  const id = yield* ctx.promptCard({
    filter: filterByIds(ctx.myHand().map((c) => c.instanceId)),
    optional: false,
    reason: "reveal-own",
  });
  if (!id) return null;
  yield* ctx.reveal(id, ctx.opp);
  return id;
}

// ===================== Deck-top play =====================

/**
 * Play the top card of `playerIdx`'s deck face-down into `lineIdx` on their side.
 *
 * `underInstanceId` slots the new card beneath the named anchor (Gravity 0's
 * "play face-down under this card"); the anchor must be in the same side+line.
 */
export function* playTopOfDeckFaceDown(
  ctx: CardCtxFull,
  playerIdx: PlayerIdx,
  lineIdx: LineIdx,
  underInstanceId?: string,
): Eff<CardInstance | null> {
  // The card moves deck → field directly. Sourcing through hand would fire
  // after-draw reactives (e.g. Spirit 3) that the rules don't intend for
  // "play the top card of your deck" effects.
  return yield* ctx.play({
    playerIdx,
    lineIdx,
    faceDown: true,
    fromDeck: true,
    ...(underInstanceId !== undefined ? { underInstanceId } : {}),
  });
}

// ===================== Protocols =====================

/**
 * "Swap the positions of 2 of your protocols." Spirit 4. Two prompts for line
 * indices on the player's side; mutates protocol slots in place.
 */
export function* swapTwoProtocols(ctx: CardCtxFull, side: PlayerIdx = ctx.self): Eff {
  const a = yield* ctx.promptLine({ allowedLines: [0, 1, 2], reason: "swap-protocol-a" });
  const remaining = ([0, 1, 2] as LineIdx[]).filter((l) => l !== a);
  const b = yield* ctx.promptLine({ allowedLines: remaining, reason: "swap-protocol-b" });
  const order: [LineIdx, LineIdx, LineIdx] = [0, 1, 2];
  order[a] = b;
  order[b] = a;
  rearrangeProtocols(ctx.state(), side, order);
}

/**
 * "Rearrange your/opponent's protocols." Water 2, Psychic 2. Lets the active
 * player pick a permutation of [0,1,2] for `side`'s protocols.
 *
 * Implementation: present all 6 permutations as options; a UI can render this
 * however it likes.
 */
export function* rearrangeProtocolsPrompt(ctx: CardCtxFull, side: PlayerIdx): Eff {
  const perms: [LineIdx, LineIdx, LineIdx][] = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  const choice = yield* ctx.promptOption({
    options: perms.map((p, i) => ({ id: String(i), label: p.join("-") })),
    reason: side === ctx.self ? "rearrange-self" : "rearrange-opp",
  });
  const idx = Math.max(0, Math.min(perms.length - 1, Number.parseInt(choice, 10) || 0));
  rearrangeProtocols(ctx.state(), side, perms[idx]!);
}

// ===================== Misc utilities =====================

export const sides: readonly Side[] = ["self", "opp"];

/**
 * Highest *effective* value card among `playerIdx`'s field cards (Hate 2).
 * Face-down cards count too — at the default 2 unless a face-down-value
 * override (Darkness 2's top makes face-down cards in its line worth 4) bumps
 * them higher. Returning null only happens when the player has no field cards.
 */
export function highestValueCardOf(state: GameState, playerIdx: PlayerIdx): CardInstance | null {
  // rules.md:96 — "your highest value card" can only be a card you may
  // manipulate, i.e. an UNCOVERED card; covered cards are off-limits unless the
  // text says "covered"/"all". Sourcing from `uncoveredFieldCards` keeps that
  // rule in one place instead of re-deriving "covered" by stack index.
  let best: CardInstance | null = null;
  let bestVal = -1;
  for (const e of uncoveredFieldCards(state)) {
    if (e.playerIdx !== playerIdx) continue;
    const v = cardValue(state, e.card, e.playerIdx, e.lineIdx);
    if (v > bestVal) {
      best = e.card;
      bestVal = v;
    }
  }
  return best;
}

/**
 * Lowest-value covered card across BOTH sides of a line (Hate 4: "this line"
 * includes the opponent's stack). Face-down value resolves via cardValue, so a
 * Darkness 2 override on a face-down card raises it to 4.
 */
export function lowestCoveredInLine(
  state: GameState,
  lineIdx: LineIdx,
): CardInstance | null {
  let best: CardInstance | null = null;
  let bestVal = Infinity;
  for (const e of coveredFieldCards(state)) {
    if (e.lineIdx !== lineIdx) continue;
    const v = cardValue(state, e.card, e.playerIdx, e.lineIdx);
    if (v < bestVal) {
      best = e.card;
      bestVal = v;
    }
  }
  return best;
}

/** All other lines (≠ thisLine). */
export function otherLines(thisLine: LineIdx): LineIdx[] {
  return ([0, 1, 2] as LineIdx[]).filter((l) => l !== thisLine);
}

/** The line index of the resolving card (`ctx.thisInstanceId`). */
export function lineOfThis(ctx: CardCtxFull): LineIdx | null {
  return findCardOnField(ctx.state(), ctx.thisInstanceId)?.lineIdx ?? null;
}

/** Find the line of any card on the field. */
export function lineOf(state: GameState, instanceId: string): LineIdx | null {
  return findCardOnField(state, instanceId)?.lineIdx ?? null;
}

/** Number of cards in a specific side+line. */
export function lineSize(state: GameState, playerIdx: PlayerIdx, lineIdx: LineIdx): number {
  return state.stacks[playerIdx][lineIdx].cards.length;
}

/** Total cards in both sides of a line (Gravity 0 "for every 2 cards in this line"). */
export function lineSizeBothSides(state: GameState, lineIdx: LineIdx): number {
  return state.stacks[0][lineIdx].cards.length + state.stacks[1][lineIdx].cards.length;
}
