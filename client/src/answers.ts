/**
 * Translate UI intent (drag-drop a card, click a line, tap a button) into
 * the unified Answer envelope. Each helper looks up the matching Option on
 * `pendingQuestion` by predicate, returning the Answer ready to send via
 * `send.answer`. Returns null when no matching option exists — the caller
 * should treat that as "this UI action is currently not legal."
 */
import type {
  ActionPayload,
  Answer,
  CompileLinePayload,
  LineIdx,
  Option,
  PlayerIdx,
  Question,
  RearrangePayload,
} from "./types.js";

function find(q: Question, pred: (o: Option) => boolean): Option | null {
  return q.options.find(pred) ?? null;
}

function single(q: Question, opt: Option): Answer {
  return { kind: "single", questionId: q.questionId, optionId: opt.id };
}

export function answerForPlay(
  q: Question,
  arg: { instanceId: string; lineIdx: LineIdx; faceDown: boolean },
): Answer | null {
  if (q.kind !== "action") return null;
  const opt = find(q, (o) => {
    const p = o.payload as ActionPayload;
    return (
      p.kind === "play" &&
      p.instanceId === arg.instanceId &&
      p.lineIdx === arg.lineIdx &&
      p.faceDown === arg.faceDown
    );
  });
  return opt ? single(q, opt) : null;
}

export function answerForRefresh(q: Question): Answer | null {
  if (q.kind !== "action") return null;
  const opt = find(q, (o) => (o.payload as ActionPayload).kind === "refresh");
  return opt ? single(q, opt) : null;
}

export function answerForCompile(q: Question, lineIdx: LineIdx): Answer | null {
  if (q.kind !== "compile-line") return null;
  const opt = find(q, (o) => (o.payload as CompileLinePayload).lineIdx === lineIdx);
  return opt ? single(q, opt) : null;
}

export function answerForRearrange(
  q: Question,
  arg:
    | "skip"
    | { side: PlayerIdx; newOrder: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] },
): Answer | null {
  if (q.kind !== "control-rearrange") return null;
  const opt = find(q, (o) => {
    const p = o.payload as RearrangePayload;
    if (arg === "skip") return p.kind === "skip";
    return (
      p.kind === "rearrange" &&
      p.side === arg.side &&
      p.newOrder[0] === arg.newOrder[0] &&
      p.newOrder[1] === arg.newOrder[1] &&
      p.newOrder[2] === arg.newOrder[2]
    );
  });
  return opt ? single(q, opt) : null;
}

export function answerForChooseCard(q: Question, instanceId: string | null): Answer | null {
  if (q.kind !== "choose-card") return null;
  const opt = find(q, (o) => (o.payload as { instanceId: string | null }).instanceId === instanceId);
  return opt ? single(q, opt) : null;
}

export function answerForChooseLine(q: Question, lineIdx: LineIdx): Answer | null {
  if (q.kind !== "choose-line") return null;
  const opt = find(q, (o) => (o.payload as { lineIdx: LineIdx }).lineIdx === lineIdx);
  return opt ? single(q, opt) : null;
}

export function answerForChooseOption(q: Question, optionId: string): Answer | null {
  if (q.kind !== "choose-option") return null;
  const opt = find(q, (o) => (o.payload as { optionId: string }).optionId === optionId);
  return opt ? single(q, opt) : null;
}

export function answerForDiscard(q: Question, instanceIds: string[]): Answer | null {
  if (q.kind !== "discard-selection") return null;
  const optionIds: string[] = [];
  for (const id of instanceIds) {
    const opt = find(q, (o) => (o.payload as { instanceId: string }).instanceId === id);
    if (!opt) return null;
    optionIds.push(opt.id);
  }
  return { kind: "multi", questionId: q.questionId, optionIds };
}

export function answerForPlayFromHand(
  q: Question,
  arg: { instanceId: string; lineIdx: LineIdx; faceDown: boolean },
): Answer | null {
  if (q.kind !== "play-from-hand") return null;
  const opt = find(q, (o) => {
    const p = o.payload as { instanceId: string; lineIdx: LineIdx; faceDown: boolean };
    return (
      p.instanceId === arg.instanceId &&
      p.lineIdx === arg.lineIdx &&
      p.faceDown === arg.faceDown
    );
  });
  return opt ? single(q, opt) : null;
}

export function answerForAck(q: Question): Answer | null {
  if (q.kind !== "show-hand") return null;
  const opt = q.options[0];
  return opt ? single(q, opt) : null;
}

export function answerForDraftPick(
  q: Question,
  protocols: readonly string[],
): Answer | null {
  if (q.kind !== "draft-pick") return null;
  const sorted = [...protocols].sort();
  const opt = find(q, (o) => {
    const p = o.payload as { protocols: string[] };
    if (p.protocols.length !== sorted.length) return false;
    const a = [...p.protocols].sort();
    return a.every((x, i) => x === sorted[i]);
  });
  return opt ? single(q, opt) : null;
}

// ---------- Drag-drop legality (replaces state.playOptions) ----------

/** Lines that `instanceId` can currently be played into face-up / face-down. */
export interface PlayTargets {
  faceUpLines: LineIdx[];
  faceDownLines: LineIdx[];
}

export function playTargetsFromQuestion(q: Question | null, instanceId: string): PlayTargets {
  const out: PlayTargets = { faceUpLines: [], faceDownLines: [] };
  if (!q) return out;
  if (q.kind === "action") {
    for (const opt of q.options) {
      const p = opt.payload as ActionPayload;
      if (p.kind === "play" && p.instanceId === instanceId) {
        if (p.faceDown) out.faceDownLines.push(p.lineIdx);
        else out.faceUpLines.push(p.lineIdx);
      }
    }
  } else if (q.kind === "play-from-hand") {
    for (const opt of q.options) {
      const p = opt.payload as { instanceId: string; lineIdx: LineIdx; faceDown: boolean };
      if (p.instanceId === instanceId) {
        if (p.faceDown) out.faceDownLines.push(p.lineIdx);
        else out.faceUpLines.push(p.lineIdx);
      }
    }
  }
  return out;
}

/** Lines a compile-line question lets the addressee compile. */
export function compileLinesFromQuestion(q: Question | null): LineIdx[] {
  if (!q || q.kind !== "compile-line") return [];
  return q.options.map((o) => (o.payload as CompileLinePayload).lineIdx);
}
