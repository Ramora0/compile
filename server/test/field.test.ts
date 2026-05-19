import { describe, expect, it } from "vitest";
import {
  DEFAULT_FACE_DOWN_VALUE,
  cardValue,
  compilableLines,
  findCardOnField,
  isCovered,
  leadingLineCount,
  lineLeader,
  lineValue,
  printedValue,
  pushOntoStack,
  removeFromStack,
  uncoveredCard,
} from "../src/engine/field.js";
import { newGame, placeCard } from "./helpers/harness.js";

describe("printedValue", () => {
  it("parses the trailing number from cardId", () => {
    expect(printedValue({ instanceId: "x", cardId: "spirit-3", faceDown: false, ownerIdx: 0 })).toBe(3);
    expect(printedValue({ instanceId: "x", cardId: "fire-0", faceDown: false, ownerIdx: 1 })).toBe(0);
  });
});

describe("stack ops", () => {
  it("pushOntoStack reports the previously uncovered card as covered", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-1");
    const result = pushOntoStack(g, 0, 0, {
      instanceId: "new",
      cardId: "spirit-2",
      faceDown: false,
      ownerIdx: 0,
    });
    expect(result.covered?.cardId).toBe("spirit-1");
    expect(uncoveredCard(g, 0, 0)?.cardId).toBe("spirit-2");
  });

  it("isCovered returns true for non-top cards, false for top", () => {
    const g = newGame();
    placeCard(g, 0, 1, "fire-1");
    placeCard(g, 0, 1, "fire-2");
    placeCard(g, 0, 1, "fire-3");
    const stack = g.stacks[0][1];
    expect(isCovered(g, stack.cards[0]!.instanceId)).toBe(true);
    expect(isCovered(g, stack.cards[1]!.instanceId)).toBe(true);
    expect(isCovered(g, stack.cards[2]!.instanceId)).toBe(false);
  });

  it("removeFromStack reports the new uncovered card when the top is removed", () => {
    const g = newGame();
    placeCard(g, 1, 2, "death-1");
    placeCard(g, 1, 2, "death-2");
    const top = g.stacks[1][2].cards[1]!;
    const result = removeFromStack(g, top.instanceId);
    expect(result?.removed.cardId).toBe("death-2");
    expect(result?.nowUncovered?.cardId).toBe("death-1");
  });

  it("removeFromStack returns no nowUncovered when removing a covered card", () => {
    const g = newGame();
    placeCard(g, 1, 2, "death-1");
    placeCard(g, 1, 2, "death-2");
    const buried = g.stacks[1][2].cards[0]!;
    const result = removeFromStack(g, buried.instanceId);
    expect(result?.removed.cardId).toBe("death-1");
    expect(result?.nowUncovered).toBeNull();
  });

  it("findCardOnField finds across both sides and all lines", () => {
    const g = newGame();
    placeCard(g, 0, 2, "light-3");
    placeCard(g, 1, 0, "love-4");
    expect(findCardOnField(g, g.stacks[0][2].cards[0]!.instanceId)?.lineIdx).toBe(2);
    expect(findCardOnField(g, g.stacks[1][0].cards[0]!.instanceId)?.playerIdx).toBe(1);
  });
});

describe("value computation", () => {
  it("face-up card uses printedValue", () => {
    const g = newGame();
    const c = placeCard(g, 0, 0, "spirit-3", false);
    expect(cardValue(g, c, 0, 0)).toBe(3);
  });

  it("face-down card uses DEFAULT_FACE_DOWN_VALUE", () => {
    const g = newGame();
    const c = placeCard(g, 0, 0, "spirit-3", true);
    expect(cardValue(g, c, 0, 0)).toBe(DEFAULT_FACE_DOWN_VALUE);
  });

  it("face-down-value override supersedes the default", () => {
    const g = newGame();
    const c = placeCard(g, 0, 0, "spirit-3", true);
    g.overrides.push({
      sourceInstanceId: "src",
      override: { kind: "face-down-value", lineIdx: 0, ownerIdx: 0, value: 4 },
    });
    expect(cardValue(g, c, 0, 0)).toBe(4);
  });

  it("lineValue sums all cards on the side", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-3", false);
    placeCard(g, 0, 0, "spirit-2", false);
    placeCard(g, 0, 0, "spirit-1", true); // face-down → 2
    expect(lineValue(g, 0, 0)).toBe(3 + 2 + 2);
  });

  it("value-modifier overrides apply to the matching side", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-3", false);
    g.overrides.push({
      sourceInstanceId: "src",
      override: {
        kind: "value-modifier",
        lineIdx: 0,
        side: "self",
        ownerIdx: 0,
        delta: () => 5,
      },
    });
    expect(lineValue(g, 0, 0)).toBe(8);
    // Modifier was self-side from owner 0; doesn't affect player 1's line value
    expect(lineValue(g, 1, 0)).toBe(0);
  });

  it("opp-side value modifier targets the opponent's value", () => {
    const g = newGame();
    placeCard(g, 1, 0, "fire-3", false);
    g.overrides.push({
      sourceInstanceId: "src",
      override: {
        kind: "value-modifier",
        lineIdx: 0,
        side: "opp",
        ownerIdx: 0,
        delta: () => -2,
      },
    });
    expect(lineValue(g, 1, 0)).toBe(1);
  });

  it("lineLeader returns null on a tie and the higher player otherwise", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-3");
    placeCard(g, 1, 0, "fire-3");
    expect(lineLeader(g, 0)).toBeNull();
    placeCard(g, 0, 0, "spirit-1");
    expect(lineLeader(g, 0)).toBe(0);
  });

  it("leadingLineCount counts lines where the player is strictly ahead", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-5");
    placeCard(g, 1, 0, "fire-2");
    placeCard(g, 0, 1, "spirit-3");
    placeCard(g, 1, 1, "fire-3"); // tie
    placeCard(g, 0, 2, "spirit-1");
    placeCard(g, 1, 2, "fire-4"); // p1 leads
    expect(leadingLineCount(g, 0)).toBe(1);
    expect(leadingLineCount(g, 1)).toBe(1);
  });
});

describe("compilableLines", () => {
  it("requires value >= 10", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-5");
    placeCard(g, 0, 0, "spirit-4"); // total 9
    expect(compilableLines(g, 0)).toEqual([]);
  });

  it("requires strictly greater than the opponent", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-5");
    placeCard(g, 0, 0, "spirit-5"); // 10
    placeCard(g, 1, 0, "fire-5");
    placeCard(g, 1, 0, "fire-5"); // 10 (tie)
    expect(compilableLines(g, 0)).toEqual([]);
  });

  it("returns lines that satisfy both conditions", () => {
    const g = newGame();
    placeCard(g, 0, 0, "spirit-5");
    placeCard(g, 0, 0, "spirit-5"); // 10
    placeCard(g, 1, 0, "fire-3"); // 3
    placeCard(g, 0, 2, "spirit-5");
    placeCard(g, 0, 2, "spirit-5");
    placeCard(g, 0, 2, "spirit-1"); // 11
    expect(compilableLines(g, 0)).toEqual([0, 2]);
  });
});
