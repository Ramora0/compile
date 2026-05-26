import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newGame, placeCard } from "./helpers/harness.js";
import { resetCardRegistry, registerMockCard } from "./helpers/mockCards.js";
import { Game } from "../src/engine/game.js";
import { recomputeOverrides } from "../src/engine/reactive/index.js";
import { EffectRuntime } from "../src/engine/runtime.js";
import { findCardOnField } from "../src/engine/field.js";
import { lowestCoveredInLine } from "../src/cards/helpers.js";
import type { Op, OpResult } from "../src/engine/ops.js";

beforeEach(() => resetCardRegistry());
afterEach(() => resetCardRegistry());

describe("static-rule overrides", () => {
  it("face-up uncovered card with bottom static-rule contributes its override", () => {
    registerMockCard({
      protocol: "spirit",
      value: 0,
      top: null,
      middle: null,
      bottom: {
        kind: "static-rule",
        apply: (ctx) => ({ kind: "skip-phase", phase: "check-cache", ownerIdx: ctx.self }),
      },
    });
    const g = newGame();
    placeCard(g, 0, 0, "spirit-0");
    recomputeOverrides(g);
    expect(g.overrides).toHaveLength(1);
    expect(g.overrides[0]?.override).toMatchObject({ kind: "skip-phase", ownerIdx: 0 });
  });

  it("covered face-up card keeps top static-rule active but loses bottom", () => {
    registerMockCard({
      protocol: "spirit",
      value: 1,
      top: {
        kind: "static-rule",
        apply: (ctx) => ({
          kind: "value-modifier",
          lineIdx: 0,
          side: "self",
          ownerIdx: ctx.self,
          delta: () => 1,
        }),
      },
      middle: null,
      bottom: {
        kind: "static-rule",
        apply: (ctx) => ({ kind: "skip-phase", phase: "check-cache", ownerIdx: ctx.self }),
      },
    });
    const g = newGame();
    placeCard(g, 0, 0, "spirit-1"); // bottom card
    placeCard(g, 0, 0, "spirit-1"); // top, covers the first
    recomputeOverrides(g);
    // Both cards' top rules are active (2 value-modifier overrides).
    // Only the uncovered card contributes its bottom (1 skip-phase override).
    const valueMods = g.overrides.filter((o) => o.override.kind === "value-modifier");
    const phaseSkips = g.overrides.filter((o) => o.override.kind === "skip-phase");
    expect(valueMods).toHaveLength(2);
    expect(phaseSkips).toHaveLength(1);
  });

  it("face-down cards contribute no overrides regardless of card def", () => {
    registerMockCard({
      protocol: "fire",
      value: 0,
      top: {
        kind: "static-rule",
        apply: (ctx) => ({ kind: "skip-phase", phase: "check-cache", ownerIdx: ctx.self }),
      },
      middle: null,
      bottom: null,
    });
    const g = newGame();
    placeCard(g, 0, 0, "fire-0", true);
    recomputeOverrides(g);
    expect(g.overrides).toHaveLength(0);
  });
});

