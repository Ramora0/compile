import { elClass } from "./elements.js";

export function CompileBar({
  el,
  value,
  max = 10,
  compiled = false,
}: {
  el: string;
  value: number;
  max?: number;
  compiled?: boolean;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className={`cp-bar ${elClass(el)} ${compiled ? "compiled" : ""}`}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}
