/**
 * Card author API. Each helper here returns a Generator that yields one or
 * more Ops and returns a typed result. Card-effect generators delegate to
 * them with `yield*`:
 *
 *     function* (ctx) {
 *       const drawn = yield* ctx.draw(2);
 *       const choice = yield* ctx.promptCard({ filter: { side: "any" }, optional: false, reason: "pick" });
 *       if (choice) yield* ctx.flip(choice);
 *     }
 *
 * Card authors can also yield raw Ops directly when they want lower-level control.
 */

import type {
  CardCtx,
  CardInstance,
  GameState,
  LineIdx,
  PlayerIdx,
  Side,
} from "./types.js";
import type {
  CardFilter,
  ChooseCardPrompt,
  ChooseLinePrompt,
  ChooseOptionPrompt,
  DiscardSelectionPrompt,
  Op,
  OpResult,
  PromptResponse,
} from "./ops.js";

/** Reading helpers — synchronous, do not yield Ops. */
export interface CardCtxReads {
  state(): Readonly<GameState>;
  myHand(): readonly CardInstance[];
  oppHand(): readonly CardInstance[];
  fieldLine(playerIdx: PlayerIdx, lineIdx: LineIdx): readonly CardInstance[];
  thisCard(): CardInstance | null;
}

/**
 * Mutation helpers — generator delegates. Each returns a typed value; the
 * caller uses `yield*` to delegate to it.
 */
export interface CardCtxOps {
  draw(count: number, playerIdx?: PlayerIdx): Generator<Op, CardInstance[], OpResult>;
  refresh(playerIdx?: PlayerIdx): Generator<Op, CardInstance[], OpResult>;
  discard(instanceId: string, playerIdx?: PlayerIdx): Generator<Op, CardInstance | null, OpResult>;
  delete(instanceId: string, cause?: "compile" | "effect"): Generator<Op, CardInstance | null, OpResult>;
  flip(instanceId: string): Generator<Op, { instanceId: string; nowFaceDown: boolean } | null, OpResult>;
  shift(instanceId: string, toLineIdx: LineIdx): Generator<Op, boolean, OpResult>;
  play(opts: {
    instanceId: string;
    lineIdx: LineIdx;
    faceDown: boolean;
    playerIdx?: PlayerIdx;
  }): Generator<Op, CardInstance | null, OpResult>;
  return(instanceId: string, toHandOf?: PlayerIdx): Generator<Op, CardInstance | null, OpResult>;
  reveal(instanceId: string, toPlayerIdx?: PlayerIdx): Generator<Op, CardInstance | null, OpResult>;
  transferOwnership(instanceId: string, newOwnerIdx: PlayerIdx): Generator<Op, void, OpResult>;
}

/** Prompt helpers — return the player's chosen value (or null/empty for optional/cancel). */
export interface CardCtxPrompts {
  promptCard(opts: {
    filter: CardFilter;
    optional: boolean;
    reason: string;
    forPlayerIdx?: PlayerIdx;
  }): Generator<Op, string | null, OpResult>;
  promptLine(opts: {
    allowedLines: LineIdx[];
    reason: string;
    forPlayerIdx?: PlayerIdx;
  }): Generator<Op, LineIdx, OpResult>;
  promptOption(opts: {
    options: { id: string; label: string }[];
    reason: string;
    forPlayerIdx?: PlayerIdx;
  }): Generator<Op, string, OpResult>;
  promptDiscards(opts: {
    count: number;
    reason: string;
    forPlayerIdx?: PlayerIdx;
  }): Generator<Op, string[], OpResult>;
}

export interface CardCtxFull extends CardCtx, CardCtxReads, CardCtxOps, CardCtxPrompts {}

let promptIdCounter = 0;
function freshPromptId(): string {
  promptIdCounter++;
  return `cp${promptIdCounter}`;
}
export function _resetCardPromptCounter(): void {
  promptIdCounter = 0;
}

