/**
 * Maps log events from the engine into Animation objects the layer can play.
 *
 * Two kinds of animation:
 *   - "fly": a ghost <Card> traveling between two anchors.
 *   - "pulse": an in-place CSS class applied to an existing DOM node (the
 *     queue tracks {anchorId, className, durationMs} and the renderer adds
 *     the class for that span).
 *
 * Pacing is mixed per the user's choice: key actions get 350-400 ms,
 * minor actions get 180-280 ms. All durations live in `DURATION` so they
 * can be tuned in one place.
 */

import type { LogEntry, PlayerIdx, RedactedCard, RedactedState } from "../types.js";

export const DURATION = {
  play: 380,
  playFaceDown: 380,
  discard: 280,
  delete: 360,
  flip: 420,
  shift: 340,
  draw: 220,
  return: 360,
  reveal: 320,
  compileBurst: 600,
  recompileDraw: 380,
  controlChange: 240,
  turnStart: 220,
  handTransfer: 260,
  staggerSameType: 60,
  // After the last event in a state_update has fired, hold the queue empty
  // briefly so the next batch doesn't bleed in immediately.
  postBatchSettle: 80,
} as const;

export type FlyAnimation = {
  kind: "fly";
  id: string;
  fromAnchor: string;
  toAnchor: string;
  /** Used if the primary fromAnchor isn't currently in the registry. */
  fallbackFromAnchor?: string;
  /** Used if the primary toAnchor isn't currently in the registry. */
  fallbackToAnchor?: string;
  /** Card render hint: faceDown, cardId for face-up. Either may be null. */
  cardId: string | null;
  faceDown: boolean;
  /** Tone/protocol used for ghost trail color. */
  tone: string;
  /** Delay before this anim starts (ms). */
  delayMs: number;
  durationMs: number;
  /** Optional override of fly easing. */
  easing?: string;
  /** Optional rotate to apply (degrees) so opp ghosts flip 180 like opp board. */
  rotate?: number;
};

export type PulseAnimation = {
  kind: "pulse";
  id: string;
  anchorId: string;
  className: string;
  delayMs: number;
  durationMs: number;
  /** When the anim targets a specific card instance, set this so per-card
   *  renderers can apply the class. */
  instanceId?: string;
};

export type Animation = FlyAnimation | PulseAnimation;

let _animIdCounter = 0;
function nextAnimId(): string {
  _animIdCounter++;
  return `a${_animIdCounter}`;
}

/**
 * Convert a single log event into 0+ animations. `prev` is the state BEFORE
 * this event applied — used for "where did this card come from?" lookups.
 * `next` is the state AFTER.
 */
