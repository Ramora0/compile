import type { CSSProperties, DragEvent, MouseEvent } from "react";
import { elClass } from "./elements.js";

export interface CardProps {
  el: string;
  num?: number | string;
  faceDown?: boolean;
  top?: string;
  middle?: string;
  bottom?: string;
  tier?: "A" | "B";
  line?: number | null;
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
  top,
  middle,
  bottom,
  tier = "B",
  line,
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

  if (faceDown) {
    return (
      <div
        className={`cp-card facedown ${sizeCls} ${className}`}
        style={style}
        draggable={draggable}
        {...handlers}
      />
    );
  }
  return (
    <div
      className={`cp-card ${sizeCls} ${elClass(el)} ${className}`}
      style={style}
      draggable={draggable}
      {...handlers}
    >
      <div className="cp-card-inner">
        <div className="cp-card-head">
          <div className="cp-card-el">{el}</div>
          <div className="cp-card-num">{num ?? ""}</div>
        </div>

        <div className="cp-card-rules">
          <RuleSection label="TOP" body={top} />
          <RuleSection label="MID" body={middle} accent />
          <RuleSection label="BTM" body={bottom} />
        </div>

        <div className="cp-card-foot">
          <span>TIER {tier}</span>
          <span>{line != null ? `→ L${line}` : "PROTOCOL"}</span>
        </div>
      </div>
    </div>
  );
}

function RuleSection({
  label,
  body,
  accent,
}: {
  label: string;
  body?: string;
  accent?: boolean;
}) {
  const hasBody = !!body && body.trim().length > 0;
  return (
    <div className={`cp-card-rule${accent ? " accent" : ""}${hasBody ? "" : " empty"}`}>
      <span className="cp-card-rule-label">{label}</span>
      <span className="cp-card-rule-body">{hasBody ? body : "—"}</span>
    </div>
  );
}