export function createCardCtx(state: GameState, thisInstanceId: string, self: PlayerIdx): CardCtxFull {
  const opp = (1 - self) as PlayerIdx;

  const ctx: CardCtxFull = {
    self,
    opp,
    thisInstanceId,

    // -------- Reads --------
    state: () => state,
    myHand: () => state.players[self].hand,
    oppHand: () => state.players[opp].hand,
    fieldLine: (p: PlayerIdx, l: LineIdx) => state.stacks[p][l].cards,
    thisCard: () => findInstance(state, thisInstanceId),

    // -------- Ops --------
    *draw(count, playerIdx = self) {
      const r = (yield { kind: "draw", playerIdx, count }) as { drawn: CardInstance[] } | undefined;
      return r?.drawn ?? [];
    },
    *refresh(playerIdx = self) {
      const r = (yield { kind: "refresh", playerIdx }) as { drawn: CardInstance[] } | undefined;
      return r?.drawn ?? [];
    },
    *discard(instanceId, playerIdx = self) {
      const r = (yield { kind: "discard", playerIdx, instanceId }) as { discarded: CardInstance | null } | undefined;
      return r?.discarded ?? null;
    },
    *delete(instanceId, cause = "effect") {
      const r = (yield { kind: "delete", instanceId, cause }) as { deleted: CardInstance | null } | undefined;
      return r?.deleted ?? null;
    },
    *flip(instanceId) {
      const r = (yield { kind: "flip", instanceId }) as
        | { flipped: { instanceId: string; nowFaceDown: boolean } | null }
        | undefined;
      return r?.flipped ?? null;
    },
    *shift(instanceId, toLineIdx) {
      const r = (yield { kind: "shift", instanceId, toLineIdx }) as { shifted: boolean } | undefined;
      return r?.shifted ?? false;
    },
    *play(opts) {
      const r = (yield {
        kind: "play",
        playerIdx: opts.playerIdx ?? self,
        instanceId: opts.instanceId,
        lineIdx: opts.lineIdx,
        faceDown: opts.faceDown,
      }) as { played: CardInstance | null } | undefined;
      return r?.played ?? null;
    },
    *return(instanceId, toHandOf) {
      const op: Op =
        toHandOf === undefined
          ? { kind: "return", instanceId }
          : { kind: "return", instanceId, toHandOf };
      const r = (yield op) as { returned: CardInstance | null } | undefined;
      return r?.returned ?? null;
    },
    *reveal(instanceId, toPlayerIdx = self) {
      const r = (yield { kind: "reveal", instanceId, toPlayerIdx }) as { revealed: CardInstance | null } | undefined;
      return r?.revealed ?? null;
    },
    *transferOwnership(instanceId, newOwnerIdx) {
      yield { kind: "transfer-ownership", instanceId, newOwnerIdx };
    },

    // -------- Prompts --------
    *promptCard(opts) {
      const promptId = freshPromptId();
      const prompt: ChooseCardPrompt = {
        kind: "choose-card",
        promptId,
        forPlayerIdx: opts.forPlayerIdx ?? self,
        filter: opts.filter,
        optional: opts.optional,
        reason: opts.reason,
      };
      const r = (yield { kind: "prompt", prompt }) as PromptResponse | undefined;
      if (!r || r.kind !== "card-chosen") return null;
      return r.instanceId;
    },
    *promptLine(opts) {
      const promptId = freshPromptId();
      const prompt: ChooseLinePrompt = {
        kind: "choose-line",
        promptId,
        forPlayerIdx: opts.forPlayerIdx ?? self,
        allowedLines: opts.allowedLines,
        reason: opts.reason,
      };
      const r = (yield { kind: "prompt", prompt }) as PromptResponse | undefined;
      if (!r || r.kind !== "line-chosen") {
        throw new Error("expected line-chosen response");
      }
      return r.lineIdx;
    },
    *promptOption(opts) {
      const promptId = freshPromptId();
      const prompt: ChooseOptionPrompt = {
        kind: "choose-option",
        promptId,
        forPlayerIdx: opts.forPlayerIdx ?? self,
        options: opts.options,
        reason: opts.reason,
      };
      const r = (yield { kind: "prompt", prompt }) as PromptResponse | undefined;
      if (!r || r.kind !== "option-chosen") {
        throw new Error("expected option-chosen response");
      }
      return r.optionId;
    },
    *promptDiscards(opts) {
      const promptId = freshPromptId();
      const prompt: DiscardSelectionPrompt = {
        kind: "discard-selection",
        promptId,
        forPlayerIdx: opts.forPlayerIdx ?? self,
        count: opts.count,
        reason: opts.reason,
      };
      const r = (yield { kind: "prompt", prompt }) as PromptResponse | undefined;
      if (!r || r.kind !== "discard-chosen") {
        throw new Error("expected discard-chosen response");
      }
      return r.instanceIds;
    },
  };

  return ctx;
}

function findInstance(state: GameState, instanceId: string): CardInstance | null {
  for (const side of state.stacks) {
    for (const stack of side) {
      const f = stack.cards.find((c) => c.instanceId === instanceId);
      if (f) return f;
    }
  }
  for (const p of state.players) {
    const f =
      p.hand.find((c) => c.instanceId === instanceId) ??
      p.deck.find((c) => c.instanceId === instanceId) ??
      p.trash.find((c) => c.instanceId === instanceId);
    if (f) return f;
  }
  return null;
}

export type { Side };
