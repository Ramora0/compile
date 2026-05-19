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
import { findCardOnField, printedValue } from "../engine/field.js";
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
  /** Custom predicate — applied last. */
  where?: (e: FieldEntry) => boolean;
}

export function filterField(ctx: CardCtxFull, f: FieldFilter): FieldEntry[] {
  const all = listFieldCards(ctx.state());
  return all.filter((e) => {
    const { card, playerIdx, lineIdx, covered } = e;
    if (f.excludeInstanceId && card.instanceId === f.excludeInstanceId) return false;
    if (f.side === "self" && playerIdx !== ctx.self) return false;
    if (f.side === "opp" && playerIdx !== ctx.opp) return false;
    if (f.faceUp && card.faceDown) return false;
    if (f.faceDown && !card.faceDown) return false;
    if (f.covered && !covered) return false;
    if (f.uncovered && covered) return false;
    if (f.inLines && !f.inLines.includes(lineIdx)) return false;
    if (f.printedValueIn) {
      if (card.faceDown) return false;
      if (!f.printedValueIn.includes(printedValue(card))) return false;
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
  const cands = filterField(ctx, filter);
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

/** Reveal a face-down card to self, then optionally shift OR flip it. (Light 2) */
export function* revealThenMayShiftOrFlip(ctx: CardCtxFull, filter: FieldFilter): Eff {
  const id = yield* chooseField(ctx, filter, { reason: "reveal", optional: true });
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
 * "Play 1 card." Prompt the player to pick a card from their hand and a line,
 * then play it (face-up if protocol matches, otherwise face-down by default
 * unless `forceFaceDown` is set).
 */
export function* playFromHand(
  ctx: CardCtxFull,
  opts: { faceDown?: "ask" | true | false; reason?: string } = {},
): Eff<CardInstance | null> {
  const hand = ctx.myHand();
  if (hand.length === 0) return null;
  const handIds = hand.map((c) => c.instanceId);
  const id = yield* ctx.promptCard({
    filter: filterByIds(handIds),
    optional: false,
    reason: opts.reason ?? "play-card",
  });
  if (!id) return null;
  const lineIdx = yield* ctx.promptLine({
    allowedLines: [0, 1, 2],
    reason: opts.reason ? `${opts.reason}-line` : "play-line",
  });
  let faceDown: boolean;
  if (opts.faceDown === true) faceDown = true;
  else if (opts.faceDown === false) faceDown = false;
  else {
    const choice = yield* ctx.promptOption({
      options: [
        { id: "up", label: "Face-up" },
        { id: "down", label: "Face-down" },
      ],
      reason: "face-up-or-down",
    });
    faceDown = choice === "down";
  }
  return yield* ctx.play({ instanceId: id, lineIdx, faceDown });
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
 * card was given. Used by Love 1, Love 3.
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

/** "Reveal your opponent's hand." Light 4. */
export function* revealOppHand(ctx: CardCtxFull): Eff {
  for (const c of ctx.oppHand()) {
    yield* ctx.reveal(c.instanceId, ctx.self);
  }
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

/** Play the top card of `playerIdx`'s deck face-down into `lineIdx` on their side. */
export function* playTopOfDeckFaceDown(
  ctx: CardCtxFull,
  playerIdx: PlayerIdx,
  lineIdx: LineIdx,
): Eff<CardInstance | null> {
  const drew = yield* ctx.draw(1, playerIdx);
  if (drew.length === 0) return null;
  const top = drew[0]!;
  const r = yield* ctx.play({ instanceId: top.instanceId, lineIdx, faceDown: true, playerIdx });
  return r;
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

/** Highest face-up printed value among `playerIdx`'s field cards. Face-down excluded. */
export function highestValueCardOf(state: GameState, playerIdx: PlayerIdx): CardInstance | null {
  let best: CardInstance | null = null;
  let bestVal = -1;
  for (const stack of state.stacks[playerIdx]) {
    for (const c of stack.cards) {
      if (c.faceDown) continue;
      const v = printedValue(c);
      if (v > bestVal) {
        best = c;
        bestVal = v;
      }
    }
  }
  return best;
}

/** Lowest-value covered card in a specific side+line. Face-down counts as 2. */
export function lowestCoveredOfLine(
  state: GameState,
  playerIdx: PlayerIdx,
  lineIdx: LineIdx,
): CardInstance | null {
  const stack = state.stacks[playerIdx][lineIdx].cards;
  let best: CardInstance | null = null;
  let bestVal = Infinity;
  for (let i = 0; i < stack.length - 1; i++) {
    const c = stack[i]!;
    const v = c.faceDown ? 2 : printedValue(c);
    if (v < bestVal) {
      best = c;
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
