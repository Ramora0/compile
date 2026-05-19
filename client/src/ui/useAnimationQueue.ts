/**
 * Diff `state.log` against a "last seen" cursor; convert each new event into
 * animations and play them sequentially with stagger so a long compile
 * cascade reads as a sequence rather than a strobe.
 *
 * The hook returns:
 *   - `activeAnims`: fly animations currently on screen (rendered by the layer)
 *   - `inPlaceClasses`: Map<instanceId, Set<className>> driving in-place
 *     pulse classes (flip-3d, spawn, reveal) on existing card slots
 *   - `anchorPulse`: Map<anchorId, Set<className>> for non-card anchors
 *     (lane bursts, deck/discard pulses, turn-band flashes)
 *   - `seenLogIdx`: how far we've consumed (debug)
 *
 * Implementation: the hook keeps a private FIFO queue. When new log entries
 * arrive (state.log grows), we map them to Animation[] and append, computing
 * each anim's start time from the previous tail. A polling RAF loop checks
 * `Date.now()` against each anim's `startAt` / `endAt` and updates render
 * sets accordingly. We use Date.now() rather than RAF deltas so React's
 * commit timing doesn't drift the queue.
 */

import { useEffect, useRef, useState } from "react";
import type { LogEntry, RedactedState } from "../types.js";
import { DURATION, logEventToAnimations, type Animation, type FlyAnimation, type PulseAnimation } from "./animations.js";

interface QueueItem {
  anim: Animation;
  startAt: number;
  endAt: number;
}

export interface AnimationQueueResult {
  activeFly: FlyAnimation[];
  /** className sets keyed by instanceId, applied to that card's DOM node. */
  cardClasses: Map<string, Set<string>>;
  /** className sets keyed by anchorId, applied to that anchor's DOM node. */
  anchorClasses: Map<string, Set<string>>;
}

export function useAnimationQueue(state: RedactedState | null): AnimationQueueResult {
  const seenRef = useRef<number>(state ? state.log.length : 0);
  const initRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  const prevStateRef = useRef<RedactedState | null>(null);
  const tailEndRef = useRef<number>(0);

  const [tick, setTick] = useState(0);

  // Enqueue new events whenever state.log grows.
  useEffect(() => {
    if (!state) return;
    if (!initRef.current) {
      // On first state, don't replay history — just mark everything seen.
      seenRef.current = state.log.length;
      prevStateRef.current = state;
      initRef.current = true;
      return;
    }

    const newCount = state.log.length - seenRef.current;
    if (newCount <= 0) {
      prevStateRef.current = state;
      return;
    }

    const now = Date.now();
    let cursor = Math.max(now, tailEndRef.current);
    const newEvents = state.log.slice(seenRef.current);
    seenRef.current = state.log.length;

    for (const ev of newEvents) {
      const anims = logEventToAnimations(ev, prevStateRef.current, state, 0);
      // Determine batch start (events at the same `t` overlap with stagger;
      // sequentially ordered events go after the previous one ends).
      const batchStart = cursor;
      let batchMaxEnd = batchStart;
      for (const a of anims) {
        const startAt = batchStart + a.delayMs;
        const endAt = startAt + a.durationMs;
        queueRef.current.push({ anim: a, startAt, endAt });
        if (endAt > batchMaxEnd) batchMaxEnd = endAt;
      }
      // Next event starts after this one's max end, minus a small overlap so
      // sequenced animations chain crisply rather than waiting in full.
      cursor = Math.max(cursor, batchMaxEnd - 120);
    }
    tailEndRef.current = cursor + DURATION.postBatchSettle;
    prevStateRef.current = state;
    setTick((t) => t + 1);
  }, [state]);

  // Drive a RAF loop to nudge re-renders while animations are in flight.
  useEffect(() => {
    let raf = 0;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      const now = Date.now();
      // Drop expired items from the head.
      const q = queueRef.current;
      let cleanedHead = false;
      while (q.length > 0 && q[0]!.endAt <= now) {
        q.shift();
        cleanedHead = true;
      }
      // Trigger a render if any item is currently live, or if we just expired one.
      const hasLive = q.some((it) => it.startAt <= now && it.endAt > now);
      if (hasLive || cleanedHead) setTick((t) => (t + 1) | 0);
      if (q.length > 0) {
        raf = requestAnimationFrame(loop);
      } else {
        raf = 0;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [tick]);

  return buildSnapshot(queueRef.current);
}

function buildSnapshot(q: QueueItem[]): AnimationQueueResult {
  const now = Date.now();
  const activeFly: FlyAnimation[] = [];
  const cardClasses = new Map<string, Set<string>>();
  const anchorClasses = new Map<string, Set<string>>();

  for (const it of q) {
    if (it.startAt > now || it.endAt <= now) continue;
    if (it.anim.kind === "fly") {
      activeFly.push(it.anim);
    } else {
      const a = it.anim as PulseAnimation;
      if (a.instanceId) {
        addToMap(cardClasses, a.instanceId, a.className);
      } else {
        addToMap(anchorClasses, a.anchorId, a.className);
      }
    }
  }

  return { activeFly, cardClasses, anchorClasses };
}

function addToMap(m: Map<string, Set<string>>, key: string, value: string): void {
  const cur = m.get(key);
  if (cur) cur.add(value);
  else m.set(key, new Set([value]));
}

/** Diagnostic — list event types currently queued (for debug rendering). */
export function describeQueue(state: RedactedState | null): string {
  if (!state) return "";
  const recent = state.log.slice(-6).map((e: LogEntry) => e.type);
  return recent.join(" › ");
}
