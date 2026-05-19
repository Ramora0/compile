import type { CardValue, ProtocolName } from "../shared/protocols.js";
import type { Op, OpResult } from "../engine/ops.js";
import type { RuleCtx, RuleOverride } from "../engine/types.js";
import type { CardCtxFull } from "../engine/ctx.js";

/**
 * Card-effect generator. The runtime always supplies a full ctx with read,
 * op, and prompt delegates — `CardCtxFull` is the practical surface every
 * card uses.
 */
export type CardEffect = (ctx: CardCtxFull) => Generator<Op, void, OpResult>;

export type Passive =
  | { kind: "trigger-phase"; phase: "start" | "end"; resolve: CardEffect }
  | {
      kind: "trigger-reactive";
      on: ReactiveTrigger;
      scope: "self" | "opp" | "any";
      resolve: CardEffect;
    }
  | { kind: "trigger-replacement"; on: ReplacementTrigger; resolve: CardEffect }
  | { kind: "static-rule"; apply: (ctx: RuleCtx) => RuleOverride };

export type ReactiveTrigger =
  | "after-draw"
  | "after-discard"
  | "after-delete"
  | "after-flip"
  | "after-shift"
  | "after-play"
  | "after-return"
  | "after-clear-cache"
  | "after-refresh"
  | "after-compile";

export type ReplacementTrigger =
  | "covered"
  | "flipped"
  | "deleted"
  | "deleted-by-compile"
  | "returned"
  | "shifted";

export interface CardDef {
  protocol: ProtocolName;
  value: CardValue;
  top: Passive | null;
  middle: CardEffect | null;
  bottom: Passive | null;
}

export { registerCard, getCard, requireCard, hasCard, listCards, clearRegistry } from "./registry.js";
