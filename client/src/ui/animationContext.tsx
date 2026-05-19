/**
 * Broadcast the queue snapshot to leaf components (CardStackSlot, ResourceTile,
 * SlimLaneHeader, HandCard, etc.) without prop-drilling.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { AnimationQueueResult } from "./useAnimationQueue.js";

const empty: AnimationQueueResult = {
  activeFly: [],
  cardClasses: new Map(),
  anchorClasses: new Map(),
};

const AnimationCtx = createContext<AnimationQueueResult>(empty);

export function AnimationProvider({
  value,
  children,
}: {
  value: AnimationQueueResult;
  children: ReactNode;
}) {
  return <AnimationCtx.Provider value={value}>{children}</AnimationCtx.Provider>;
}

/** Class string keyed by an instanceId. Empty string if no active classes. */
export function useCardAnimClass(instanceId: string | undefined | null): string {
  const ctx = useContext(AnimationCtx);
  if (!instanceId) return "";
  const set = ctx.cardClasses.get(instanceId);
  if (!set || set.size === 0) return "";
  return Array.from(set).join(" ");
}

/** Class string keyed by an anchorId. Empty string if no active classes. */
export function useAnchorAnimClass(anchorId: string | undefined | null): string {
  const ctx = useContext(AnimationCtx);
  if (!anchorId) return "";
  const set = ctx.anchorClasses.get(anchorId);
  if (!set || set.size === 0) return "";
  return Array.from(set).join(" ");
}

export function useAnimationCtx(): AnimationQueueResult {
  return useContext(AnimationCtx);
}
