// mulberry32 — small deterministic PRNG. We thread state via GameState.rngCursor
// instead of capturing closures so the entire engine remains JSON-serializable.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure: returns a new array; updates and returns the new cursor too. */
export function shuffle<T>(items: readonly T[], seed: number, cursor: number): { result: T[]; cursor: number } {
  const arr = items.slice();
  let c = cursor;
  for (let i = arr.length - 1; i > 0; i--) {
    const rng = mulberry32(seed + c);
    c++;
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return { result: arr, cursor: c };
}
