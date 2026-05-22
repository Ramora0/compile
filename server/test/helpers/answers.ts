/**
 * Test helpers that drive the engine through its unified Question/Answer
 * surface. Each helper calls `game.run()` to ensure the engine has settled
 * on a question, then finds the matching option and commits it. This means
 * tests exercise the real enumeration path rather than constructing Answer
 * envelopes by hand.
 */
import type { Game, EngineBlocked } from "../../src/engine/game.js";
import type {
  ActionPayload,
  Answer,
  CompileLinePayload,
  Option,
  Question,
  RearrangePayload,
} from "../../src/engine/question.js";
import type { LineIdx, PlayerIdx } from "../../src/engine/types.js";

function require_pending(game: Game): Question {
  // Ensure run() has had a chance to populate pendingQuestion; tests often
  // construct a Game and call a commit helper without first invoking run().
  if (!game.state.pendingQuestion) game.run();
  const q = game.state.pendingQuestion;
  if (!q) throw new Error("no pending question after run()");
  return q;
}

function find(q: Question, pred: (o: Option) => boolean, hint: string): Option {
  const opt = q.options.find(pred);
  if (!opt) {
    const ids = q.options.map((o) => o.id).join(", ");
    throw new Error(`no option matches ${hint}; question=${q.kind}; options=[${ids}]`);
  }
  return opt;
}

function answerSingle(q: Question, opt: Option): Answer {
  return { kind: "single", questionId: q.questionId, optionId: opt.id };
}

export function commitMatching(
  game: Game,
  playerIdx: PlayerIdx,
  pred: (o: Option, q: Question) => boolean,
  hint = "predicate",
): EngineBlocked {
  const q = require_pending(game);
  const opt = find(q, (o) => pred(o, q), hint);
  return game.commit(playerIdx, answerSingle(q, opt));
}

export function commitPlay(
  game: Game,
  playerIdx: PlayerIdx,
  arg: { instanceId: string; lineIdx: LineIdx; faceDown: boolean },
): EngineBlocked {
  const q = require_pending(game);
  if (q.kind !== "action") {
    throw new Error(`commitPlay: pending question is ${q.kind}, not action`);
  }
  const opt = find(
    q,
    (o) => {
      const p = o.payload as ActionPayload;
      return (
        p.kind === "play" &&
        p.instanceId === arg.instanceId &&
        p.lineIdx === arg.lineIdx &&
        p.faceDown === arg.faceDown
      );
    },
    `play ${arg.instanceId} ${arg.faceDown ? "down" : "up"} L${arg.lineIdx}`,
  );
  return game.commit(playerIdx, answerSingle(q, opt));
}

export function commitRefresh(game: Game, playerIdx: PlayerIdx): EngineBlocked {
  const q = require_pending(game);
  if (q.kind !== "action") {
    throw new Error(`commitRefresh: pending question is ${q.kind}, not action`);
  }
  const opt = find(q, (o) => (o.payload as ActionPayload).kind === "refresh", "refresh");
  return game.commit(playerIdx, answerSingle(q, opt));
}

export function commitCompile(
  game: Game,
  playerIdx: PlayerIdx,
  lineIdx: LineIdx,
): EngineBlocked {
  const q = require_pending(game);
  if (q.kind !== "compile-line") {
    throw new Error(`commitCompile: pending question is ${q.kind}, not compile-line`);
  }
  const opt = find(
    q,
    (o) => (o.payload as CompileLinePayload).lineIdx === lineIdx,
    `compile L${lineIdx}`,
  );
  return game.commit(playerIdx, answerSingle(q, opt));
}