describe("phase triggers via Game.run()", () => {
  it("Start: trigger fires on owner's start phase", () => {
    let fired = 0;
    registerMockCard({
      protocol: "spirit",
      value: 2,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-phase",
        phase: "start",
        resolve: function* (ctx) {
          fired++;
          yield* ctx.draw(1);
        },
      },
    });
    const g = newGame();
    placeCard(g, 0, 1, "spirit-2");
    const game = new Game(g);
    game.run();
    expect(fired).toBe(1);
    expect(g.players[0].hand.length).toBe(6);
  });

  it("End: turn does not flip while an end trigger's question is still pending", () => {
    // Regression: an end-of-turn trigger that raises a question must resolve
    // BEFORE endTurn() flips activePlayerIdx / turnNumber. Otherwise the UI
    // (which reads activePlayerIdx & phase) shows the next player's turn while
    // the ending player is still answering their own card's prompt.
    registerMockCard({
      protocol: "spirit",
      value: 2,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-phase",
        phase: "end",
        resolve: function* (ctx) {
          yield* ctx.promptOption({
            options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
            reason: "end-trigger-choice",
          });
        },
      },
    });
    const g = newGame();
    placeCard(g, 0, 1, "spirit-2");
    g.phase = "end";
    const turn = g.turnNumber;
    const game = new Game(g);
    const blocked = game.run();

    expect(blocked.kind).toBe("awaiting-answer");
    expect(g.pendingQuestion?.forPlayerIdx).toBe(0);
    // The turn must still belong to player 0 while their prompt is open.
    expect(g.activePlayerIdx).toBe(0);
    expect(g.phase).toBe("end");
    expect(g.turnNumber).toBe(turn);

    // Once they answer, the turn flips to player 1 (who then runs on to their
    // own action phase, where the engine next blocks for input).
    game.commit(0, {
      kind: "single",
      questionId: g.pendingQuestion!.questionId,
      optionId: g.pendingQuestion!.options[0]!.id,
    });
    expect(g.activePlayerIdx).toBe(1);
    expect(g.turnNumber).toBe(turn + 1);
  });

  it("Start: trigger does NOT fire on the opponent's turn", () => {
    let fired = 0;
    registerMockCard({
      protocol: "fire",
      value: 1,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-phase",
        phase: "start",
        resolve: function* () {
          fired++;
        },
      },
    });
    const g = newGame();
    // Card on player 1's side. Player 0 starts the turn — shouldn't fire.
    placeCard(g, 1, 0, "fire-1");
    const game = new Game(g);
    game.run();
    expect(fired).toBe(0);
  });
});

describe("reactive after-action triggers", () => {
  it("after-draw fires after a draw Op completes", () => {
    let fired = 0;
    registerMockCard({
      protocol: "death",
      value: 1,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-reactive",
        on: "after-draw",
        scope: "self",
        resolve: function* () {
          fired++;
        },
      },
    });
    const g = newGame();
    placeCard(g, 0, 1, "death-1");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "draw", playerIdx: 0, count: 1 };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(1);
  });

  it("after-draw does NOT fire when a card is played directly from deck (fromDeck=true)", () => {
    // "Play the top card of your deck face-down" is a play action, not a
    // draw — the card moves deck → field without ever entering hand.
    // Spirit 3 ("After you draw cards: shift this") must not fire.
    let fired = 0;
    registerMockCard({
      protocol: "death",
      value: 1,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-reactive",
        on: "after-draw",
        scope: "self",
        resolve: function* () {
          fired++;
        },
      },
    });
    const g = newGame();
    placeCard(g, 0, 1, "death-1");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    const handBefore = g.players[0].hand.length;
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "play", playerIdx: 0, lineIdx: 0, faceDown: true, fromDeck: true };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(0);
    expect(g.players[0].hand.length).toBe(handBefore);
  });

  it("scope=opp only fires when the opponent of the source player is the actor", () => {
    let fired = 0;
    registerMockCard({
      protocol: "plague",
      value: 1,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-reactive",
        on: "after-discard",
        scope: "opp",
        resolve: function* () {
          fired++;
        },
      },
    });
    const g = newGame();
    placeCard(g, 0, 0, "plague-1"); // owner = 0; scope=opp ⇒ fires when actorIdx=1
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    const handCard = g.players[1].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "discard", playerIdx: 1, instanceId: handCard.instanceId };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(1);
  });
});

