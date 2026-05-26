/**
 * Reusable "reorder protocols by dragging their headers" mechanism.
 *
 * Four different engine questions all reduce to the same board interaction —
 * drag a player's protocol headers into a new order, then confirm:
 *
 *   - `control-rearrange`            (hold Control, before compile/refresh) —
 *       any permutation of your own protocols, skippable.
 *   - `choose-option` / "rearrange-self"  (Water 2)   — permute your protocols.
 *   - `choose-option` / "rearrange-opp"   (Psychic 2) — permute the opponent's.
 *   - `choose-line`   / "swap-protocol-a" (Spirit 4)  — swap exactly two of your
 *       protocols. The engine drives this as a two-prompt handshake (pick line
 *       A, then line B); the UI collapses it into one drag-onto-another gesture.
 *
 * This module is pure — no React, no sockets. It owns the order algebra,
 * derives a `ReorderSession` descriptor from the pending question, and builds
 * the matching `Answer`. `useProtocolReorder` wraps it with drag state and the
 * socket plumbing.
 */
import type { Answer, LineIdx, PlayerIdx, Question } from "./types.js";
import { answerForChooseLine, answerForRearrange } from "./answers.js";

/**
 * `order[displayLine]` = the original protocol-slot index now shown at that
 * line. This is exactly the engine's `newOrder` (`rearrangeProtocols`:
 * `next[i] = slots[order[i]]`), so it commits without translation.
 */
export type ReorderOrder = readonly [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];

export const REORDER_IDENTITY: ReorderOrder = [0, 1, 2];

export function isIdentity(order: ReorderOrder): boolean {
  return order[0] === 0 && order[1] === 1 && order[2] === 2;
}

/** Sortable move: pull the item at `from` out and reinsert it at `to`. */
export function moveIndex(order: ReorderOrder, from: number, to: number): ReorderOrder {
  if (from === to) return order;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return [next[0]!, next[1]!, next[2]!] as ReorderOrder;
}

/** Swap the two positions `a` and `b` in place (no shifting of the rest). */
export function swapIndices(order: ReorderOrder, a: number, b: number): ReorderOrder {
  if (a === b) return order;
  const next = [...order];
  [next[a], next[b]] = [next[b]!, next[a]!];
  return [next[0]!, next[1]!, next[2]!] as ReorderOrder;
}

/** A single transposition of positions `a` and `b`, applied to identity. */
export function swapPositions(a: number, b: number): ReorderOrder {
  const next: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] = [0, 1, 2];
  next[a] = b as 0 | 1 | 2;
  next[b] = a as 0 | 1 | 2;
  return next;
}

/** If `order` is identity with exactly two positions swapped, return that pair. */
export function transposition(order: ReorderOrder): [LineIdx, LineIdx] | null {
  const moved: number[] = [];
  for (let i = 0; i < 3; i++) if (order[i] !== i) moved.push(i);
  if (moved.length !== 2) return null;
  const [a, b] = moved as [LineIdx, LineIdx];
  if (order[a] !== b || order[b] !== a) return null;
  return [a, b];
}

export type ReorderMode = "permute" | "swap";

export interface ReorderSession {
  questionId: string;
  /** Absolute player whose protocols are being reordered. */
  targetSide: PlayerIdx;
  mode: ReorderMode;
  /** Whether a "leave as-is" skip is offered (Control rearrange only). */
  skippable: boolean;
  /**
   * Whether the player picks which side to rearrange (Control rearrange only —
   * rules.md:98 lets the holder rearrange their own OR the opponent's
   * protocols). Other flows fix the side.
   */
  chooseSide: boolean;
  heading: string;
  instruction: string;
}

/** Reason on the first prompt of a Spirit-4 swap (the drag-to-swap gesture). */
export const SWAP_FIRST_REASON = "swap-protocol-a";
/** Reason on the second prompt of a Spirit-4 swap, answered via the handshake. */
export const SWAP_SECOND_REASON = "swap-protocol-b";

/**
 * Inspect the pending question and, if it's one the drag UI owns, return a
 * unified session descriptor. Returns null for everything else — including the
 * swap handshake's second prompt, which `useProtocolReorder` auto-answers.
 */
export function deriveReorderSession(
  q: Question | null,
  myIdx: PlayerIdx,
): ReorderSession | null {
  if (!q || q.forPlayerIdx !== myIdx) return null;

  if (q.kind === "control-rearrange") {
    const verb = q.reason.includes("compile") ? "compile" : "refresh";
    return {
      questionId: q.questionId,
      targetSide: myIdx,
      mode: "permute",
      skippable: true,
      chooseSide: true,
      heading: "Control · rearrange",
      instruction: `Pick a side, then drag its protocol headers to reorder them before this ${verb}. Cards stay put.`,
    };
  }

  if (q.kind === "choose-option" && q.reason.startsWith("rearrange-")) {
    const self = q.reason === "rearrange-self";
    return {
      questionId: q.questionId,
      targetSide: self ? myIdx : ((1 - myIdx) as PlayerIdx),
      mode: "permute",
      skippable: false,
      chooseSide: false,
      heading: self ? "Rearrange your protocols" : "Rearrange opponent's protocols",
      instruction: self
        ? "Drag your protocol headers to reorder them. Cards stay put."
        : "Drag the opponent's protocol headers to reorder them. Their cards stay put.",
    };
  }

  if (q.kind === "choose-line" && q.reason === SWAP_FIRST_REASON) {
    return {
      questionId: q.questionId,
      targetSide: myIdx,
      mode: "swap",
      skippable: false,
      chooseSide: false,
      heading: "Swap two protocols",
      instruction: "Drag one of your protocol headers onto another to swap the two. Cards stay put.",
    };
  }

  return null;
}

/**
 * Build the Answer that commits `order` for a permute-style question.
 * `targetSide` is the side being rearranged — for Control rearrange this may be
 * the opponent (rules.md:98); for the choose-option flows it's fixed by the
 * card and ignored here (the side lives in the matched option).
 */
export function buildPermuteAnswer(
  q: Question,
  order: ReorderOrder,
  targetSide: PlayerIdx,
): Answer | null {
  if (q.kind === "control-rearrange") {
    return answerForRearrange(q, {
      side: targetSide,
      newOrder: [order[0], order[1], order[2]],
    });
  }
  if (q.kind === "choose-option") {
    // The engine labels each permutation option as "src-src-src" (helpers.ts),
    // which is exactly `order.join("-")` — match on that rather than re-deriving
    // the canonical permutation index on the client.
    const label = order.join("-");
    const opt = q.options.find((o) => o.label === label);
    return opt ? { kind: "single", questionId: q.questionId, optionId: opt.id } : null;
  }
  return null;
}

/** Control-rearrange only: the explicit "leave as-is" option. */
export function buildSkipAnswer(q: Question): Answer | null {
  if (q.kind !== "control-rearrange") return null;
  return answerForRearrange(q, "skip");
}

/** First leg of a Spirit-4 swap: answer "swap-protocol-a" with line `a`. */
export function buildSwapFirstAnswer(q: Question, a: LineIdx): Answer | null {
  if (q.kind !== "choose-line") return null;
  return answerForChooseLine(q, a);
}

/** Second leg: answer "swap-protocol-b" with line `b`. */
export function buildSwapSecondAnswer(q: Question, b: LineIdx): Answer | null {
  if (q.kind !== "choose-line") return null;
  return answerForChooseLine(q, b);
}
