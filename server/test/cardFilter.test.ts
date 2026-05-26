import { describe, expect, it } from "vitest";
import { matchesCardFilter, type FilterCard, type FilterLoc } from "../src/engine/cardFilter.js";
import type { CardFilter } from "../src/engine/ops.js";
import type { PlayerIdx } from "../src/engine/types.js";

// The shared predicate used by BOTH cards/helpers.ts (filterField) and
// engine/enumerate.ts. These lock its side/face/covered/hand semantics so the
// two callers can't drift.

const VIEWER: PlayerIdx = 0;
const OPP: PlayerIdx = 1;

function card(over: Partial<FilterCard> = {}): FilterCard {
  return { instanceId: "x", faceDown: false, ownerIdx: VIEWER, ...over };
}
function fieldLoc(over: Partial<Extract<FilterLoc, { kind: "field" }>> = {}): FilterLoc {
  return { kind: "field", side: VIEWER, lineIdx: 0, covered: false, ...over };
}
function match(filter: CardFilter, loc: FilterLoc, c: FilterCard = card()): boolean {
  return matchesCardFilter(filter, VIEWER, loc, c);
}

describe("matchesCardFilter — shared filter predicate", () => {
  it("instanceIds gate the match", () => {
    expect(match({ instanceIds: ["x"] }, fieldLoc())).toBe(true);
    expect(match({ instanceIds: ["y"] }, fieldLoc())).toBe(false);
  });

  it("side is resolved relative to the viewer", () => {
    expect(match({ side: "self" }, fieldLoc({ side: VIEWER }))).toBe(true);
    expect(match({ side: "self" }, fieldLoc({ side: OPP }))).toBe(false);
    expect(match({ side: "opp" }, fieldLoc({ side: OPP }))).toBe(true);
    expect(match({ side: "opp" }, fieldLoc({ side: VIEWER }))).toBe(false);
    expect(match({ side: "any" }, fieldLoc({ side: OPP }))).toBe(true);
  });

  it("uncovered excludes covered cards and vice versa", () => {
    expect(match({ uncovered: true }, fieldLoc({ covered: false }))).toBe(true);
    expect(match({ uncovered: true }, fieldLoc({ covered: true }))).toBe(false);
    expect(match({ covered: true }, fieldLoc({ covered: true }))).toBe(true);
    expect(match({ covered: true }, fieldLoc({ covered: false }))).toBe(false);
  });

  it("faceUp / faceDown filter on facing", () => {
    expect(match({ faceUp: true }, fieldLoc(), card({ faceDown: false }))).toBe(true);
    expect(match({ faceUp: true }, fieldLoc(), card({ faceDown: true }))).toBe(false);
    expect(match({ faceDown: true }, fieldLoc(), card({ faceDown: true }))).toBe(true);
  });

  it("inLines restricts to the listed lines", () => {
    expect(match({ inLines: [1, 2] }, fieldLoc({ lineIdx: 1 }))).toBe(true);
    expect(match({ inLines: [1, 2] }, fieldLoc({ lineIdx: 0 }))).toBe(false);
  });

  it("hand cards match only when the filter pins instanceIds", () => {
    const handLoc: FilterLoc = { kind: "hand", ownerIdx: VIEWER };
    expect(match({}, handLoc)).toBe(false);
    expect(match({ instanceIds: ["x"] }, handLoc)).toBe(true);
    expect(match({ instanceIds: ["x"], side: "opp" }, handLoc)).toBe(false);
  });
});
