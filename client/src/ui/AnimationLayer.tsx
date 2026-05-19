/**
 * Renders the active fly-ghost cards on top of the board. Lives inside
 * `.cp-canvas` so it shares the design-space coordinate system (1920×1200);
 * each ghost is absolutely-positioned via inline CSS variables that the
 * keyframe consumes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "./Card.js";
import { getCard } from "../cards.js";
import { resolveAnchors, type FlyAnimation } from "./animations.js";
import { useAnchorRegistry } from "./anchors.js";

interface GhostInstance {
  anim: FlyAnimation;
  fromCx: number;
  fromCy: number;
  toCx: number;
  toCy: number;
  width: number;
  height: number;
  bornAt: number;
}

export function AnimationLayer({ activeFly }: { activeFly: FlyAnimation[] }) {
  const { get } = useAnchorRegistry();
  const ghostsRef = useRef<Map<string, GhostInstance>>(new Map());
  const [, setTick] = useState(0);

  // Resolve anchors lazily — anims may arrive in the same frame their
  // anchor element mounts, so we look up on render rather than at enqueue
  // time.
  const visible: GhostInstance[] = useMemo(() => {
    const map = ghostsRef.current;
    const liveIds = new Set<string>();
    const out: GhostInstance[] = [];
    for (const anim of activeFly) {
      liveIds.add(anim.id);
      let g = map.get(anim.id);
      if (!g) {
        const { from, to } = resolveAnchors(anim, get);
        if (!from || !to) continue;
        const width = (from.width + to.width) / 2 || 124;
        const height = (from.height + to.height) / 2 || 174;
        g = {
          anim,
          fromCx: from.cx,
          fromCy: from.cy,
          toCx: to.cx,
          toCy: to.cy,
          width,
          height,
          bornAt: Date.now(),
        };
        map.set(anim.id, g);
      }
      out.push(g);
    }
    // Reap ghosts whose anim is no longer active.
    for (const id of Array.from(map.keys())) {
      if (!liveIds.has(id)) map.delete(id);
    }
    return out;
  }, [activeFly, get]);

  // Force a re-render once shortly after mount so anchors registered in the
  // same commit are visible.
  useEffect(() => {
    if (activeFly.length === 0) return;
    let raf1 = requestAnimationFrame(() => setTick((t) => t + 1));
    let raf2 = requestAnimationFrame(() => setTick((t) => t + 1));
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [activeFly]);

  if (visible.length === 0) return null;

  return (
    <div className="cp-anim-layer" aria-hidden="true">
      {visible.map((g) => (
        <Ghost key={g.anim.id} ghost={g} />
      ))}
    </div>
  );
}

function Ghost({ ghost }: { ghost: GhostInstance }) {
  const { anim, fromCx, fromCy, toCx, toCy, width, height } = ghost;
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;
  const info = anim.faceDown || !anim.cardId ? null : getCard(anim.cardId);
  const el = anim.tone && anim.tone !== "dim" ? anim.tone : "void";
  const num = !anim.faceDown && anim.cardId
    ? Number((anim.cardId.match(/-(\d+)$/) ?? [])[1] ?? 0) || undefined
    : undefined;

  const style: React.CSSProperties = {
    position: "absolute",
    left: fromCx - width / 2,
    top: fromCy - height / 2,
    width,
    height,
    ["--cp-ghost-dx" as any]: `${dx}px`,
    ["--cp-ghost-dy" as any]: `${dy}px`,
    ["--cp-ghost-rotate" as any]: `${anim.rotate ?? 0}deg`,
    animationDuration: `${anim.durationMs}ms`,
    animationTimingFunction: anim.easing ?? "cubic-bezier(.25,.8,.35,1)",
  };

  return (
    <div className="cp-ghost-wrap" style={style}>
      <Card
        el={el}
        num={num}
        faceDown={anim.faceDown}
        top={info?.top}
        middle={info?.middle}
        bottom={info?.bottom}
        size="field"
        className="cp-ghost-card"
      />
    </div>
  );
}
