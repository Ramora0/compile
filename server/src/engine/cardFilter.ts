/**
 * The single card-filter predicate.
 *
 * Two layers need to decide whether a card matches a `CardFilter`:
 *   - the card-authoring layer (`cards/helpers.ts` `filterField`), which builds
 *     the candidate set a card effect may target, and
 *   - the engine's option enumeration (`engine/enumerate.ts`), which turns a
 *     prompt into the clickable `Option[]` the client sees.
 *
 * Keeping the side / face / covered / line semantics in one function means the
 * two callers can never drift apart. `filterField` layers card-only extras
 * (value sets, a `where` predicate, `excludeInstanceId`) on top of this; the
 * engine uses it as-is.
 *
 * `viewerIdx` is the acting player, against whom `side: "self" | "opp"` is
 * resolved.
 */
import type { CardFilter } from "./ops.js";
import type { LineIdx, PlayerIdx } from "./types.js";

export type FilterLoc =
  | { kind: "field"; side: PlayerIdx; lineIdx: LineIdx; covered: boolean }
  | { kind: "hand"; ownerIdx: PlayerIdx };

export interface FilterCard {
  instanceId: string;
  faceDown: boolean;
  ownerIdx: PlayerIdx;
}

export function matchesCardFilter(
  filter: CardFilter,
  viewerIdx: PlayerIdx,
  loc: FilterLoc,
  card: FilterCard,
): boolean {
  if (filter.instanceIds && !filter.instanceIds.includes(card.instanceId)) return false;
  if (filter.ownerIdx !== undefined && card.ownerIdx !== filter.ownerIdx) return false;
  if (filter.faceUp === true && card.faceDown) return false;
  if (filter.faceDown === true && !card.faceDown) return false;
  if (loc.kind === "field") {
    if (filter.side === "self" && loc.side !== viewerIdx) return false;
    if (filter.side === "opp" && loc.side === viewerIdx) return false;
    if (filter.inLines && !filter.inLines.includes(loc.lineIdx)) return false;
    if (filter.covered === true && !loc.covered) return false;
    if (filter.uncovered === true && loc.covered) return false;
  } else {
    // Hand cards match only when the filter pins explicit instance IDs.
    if (!filter.instanceIds) return false;
    if (filter.side === "self" && loc.ownerIdx !== viewerIdx) return false;
    if (filter.side === "opp" && loc.ownerIdx === viewerIdx) return false;
  }
  return true;
}