export function commitRearrange(
  game: Game,
  playerIdx: PlayerIdx,
  arg: "skip" | { side: PlayerIdx; newOrder: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] },
): EngineBlocked {
  const q = require_pending(game);
  if (q.kind !== "control-rearrange") {
    throw new Error(`commitRearrange: pending question is ${q.kind}, not control-rearrange`);
  }
  const opt = find(
    q,
    (o) => {
      const p = o.payload as RearrangePayload;
      if (arg === "skip") return p.kind === "skip";
      return (
        p.kind === "rearrange" &&
        p.side === arg.side &&
        p.newOrder[0] === arg.newOrder[0] &&
        p.newOrder[1] === arg.newOrder[1] &&
        p.newOrder[2] === arg.newOrder[2]
      );
    },
    typeof arg === "string" ? arg : `${arg.side}:${arg.newOrder.join(",")}`,
  );
  return game.commit(playerIdx, answerSingle(q, opt));
}

export function commitCard(
  game: Game,
  playerIdx: PlayerIdx,
  instanceId: string | null,
): EngineBlocked {
  const q = require_pending(game);
  if (q.kind !== "choose-card") {
    throw new Error(`commitCard: pending question is ${q.kind}, not choose-card`);
  }
  const opt = find(
    q,
    (o) => (o.payload as { instanceId: string | null }).instanceId === instanceId,
    `card ${instanceId ?? "skip"}`,
  );
  return game.commit(playerIdx, answerSingle(q, opt));
}

export function commitLine(
  game: Game,
  playerIdx: PlayerIdx,
  lineIdx: LineIdx,
): EngineBlocked {
  const q = require_pending(game);
  if (q.kind !== "choose-line") {
    throw new Error(`commitLine: pending question is ${q.kind}, not choose-line`);
  }
  const opt = find(
    q,
    (o) => (o.payload as { lineIdx: LineIdx }).lineIdx === lineIdx,
    `line L${lineIdx}`,
  );
  return game.commit(playerIdx, answerSingle(q, opt));
}

export function commitOption(
  game: Game,
  playerIdx: PlayerIdx,
  optionId: string,
): EngineBlocked {
  const q = require_pending(game);
  if (q.kind !== "choose-option") {
    throw new Error(`commitOption: pending question is ${q.kind}, not choose-option`);
  }
  const opt = find(
    q,
    (o) => (o.payload as { optionId: string }).optionId === optionId,
    `option ${optionId}`,
  );
  return game.commit(playerIdx, answerSingle(q, opt));
}

export function commitDiscard(
  game: Game,
  playerIdx: PlayerIdx,
  instanceIds: string[],
): EngineBlocked {
  const q = require_pending(game);
  if (q.kind !== "discard-selection") {
    throw new Error(`commitDiscard: pending question is ${q.kind}, not discard-selection`);
  }
  const optionIds: string[] = [];
  for (const id of instanceIds) {
    const opt = find(
      q,
      (o) => (o.payload as { instanceId: string }).instanceId === id,
      `discard ${id}`,
    );
    optionIds.push(opt.id);
  }
  return game.commit(playerIdx, {
    kind: "multi",
    questionId: q.questionId,
    optionIds,
  });
}

export function commitAck(game: Game, playerIdx: PlayerIdx): EngineBlocked {
  const q = require_pending(game);
  if (q.kind !== "show-hand") {
    throw new Error(`commitAck: pending question is ${q.kind}, not show-hand`);
  }
  return game.commit(playerIdx, answerSingle(q, q.options[0]!));
}

export function commitPlayFromHand(
  game: Game,
  playerIdx: PlayerIdx,
  arg: { instanceId: string; lineIdx: LineIdx; faceDown: boolean },
): EngineBlocked {
  const q = require_pending(game);
  if (q.kind !== "play-from-hand") {
    throw new Error(`commitPlayFromHand: pending question is ${q.kind}, not play-from-hand`);
  }
  const opt = find(
    q,
    (o) => {
      const p = o.payload as { instanceId: string; lineIdx: LineIdx; faceDown: boolean };
      return (
        p.instanceId === arg.instanceId &&
        p.lineIdx === arg.lineIdx &&
        p.faceDown === arg.faceDown
      );
    },
    `play-from-hand ${arg.instanceId}`,
  );
  return game.commit(playerIdx, answerSingle(q, opt));
}