export function logEventToAnimations(
  ev: LogEntry,
  prev: RedactedState | null,
  next: RedactedState,
  baseDelay = 0,
): Animation[] {
  const type = String(ev.type);
  const out: Animation[] = [];
  const pid = (typeof ev.playerIdx === "number" ? ev.playerIdx : undefined) as PlayerIdx | undefined;
  const cardId = (ev.cardId as string | null | undefined) ?? null;
  const instanceId = ev.instanceId as string | undefined;
  const tone = toneFor(cardId, ev.protocol as string | undefined);

  switch (type) {
    case "play": {
      if (pid === undefined || ev.lineIdx === undefined || !instanceId) break;
      const faceDown = !!ev.faceDown;
      const from = `hand:${instanceId}`;
      const to = `stack:${pid}:${ev.lineIdx}:${instanceId}`;
      const handFallback = `hand-zone:${pid}`;
      out.push({
        kind: "fly",
        id: nextAnimId(),
        fromAnchor: from,
        toAnchor: to,
        fallbackFromAnchor: handFallback,
        cardId: faceDown ? null : cardId,
        faceDown,
        tone,
        delayMs: baseDelay,
        durationMs: faceDown ? DURATION.playFaceDown : DURATION.play,
        rotate: pid === oppViewerIdx(next) ? 180 : 0,
      });
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: to,
        className: "cp-anim-spawn",
        delayMs: baseDelay + (faceDown ? DURATION.playFaceDown : DURATION.play) - 80,
        durationMs: 360,
        instanceId,
      });
      break;
    }

    case "draw": {
      if (pid === undefined) break;
      const count = Math.max(1, Number(ev.count ?? 1));
      for (let i = 0; i < Math.min(count, 5); i++) {
        out.push({
          kind: "fly",
          id: nextAnimId(),
          fromAnchor: `deck:${pid}`,
          toAnchor: `hand-zone:${pid}`,
          cardId: null,
          faceDown: true,
          tone: "dim",
          delayMs: baseDelay + i * DURATION.staggerSameType,
          durationMs: DURATION.draw,
        });
      }
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: `deck:${pid}`,
        className: "cp-anim-resource-pulse",
        delayMs: baseDelay,
        durationMs: 320,
      });
      break;
    }

    case "discard": {
      if (pid === undefined) break;
      const from = instanceId ? `hand:${instanceId}` : `hand-zone:${pid}`;
      out.push({
        kind: "fly",
        id: nextAnimId(),
        fromAnchor: from,
        fallbackFromAnchor: `hand-zone:${pid}`,
        toAnchor: `discard:${pid}`,
        cardId,
        faceDown: false,
        tone,
        delayMs: baseDelay,
        durationMs: DURATION.discard,
      });
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: `discard:${pid}`,
        className: "cp-anim-resource-pulse",
        delayMs: baseDelay + DURATION.discard - 60,
        durationMs: 320,
      });
      break;
    }

    case "delete": {
      const ownerIdx = pid;
      const lineIdx = ev.lineIdx;
      if (ownerIdx === undefined || lineIdx === undefined || !instanceId) break;
      const anchor = `stack:${ownerIdx}:${lineIdx}:${instanceId}`;
      out.push({
        kind: "fly",
        id: nextAnimId(),
        fromAnchor: anchor,
        toAnchor: `discard:${ownerIdx}`,
        cardId: ev.faceDown ? null : cardId,
        faceDown: !!ev.faceDown,
        tone,
        delayMs: baseDelay,
        durationMs: DURATION.delete,
      });
      // Burst on the lane header to anchor the eye to where deletes are happening.
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: `lane-header:${ownerIdx}:${lineIdx}`,
        className: "cp-anim-delete-flicker",
        delayMs: baseDelay,
        durationMs: 220,
      });
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: `discard:${ownerIdx}`,
        className: "cp-anim-resource-pulse",
        delayMs: baseDelay + DURATION.delete - 60,
        durationMs: 320,
      });
      break;
    }

    case "flip": {
      if (!instanceId) break;
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: `stack:any:${instanceId}`,
        className: "cp-anim-flip-3d",
        delayMs: baseDelay,
        durationMs: DURATION.flip,
        instanceId,
      });
      break;
    }

    case "shift": {
      if (!instanceId || ev.fromLineIdx === undefined || ev.toLineIdx === undefined) break;
      const ownerIdx = pid;
      if (ownerIdx === undefined) break;
      const from = `lane-header:${ownerIdx}:${ev.fromLineIdx}`;
      const to = `stack:${ownerIdx}:${ev.toLineIdx}:${instanceId}`;
      out.push({
        kind: "fly",
        id: nextAnimId(),
        fromAnchor: from,
        toAnchor: to,
        fallbackToAnchor: `lane-header:${ownerIdx}:${ev.toLineIdx}`,
        cardId: ev.faceDown ? null : cardId,
        faceDown: !!ev.faceDown,
        tone,
        delayMs: baseDelay,
        durationMs: DURATION.shift,
      });
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: to,
        className: "cp-anim-spawn",
        delayMs: baseDelay + DURATION.shift - 60,
        durationMs: 320,
        instanceId,
      });
      break;
    }

    case "return": {
      const fromOwner = (ev.fromPlayerIdx ?? pid) as PlayerIdx | undefined;
      const toPlayer = (ev.toPlayerIdx ?? pid) as PlayerIdx | undefined;
      if (fromOwner === undefined || toPlayer === undefined || !instanceId) break;
      const from = ev.fromLineIdx !== undefined
        ? `lane-header:${fromOwner}:${ev.fromLineIdx}`
        : `stack:${fromOwner}:any:${instanceId}`;
      out.push({
        kind: "fly",
        id: nextAnimId(),
        fromAnchor: from,
        toAnchor: `hand-zone:${toPlayer}`,
        cardId: ev.faceDown ? null : cardId,
        faceDown: !!ev.faceDown,
        tone,
        delayMs: baseDelay,
        durationMs: DURATION.return,
      });
      break;
    }

    case "reveal": {
      if (!instanceId) break;
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: `stack:any:${instanceId}`,
        className: "cp-anim-reveal",
        delayMs: baseDelay,
        durationMs: DURATION.reveal,
        instanceId,
      });
      break;
    }

    case "protocol-compiled":
    case "protocol-recompiled": {
      if (pid === undefined || ev.lineIdx === undefined) break;
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: `lane-header:${pid}:${ev.lineIdx}`,
        className: "cp-anim-lane-burst",
        delayMs: baseDelay,
        durationMs: DURATION.compileBurst,
      });
      const oppIdx = (1 - pid) as PlayerIdx;
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: `lane-header:${oppIdx}:${ev.lineIdx}`,
        className: "cp-anim-lane-burst",
        delayMs: baseDelay + 60,
        durationMs: DURATION.compileBurst,
      });
      if (type === "protocol-recompiled") {
        // Ghost from opponent's deck → active player's hand.
        out.push({
          kind: "fly",
          id: nextAnimId(),
          fromAnchor: `deck:${oppIdx}`,
          toAnchor: `hand-zone:${pid}`,
          cardId: null,
          faceDown: true,
          tone: tone,
          delayMs: baseDelay + 220,
          durationMs: DURATION.recompileDraw,
        });
      }
      break;
    }

    case "control-gained":
    case "control-released": {
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: "turn-band",
        className: "cp-anim-control-flash",
        delayMs: baseDelay,
        durationMs: DURATION.controlChange,
      });
      break;
    }

    case "turn-started": {
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: "turn-band",
        className: "cp-anim-turn-sweep",
        delayMs: baseDelay,
        durationMs: DURATION.turnStart,
      });
      break;
    }

    case "hand-transfer":
    case "ownership-transfer": {
      const fromIdx = (ev.fromIdx ?? ev.fromPlayerIdx) as PlayerIdx | undefined;
      const toIdx = (ev.toIdx ?? ev.newOwnerIdx ?? ev.toPlayerIdx) as PlayerIdx | undefined;
      if (fromIdx === undefined || toIdx === undefined) break;
      out.push({
        kind: "fly",
        id: nextAnimId(),
        fromAnchor: `hand-zone:${fromIdx}`,
        toAnchor: `hand-zone:${toIdx}`,
        cardId,
        faceDown: true,
        tone,
        delayMs: baseDelay,
        durationMs: DURATION.handTransfer,
      });
      break;
    }

    case "game-over": {
      out.push({
        kind: "pulse",
        id: nextAnimId(),
        anchorId: "turn-band",
        className: "cp-anim-game-over",
        delayMs: baseDelay,
        durationMs: 480,
      });
      break;
    }

    default:
      break;
  }

  // prev is currently unused in this mapper but kept on the signature so we
  // can extend with prevState-derived lookups (uncovered cards, etc.) later.
  void prev;

  return out;
}