describe("replacement triggers", () => {
  it("'covered' fires on the previously-uncovered card when a new card is played on top", () => {
    let fired = 0;
    registerMockCard({
      protocol: "fire",
      value: 0,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "covered",
        resolve: function* () {
          fired++;
        },
      },
    });
    const g = newGame();
    placeCard(g, 0, 1, "fire-0");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    const handCard = g.players[0].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: handCard.instanceId,
        lineIdx: 1,
        faceDown: false,
      };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(1);
  });

  it("'deleted' fires on the deleted card before the removal", () => {
    let observedOnField: boolean | null = null;
    registerMockCard({
      protocol: "speed",
      value: 0,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "deleted",
        resolve: function* (ctx) {
          // The card is still on the field at this point.
          observedOnField = !!ctx.thisCard();
          yield* ctx.draw(0); // no-op yield to exercise generator
        },
      },
    });
    const g = newGame();
    const c = placeCard(g, 0, 2, "speed-0");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "delete", instanceId: c.instanceId };
    }
    rt.push("test", effect());
    rt.pump();
    expect(observedOnField).toBe(true);
  });

  it("'deleted-by-compile' fires only when cause = compile", () => {
    let normal = 0;
    let byCompile = 0;
    registerMockCard({
      protocol: "speed",
      value: 2,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "deleted-by-compile",
        resolve: function* () {
          byCompile++;
        },
      },
    });
    registerMockCard({
      protocol: "speed",
      value: 3,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "deleted",
        resolve: function* () {
          normal++;
        },
      },
    });
    const g = newGame();
    const c1 = placeCard(g, 0, 0, "speed-2");
    const c2 = placeCard(g, 0, 1, "speed-3");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "delete", instanceId: c1.instanceId, cause: "compile" };
      yield { kind: "delete", instanceId: c2.instanceId };
    }
    rt.push("test", effect());
    rt.pump();
    expect(byCompile).toBe(1);
    expect(normal).toBe(1);
  });

  it("Speed 2 escape: shifting the card during 'deleted-by-compile' cancels the deletion", () => {
    // Mock Speed 2: when about to be deleted by compile, shift this card to another line.
    registerMockCard({
      protocol: "speed",
      value: 2,
      top: {
        kind: "trigger-replacement",
        on: "deleted-by-compile",
        resolve: function* (ctx) {
          yield { kind: "shift", instanceId: ctx.thisInstanceId, toLineIdx: 1 };
        },
      },
      middle: null,
      bottom: null,
    });
    const g = newGame();
    const c = placeCard(g, 0, 0, "speed-2");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "delete", instanceId: c.instanceId, cause: "compile" };
    }
    rt.push("test", effect());
    rt.pump();
    // Card should now be in line 1 (shifted), NOT in trash.
    expect(g.stacks[0][1].cards.map((x) => x.instanceId)).toContain(c.instanceId);
    expect(g.stacks[0][0].cards.map((x) => x.instanceId)).not.toContain(c.instanceId);
    expect(g.players[0].trash.map((x) => x.instanceId)).not.toContain(c.instanceId);
  });

  it("Speed 2 escape: if the trigger does NOT shift the card, deletion still proceeds", () => {
    // Mock Speed 2: trigger fires but does nothing (e.g. no legal destination).
    registerMockCard({
      protocol: "speed",
      value: 2,
      top: {
        kind: "trigger-replacement",
        on: "deleted-by-compile",
        resolve: function* () {
          // intentionally a no-op
        },
      },
      middle: null,
      bottom: null,
    });
    const g = newGame();
    const c = placeCard(g, 0, 0, "speed-2");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "delete", instanceId: c.instanceId, cause: "compile" };
    }
    rt.push("test", effect());
    rt.pump();
    // Card NOT displaced — deletion proceeds.
    expect(g.stacks[0][0].cards.map((x) => x.instanceId)).not.toContain(c.instanceId);
    expect(g.players[0].trash.map((x) => x.instanceId)).toContain(c.instanceId);
  });

  it("Non-compile deletes do NOT take the deferred-escape path", () => {
    // Even if a card has a 'deleted-by-compile' trigger AND a 'deleted' trigger,
    // plain deletes use the legacy fire-and-forget order (existing behaviour).
    let byCompileFired = 0;
    registerMockCard({
      protocol: "speed",
      value: 2,
      top: {
        kind: "trigger-replacement",
        on: "deleted-by-compile",
        resolve: function* () {
          byCompileFired++;
        },
      },
      middle: null,
      bottom: null,
    });
    const g = newGame();
    const c = placeCard(g, 0, 0, "speed-2");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      // Plain delete, no cause:"compile".
      yield { kind: "delete", instanceId: c.instanceId };
    }
    rt.push("test", effect());
    rt.pump();
    // 'deleted-by-compile' must NOT fire for a non-compile delete.
    expect(byCompileFired).toBe(0);
    // Card is deleted as before.
    expect(g.players[0].trash.map((x) => x.instanceId)).toContain(c.instanceId);
  });
});

