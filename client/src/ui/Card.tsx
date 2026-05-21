import type { CSSProperties, DragEvent, MouseEvent } from "react";
import { elClass } from "./elements.js";

export interface CardProps {
  el: string;
  num?: number | string;
  faceDown?: boolean;
  /** When face-down: hovering reveals the front via cross-fade. Use for the
   *  local player's own face-down table cards; never set on the opponent's. */
  revealOnHover?: boolean;
  top?: string;
  middle?: string;
  bottom?: string;
  size?: "hand" | "field";
  className?: string;
  style?: CSSProperties;
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: (e: MouseEvent) => void;
}

export function Card({
  el,
  num,
  faceDown,
  revealOnHover,
  top,
  middle,
  bottom,
  size = "hand",
  className = "",
  style,
  draggable,
  onDragStart,
  onDragEnd,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: CardProps) {
  const sizeCls = size === "field" ? "field" : "";
  const handlers = { onMouseEnter, onMouseLeave, onClick, onDragStart, onDragEnd };
  const classes = [
    "cp-card",
    sizeCls,
    elClass(el),
    faceDown ? "has-facedown-cover" : "",
    faceDown && revealOnHover ? "reveal-on-hover" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={style} draggable={draggable} {...handlers}>
      <div className="cp-card-inner">
        <div className="cp-card-head">
          <div className="cp-card-el">{el}</div>
          <div className="cp-card-num">{num ?? ""}</div>
        </div>

        <div className="cp-card-rules">
          <RuleSection body={top} />
          <RuleSection body={middle} accent />
          <RuleSection body={bottom} />
        </div>
      </div>
      {faceDown && (
        <div className="cp-card-facedown-cover" aria-hidden="true">
          <span className="cp-card-facedown-points">2</span>
        </div>
      )}
    </div>
  );
}

function RuleSection({
  body,
  accent,
}: {
  body?: string;
  accent?: boolean;
}) {
  const hasBody = !!body && body.trim().length > 0;
  return (
    <div className={`cp-card-rule${accent ? " accent" : ""}${hasBody ? "" : " empty"}`}>
      <span className="cp-card-rule-body">{hasBody ? body : "—"}</span>
    </div>
  );
}
