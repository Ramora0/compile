// Element / protocol display helpers shared by all board components.

import type { ProtocolName } from "../types.js";

export type ElementId = ProtocolName;

const GLYPH_BY_EL: Record<string, string> = {
  fire: "▲", water: "◇", light: "◯", life: "✚", plague: "※",
  psychic: "◬", metal: "◈", void: "⬢", speed: "⌁", death: "✕",
  spirit: "◊", gravity: "◉",
  apathy: "□", darkness: "●", hate: "☠", love: "♥",
};

export function elGlyph(el: string): string {
  return GLYPH_BY_EL[el] ?? "◆";
}

// `void` collides with the surface tone CSS var `--void`; the element variant
// lives at `--void-el` (and the `.el-void` class redirects to it). For inline
// styling we resolve directly.
export function elCssVar(el: string): string {
  return el === "void" ? "var(--void-el)" : `var(--${el})`;
}

export function elClass(el: string): string {
  return `el-${el}`;
}
