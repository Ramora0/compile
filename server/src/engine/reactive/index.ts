/**
 * Reactive layer.
 *
 * Card passives (Top / Bottom) translate at runtime into:
 *   - phase triggers     (`Start:` / `End:`)
 *   - reactive triggers  (`After you draw cards: …`)
 *   - replacement triggers (`When this card would be covered: First, …`)
 *   - static rule overrides (value modifiers, play restrictions, phase skips)
 *
 * Visibility rules (rules.md:94–96):
 *   - TOP text is active whenever the card is face-up — even when covered.
 *   - BOTTOM text is active only when face-up AND uncovered.
 *   - MIDDLE text is not a passive — it resolves once on play / flip-up / uncover.
 *
 * This module derives the active set on demand from GameState. It does NOT
 * mutate state directly; it returns the listeners and overrides the runtime /
 * phase machine should consult, plus helpers to push trigger generators onto
 * the runtime stack.
 */

import { findCardOnField } from "../field.js";
import { getCard } from "../../cards/registry.js";
import type {
  CardDef,
  CardEffect,
  Passive,
  ReactiveTrigger,
  ReplacementTrigger,
} from "../../cards/api.js";
import type { CardCtxFull } from "../ctx.js";
import { createCardCtx } from "../ctx.js";
import type { EffectRuntime } from "../runtime.js";
import type {
  CardInstance,
  GameState,
  PlayerIdx,
  RuleOverride,
  RuleCtx,
} from "../types.js";

interface VisiblePassive {
  instanceId: string;
  ownerIdx: PlayerIdx;
  passive: Passive;
  /** "top" passives are active while face-up; "bottom" only while face-up AND uncovered. */
  band: "top" | "bottom";
}

/**
 * Walk the field and yield every (cardInstance, passive) pair currently
 * visible per the cover/face-up rules.
 */
function* visiblePassives(state: GameState): Generator<VisiblePassive> {
  for (let p = 0; p < state.stacks.length; p++) {
    const playerIdx = p as PlayerIdx;
    for (const stack of state.stacks[playerIdx]) {
      const cards = stack.cards;
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i]!;
        if (card.faceDown) continue;
        const def = getCard(card.cardId);
        if (!def) continue; // unregistered card — nothing to do (graceful with v1's empty registry)
        const isUncovered = i === cards.length - 1;
        if (def.top) {
          yield { instanceId: card.instanceId, ownerIdx: card.ownerIdx, passive: def.top, band: "top" };
        }
        if (def.bottom && isUncovered) {
          yield {
            instanceId: card.instanceId,
            ownerIdx: card.ownerIdx,
            passive: def.bottom,
            band: "bottom",
          };
        }
      }
    }
  }
}

/**
 * Fully recompute the rule-override registry from current visible passives.
 * Idempotent and side-effect-free aside from mutating `state.overrides`.
 */
export function recomputeOverrides(state: GameState): void {
  const next: { sourceInstanceId: string; override: RuleOverride }[] = [];
  for (const vp of visiblePassives(state)) {
    if (vp.passive.kind !== "static-rule") continue;
    const ruleCtx: RuleCtx = {
      self: vp.ownerIdx,
      opp: (1 - vp.ownerIdx) as PlayerIdx,
      thisInstanceId: vp.instanceId,
      state,
    };
    next.push({ sourceInstanceId: vp.instanceId, override: vp.passive.apply(ruleCtx) });
  }
  state.overrides = next;
}

/** True if the named phase is suppressed for the given owner via a static-rule override. */
export function isPhaseSkippedFor(
  state: GameState,
  phase: "check-cache" | "check-control",
  ownerIdx: PlayerIdx,
): boolean {
  return state.overrides.some(
    (o) =>
      o.override.kind === "skip-phase" &&
      o.override.phase === phase &&
      o.override.ownerIdx === ownerIdx,
  );
}

/** True if the named player has an active play-anywhere override (Spirit 1 top). */
export function playAnywhereFor(state: GameState, affects: PlayerIdx): boolean {
  return state.overrides.some(
    (o) => o.override.kind === "play-anywhere" && o.override.affects === affects,
  );
}

/** True if the line is under an active ignore-middle override on the given side. */
export function ignoreMiddleFor(
  state: GameState,
  ownerIdx: PlayerIdx,
  lineIdx: 0 | 1 | 2,
): boolean {
  for (const o of state.overrides) {
    if (o.override.kind !== "ignore-middle") continue;
    const m = o.override;
    if (m.lineIdx !== lineIdx) continue;
    // "any" side suppresses both — used by Apathy 2 ("cards in this line").
    if (m.side === "self" && m.ownerIdx !== ownerIdx) continue;
    if (m.side === "opp" && m.ownerIdx === ownerIdx) continue;
    return true;
  }
  return false;
}

