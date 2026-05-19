// Bundle all card descriptions from ../../cards/<protocol>/<value>.md.
// Vite eagerly inlines the file contents at build time so no runtime fs is needed.

const RAW = import.meta.glob<string>("../../cards/*/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface CardInfo {
  cardId: string;       // e.g. "fire-3"
  protocol: string;
  value: number;
  title: string;        // e.g. "Fire 3"
  top: string;
  middle: string;
  bottom: string;
  raw: string;
}

const BY_ID = new Map<string, CardInfo>();

for (const [path, raw] of Object.entries(RAW)) {
  const m = path.match(/cards\/([^/]+)\/(\d+)\.md$/);
  if (!m) continue;
  const protocol = m[1]!;
  const value = Number(m[2]!);
  const cardId = `${protocol}-${value}`;
  BY_ID.set(cardId, parseCard(cardId, protocol, value, raw));
}

export function getCard(cardId: string | null | undefined): CardInfo | null {
  if (!cardId) return null;
  return BY_ID.get(cardId) ?? null;
}

function parseCard(cardId: string, protocol: string, value: number, raw: string): CardInfo {
  const titleLine = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `${protocol} ${value}`;
  const sections = parseSections(raw);
  return {
    cardId,
    protocol,
    value,
    title: titleLine,
    top: sections.Top,
    middle: sections.Middle,
    bottom: sections.Bottom,
    raw,
  };
}

// Walk the markdown line-by-line. Each `**Section:**` opens a section; lines
// that follow (until the next section header) form the body. The first line
// of a section may also contain inline body text after the marker.
function parseSections(raw: string): { Top: string; Middle: string; Bottom: string } {
  const out = { Top: "", Middle: "", Bottom: "" };
  let cur: keyof typeof out | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur) out[cur] = buf.join("\n").trim();
    buf = [];
  };
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*\*\*(Top|Middle|Bottom):\*\*\s*(.*)$/);
    if (m) {
      flush();
      cur = m[1] as keyof typeof out;
      const inline = m[2]!.trim();
      if (inline) buf.push(inline);
    } else if (cur) {
      buf.push(line);
    }
  }
  flush();
  return out;
}
