import { elClass, elGlyph } from "./elements.js";

export function Sigil({ el }: { el: string }) {
  return <span className={`cp-sigil ${elClass(el)}`}>{elGlyph(el)}</span>;
}