// "First, X" replacement triggers must run BEFORE the would-be mutation, not
// after. The engine routes opPlay / opShift / opFlip through deferred wrappers
// when triggers exist; these tests pin the new ordering for each of the six
// affected cards.
describe("replacement-trigger ordering — 'First, X' runs before the mutation", () => {
  it("Apathy 2: 'covered' self-flip runs before the cover lands (ends face-down + covered)", () => {
    registerMockCard({
      protocol: "apathy",
      value: 2,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "covered",
        resolve: function* (ctx) {
          yield* ctx.flip(ctx.thisInstanceId);
        },
      },
    });
    const g = newGame();
    const apathy = placeCard(g, 0, 0, "apathy-2");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    const handCard = g.players[0].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: handCard.instanceId,
        lineIdx: 0,
        faceDown: false,
      };
    }
    rt.push("test", effect());
    rt.pump();
    const stack = g.stacks[0][0].cards;
    expect(stack.map((c) => c.instanceId)).toEqual([apathy.instanceId, handCard.instanceId]);
    expect(stack[0]!.faceDown).toBe(true); // Apathy 2 flipped before being covered
    expect(stack[1]!.faceDown).toBe(false);
  });

  it("Hate 4: 'covered' self-target bug — the trigger does NOT pick Hate 4 itself", () => {
    // Stack on line 0: [decoy (printed value 5, covered), hate-4 (uncovered)].
    // Under the old buggy order, hate-4 would be covered first → "lowest covered
    // in this line" includes Hate 4 (printed value 4 < decoy 5), so Hate 4 would
    // self-target. Under the fix, Hate 4 is still uncovered when the trigger
    // fires, so the search picks the decoy (value 5).
    registerMockCard({
      protocol: "fire",
      value: 5,
      top: null,
      middle: null,
      bottom: null,
    });
    registerMockCard({
      protocol: "hate",
      value: 4,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "covered",
        resolve: function* (ctx) {
          // Mirror real Hate 4: delete the lowest-value covered card in this line.
          const loc = findCardOnField(ctx.state(), ctx.thisInstanceId);
          if (!loc) return;
          const target = lowestCoveredInLine(ctx.state(), loc.lineIdx);
          if (target) yield* ctx.delete(target.instanceId);
        },
      },
    });
    const g = newGame();
    const decoy = placeCard(g, 0, 0, "fire-5"); // covered, value 5
    const hate = placeCard(g, 0, 0, "hate-4"); // top, value 4
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    const handCard = g.players[0].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: handCard.instanceId,
        lineIdx: 0,
        faceDown: false,
      };
    }
    rt.push("test", effect());
    rt.pump();
    // Decoy was deleted, Hate 4 survived (now covered by handCard).
    expect(g.players[0].trash.map((c) => c.instanceId)).toContain(decoy.instanceId);
    expect(g.players[0].trash.map((c) => c.instanceId)).not.toContain(hate.instanceId);
    expect(g.stacks[0][0].cards.map((c) => c.instanceId)).toEqual([
      hate.instanceId,
      handCard.instanceId,
    ]);
  });

  it("Life 0: 'covered' self-delete runs before the cover; new card lands on shortened stack", () => {
    registerMockCard({
      protocol: "life",
      value: 0,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "covered",
        resolve: function* (ctx) {
          yield* ctx.delete(ctx.thisInstanceId);
        },
      },
    });
    const g = newGame();
    const life = placeCard(g, 0, 0, "life-0");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    const handCard = g.players[0].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: handCard.instanceId,
        lineIdx: 0,
        faceDown: false,
      };
    }
    rt.push("test", effect());
    rt.pump();
    expect(g.players[0].trash.map((c) => c.instanceId)).toContain(life.instanceId);
    expect(g.stacks[0][0].cards.map((c) => c.instanceId)).toEqual([handCard.instanceId]);
  });

  it("Metal 6 (flipped): self-delete cancels the flip", () => {
    registerMockCard({
      protocol: "metal",
      value: 6,
      top: {
        kind: "trigger-replacement",
        on: "flipped",
        resolve: function* (ctx) {
          yield* ctx.delete(ctx.thisInstanceId);
        },
      },
      middle: null,
      bottom: null,
    });
    const g = newGame();
    const metal = placeCard(g, 0, 0, "metal-6"); // face-up by default
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "flip", instanceId: metal.instanceId };
    }
    rt.push("test", effect());
    rt.pump();
    expect(g.players[0].trash.map((c) => c.instanceId)).toContain(metal.instanceId);
    // Card was never actually flipped — it was deleted while still face-up.
    expect(metal.faceDown).toBe(false);
  });

  it("Metal 6 (covered): self-delete before the cover; new card lands on empty stack", () => {
    registerMockCard({
      protocol: "metal",
      value: 6,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "covered",
        resolve: function* (ctx) {
          yield* ctx.delete(ctx.thisInstanceId);
        },
      },
    });
    const g = newGame();
    const metal = placeCard(g, 0, 0, "metal-6");
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    const handCard = g.players[0].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: handCard.instanceId,
        lineIdx: 0,
        faceDown: false,
      };
    }
    rt.push("test", effect());
    rt.pump();
    expect(g.players[0].trash.map((c) => c.instanceId)).toContain(metal.instanceId);
    expect(g.stacks[0][0].cards.map((c) => c.instanceId)).toEqual([handCard.instanceId]);
  });

  it("Fire 0: 'covered' draw + flip-1-other runs before the cover; new card is NOT a flip candidate", () => {
    // Place a second face-up card on line 1. After Fire 0 is covered, the
    // newly-played covering card lands on line 0 — but Fire 0's trigger fires
    // BEFORE the push, so the new card is still in hand at flip-target time
    // and cannot be the target. The line-1 card is the only candidate.
    registerMockCard({
      protocol: "fire",
      value: 0,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "covered",
        resolve: function* (ctx) {
          yield* ctx.draw(1);
          // Flip any other face-up field card (excluding self).
          const state = ctx.state();
          for (let p = 0; p < 2; p++) {
            for (let l = 0; l < 3; l++) {
              for (const c of state.stacks[p as 0 | 1][l as 0 | 1 | 2].cards) {
                if (c.instanceId === ctx.thisInstanceId) continue;
                if (c.faceDown) continue;
                yield* ctx.flip(c.instanceId);
                return;
              }
            }
          }
        },
      },
    });
    // Also register a neutral target card so it's flippable.
    registerMockCard({
      protocol: "spirit",
      value: 5,
      top: null,
      middle: null,
      bottom: null,
    });
    const g = newGame();
    placeCard(g, 0, 0, "fire-0");
    const target = placeCard(g, 0, 1, "spirit-5");
    recomputeOverrides(g);
    const handBefore = g.players[0].hand.length;
    const rt = new EffectRuntime(g);
    const handCard = g.players[0].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: handCard.instanceId,
        lineIdx: 0,
        faceDown: false,
      };
    }
    rt.push("test", effect());
    rt.pump();
    // Drew 1, then flipped the spirit-5 (the only face-up "other" card on the field at trigger time).
    // Hand: drew 1, played 1 → net unchanged.
    expect(g.players[0].hand.length).toBe(handBefore);
    expect(target.faceDown).toBe(true);
    // The newly-played card landed on top, face-up (not flipped by the trigger).
    expect(g.stacks[0][0].cards[1]!.instanceId).toBe(handCard.instanceId);
    expect(g.stacks[0][0].cards[1]!.faceDown).toBe(false);
  });

  it("Life 3: 'covered' plays deck-top face-down to a chosen line BEFORE the cover lands", () => {
    // Life 3: "When this card would be covered: First, play the top card of
    // your deck face-down in another line." The trigger prompts for the
    // destination line. With the fix, the deck-play resolves before the cover
    // is pushed — so the new card on Life 3 lands face-up on top of Life 3, and
    // the deck-top card is now face-down somewhere else.
    registerMockCard({
      protocol: "life",
      value: 3,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "covered",
        resolve: function* (ctx) {
          const loc = findCardOnField(ctx.state(), ctx.thisInstanceId);
          if (!loc) return;
          const others = ([0, 1, 2] as const).filter((l) => l !== loc.lineIdx);
          const dest = yield* ctx.promptLine({
            allowedLines: [...others] as (0 | 1 | 2)[],
            reason: "life-3-line",
          });
          yield* ctx.play({
            playerIdx: ctx.self,
            lineIdx: dest,
            faceDown: true,
            fromDeck: true,
          });
        },
      },
    });
    const g = newGame();
    const life = placeCard(g, 0, 0, "life-3");
    recomputeOverrides(g);
    const deckBefore = g.players[0].deck.length;
    const rt = new EffectRuntime(g);
    const handCard = g.players[0].hand[0]!;
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: handCard.instanceId,
        lineIdx: 0,
        faceDown: false,
      };
    }
    rt.push("test", effect());
    rt.pump();
    // The trigger suspended on a prompt; resolve it with line 1.
    expect(g.pendingPrompt?.kind).toBe("choose-line");
    rt.resolvePrompt({
      kind: "line-chosen",
      promptId: g.pendingPrompt!.promptId,
      lineIdx: 1,
    });
    rt.pump();
    // Deck shrank by 1 (the deck-top play).
    expect(g.players[0].deck.length).toBe(deckBefore - 1);
    // Life 3 is covered face-up on line 0.
    expect(g.stacks[0][0].cards.map((c) => c.instanceId)).toEqual([
      life.instanceId,
      handCard.instanceId,
    ]);
    expect(life.faceDown).toBe(false);
    // A face-down card sits on line 1 (the deck-top play).
    expect(g.stacks[0][1].cards.length).toBe(1);
    expect(g.stacks[0][1].cards[0]!.faceDown).toBe(true);
  });

  it("opShift's 'covered' replacement also runs before the destination push", () => {
    // Same ordering applies when a shift covers a card with a replacement
    // trigger — not just plays. Verifies opShift's deferred wrapper path.
    registerMockCard({
      protocol: "life",
      value: 0,
      top: null,
      middle: null,
      bottom: {
        kind: "trigger-replacement",
        on: "covered",
        resolve: function* (ctx) {
          yield* ctx.delete(ctx.thisInstanceId);
        },
      },
    });
    registerMockCard({
      protocol: "spirit",
      value: 5,
      top: null,
      middle: null,
      bottom: null,
    });
    const g = newGame();
    const life = placeCard(g, 0, 0, "life-0"); // target of cover, in line 0
    const mover = placeCard(g, 0, 1, "spirit-5"); // shifted from line 1 → line 0
    recomputeOverrides(g);
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "shift", instanceId: mover.instanceId, toLineIdx: 0 };
    }
    rt.push("test", effect());
    rt.pump();
    // Life 0 self-deleted before the shift's push; mover lands on empty line 0.
    expect(g.players[0].trash.map((c) => c.instanceId)).toContain(life.instanceId);
    expect(g.stacks[0][0].cards.map((c) => c.instanceId)).toEqual([mover.instanceId]);
    expect(g.stacks[0][1].cards.map((c) => c.instanceId)).toEqual([]);
  });
});

