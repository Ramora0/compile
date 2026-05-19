import { createContext, useContext, useState, type ReactNode } from "react";
import { getCard } from "./cards.js";

interface HoverState {
  hovered: string | null;
  setHovered: (id: string | null) => void;
}

export const HoverCtx = createContext<HoverState>({
  hovered: null,
  setHovered: () => {},
});

export function HoverProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <HoverCtx.Provider value={{ hovered, setHovered }}>
      {children}
    </HoverCtx.Provider>
  );
}

export function CardDetailPanel() {
  const { hovered } = useContext(HoverCtx);
  const card = getCard(hovered);
  if (!card) return null;
  const sections: [string, string][] = [
    ["Top", card.top],
    ["Middle", card.middle],
    ["Bottom", card.bottom],
  ];
  return (
    <div className="cp-card-detail">
      <div className="cp-card-detail-title">{card.title}</div>
      {sections.map(([label, body]) => (
        <div key={label} className="cp-card-detail-section">
          <span className="cp-card-detail-label">{label}</span>
          <span className={body ? "" : "cp-card-detail-empty"}>{body || "—"}</span>
        </div>
      ))}
    </div>
  );
}