/**
 * True if the named player is forbidden from playing in the given line
 * (or any line) via an active play-restriction.
 */
export function playRestrictedFor(
  state: GameState,
  affects: PlayerIdx,
  lineIdx: 0 | 1 | 2,
  faceDown: boolean,
): boolean {
  for (const o of state.overrides) {
    if (o.override.kind !== "play-restriction") continue;
    if (o.override.affects !== affects) continue;
    if (o.override.lineIdx !== "any" && o.override.lineIdx !== lineIdx) continue;
    if (o.override.forbid === "any-card") return true;
    if (o.override.forbid === "face-down" && faceDown) return true;
    if (o.override.forbid === "face-up" && !faceDown) return true;
  }
  return false;
}

/** Active phase triggers (Start / End) targeting a specific player's turn. */
export function collectPhaseTriggers(
  state: GameState,
  phase: "start" | "end",
  ownerIdx: PlayerIdx,
): { instanceId: string; resolve: CardEffect }[] {
  const out: { instanceId: string; resolve: CardEffect }[] = [];
  for (const vp of visiblePassives(state)) {
    if (vp.passive.kind !== "trigger-phase") continue;
    if (vp.passive.phase !== phase) continue;
    if (vp.ownerIdx !== ownerIdx) continue;
    out.push({ instanceId: vp.instanceId, resolve: vp.passive.resolve });
  }
  return out;
}

/** Active reactive triggers matching `(on, actorIdx)` per the trigger's scope. */
export function collectReactiveTriggers(
  state: GameState,
  on: ReactiveTrigger,
  actorIdx: PlayerIdx,
): { instanceId: string; ownerIdx: PlayerIdx; resolve: CardEffect }[] {
  const out: { instanceId: string; ownerIdx: PlayerIdx; resolve: CardEffect }[] = [];
  for (const vp of visiblePassives(state)) {
    if (vp.passive.kind !== "trigger-reactive") continue;
    if (vp.passive.on !== on) continue;
    const matches =
      vp.passive.scope === "any" ||
      (vp.passive.scope === "self" && vp.ownerIdx === actorIdx) ||
      (vp.passive.scope === "opp" && vp.ownerIdx !== actorIdx);
    if (!matches) continue;
    out.push({ instanceId: vp.instanceId, ownerIdx: vp.ownerIdx, resolve: vp.passive.resolve });
  }
  return out;
}

/**
 * Active replacement triggers for a specific lifecycle event on a specific card.
 * Replacements run BEFORE the underlying transition completes (the runtime is
 * responsible for that ordering — fire this, then perform the transition).
 */
export function collectReplacementTriggers(
  state: GameState,
  on: ReplacementTrigger,
  instanceId: string,
): { instanceId: string; ownerIdx: PlayerIdx; resolve: CardEffect }[] {
  const out: { instanceId: string; ownerIdx: PlayerIdx; resolve: CardEffect }[] = [];
  for (const vp of visiblePassives(state)) {
    if (vp.instanceId !== instanceId) continue;
    if (vp.passive.kind !== "trigger-replacement") continue;
    if (vp.passive.on !== on) continue;
    out.push({ instanceId: vp.instanceId, ownerIdx: vp.ownerIdx, resolve: vp.passive.resolve });
  }
  return out;
}

/**
 * Push a list of triggers onto the runtime's effect stack in LIFO order: the
 * LAST collected trigger ends up on top, so the FIRST collected one runs after.
 *
 * Per rules.md:100 ("Last in, first out"), the most-recently-played card's
 * trigger should resolve first when multiple are eligible. Field iteration
 * order is bottom-up, so iterate the collected list in reverse to push the
 * earlier (later-played) triggers last.
 */
export function fireTriggers(
  runtime: EffectRuntime,
  state: GameState,
  triggers: { instanceId: string; ownerIdx?: PlayerIdx; resolve: CardEffect }[],
): void {
  // Heuristic: cards played later (higher in stack, later in iteration order)
  // resolve first. visiblePassives iterates bottom-up, so reverse to LIFO.
  const ordered = [...triggers].reverse();
  for (const t of ordered) {
    const owner =
      t.ownerIdx ??
      findCardOnField(state, t.instanceId)?.playerIdx ??
      state.activePlayerIdx;
    const ctx: CardCtxFull = createCardCtx(state, t.instanceId, owner);
    runtime.push(`trigger:${t.instanceId}`, t.resolve(ctx));
  }
}