describe("middle effects on play / flip-up / uncover", () => {
  it("face-up play resolves the card's middle text", () => {
    let fired = 0;
    registerMockCard({
      protocol: "spirit",
      value: 3,
      top: null,
      middle: function* (ctx) {
        fired++;
        yield* ctx.draw(1);
      },
      bottom: null,
    });
    const g = newGame();
    // Force the player to have a "spirit-3" in hand. Replace one card to make it deterministic.
    g.players[0].hand[0] = {
      instanceId: "manual-spirit3",
      cardId: "spirit-3",
      faceDown: false,
      ownerIdx: 0,
    };
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: "manual-spirit3",
        lineIdx: 0,
        faceDown: false,
      };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(1);
    // 1 hand slot consumed by play, 1 drawn by the middle effect → net same.
    expect(g.players[0].hand.length).toBe(5);
  });

  it("face-down play does NOT resolve middle text", () => {
    let fired = 0;
    registerMockCard({
      protocol: "fire",
      value: 4,
      top: null,
      middle: function* () {
        fired++;
      },
      bottom: null,
    });
    const g = newGame();
    g.players[0].hand[0] = {
      instanceId: "manual-fire4",
      cardId: "fire-4",
      faceDown: false,
      ownerIdx: 0,
    };
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield {
        kind: "play",
        playerIdx: 0,
        instanceId: "manual-fire4",
        lineIdx: 0,
        faceDown: true,
      };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(0);
  });

  it("uncovering a face-up card by deletion resolves its middle text", () => {
    let fired = 0;
    registerMockCard({
      protocol: "light",
      value: 1,
      top: null,
      middle: function* () {
        fired++;
      },
      bottom: null,
    });
    const g = newGame();
    placeCard(g, 0, 0, "light-1", false); // bottom; face-up
    placeCard(g, 0, 0, "light-1", false); // top; covers bottom
    recomputeOverrides(g);
    const top = g.stacks[0][0].cards[1]!;
    const rt = new EffectRuntime(g);
    function* effect(): Generator<Op, void, OpResult> {
      yield { kind: "delete", instanceId: top.instanceId };
    }
    rt.push("test", effect());
    rt.pump();
    expect(fired).toBe(1);
  });
});