/** Resolve color tone for log/fly trails. */
function toneFor(cardId: string | null | undefined, protocol?: string | undefined): string {
  if (cardId) {
    const m = cardId.match(/^([a-z]+)-/);
    if (m) return m[1]!;
  }
  if (protocol) return protocol;
  return "dim";
}

/** When showing both player perspectives merged, both stacks render to the
 *  same lane. The opp side is rotated 180° in the actual board, so play
 *  ghosts targeting opp should also flip. We treat playerIdx 1 as "opp"
 *  on the merged board for visual consistency with how the design lays out. */
function oppViewerIdx(_state: RedactedState): PlayerIdx {
  return 1;
}

type AnimAnchorRect = { left: number; top: number; width: number; height: number; cx: number; cy: number };

/** Resolve fallback anchor if the primary isn't available yet. */
export function resolveAnchors(
  anim: FlyAnimation,
  lookup: (id: string) => AnimAnchorRect | null,
): { from: AnimAnchorRect | null; to: AnimAnchorRect | null } {
  const from = lookup(anim.fromAnchor) ?? (anim.fallbackFromAnchor ? lookup(anim.fallbackFromAnchor) : null);
  const to = lookup(anim.toAnchor) ?? (anim.fallbackToAnchor ? lookup(anim.fallbackToAnchor) : null);
  return { from, to };
}

/** Look up a card's element by id (for tone fallback). */
export function cardElement(card: RedactedCard | null | undefined): string {
  if (!card?.cardId) return "dim";
  const m = card.cardId.match(/^([a-z]+)-/);
  return m ? m[1]! : "dim";
}
