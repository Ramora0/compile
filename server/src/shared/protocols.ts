export const PROTOCOLS = [
  "apathy",
  "darkness",
  "death",
  "fire",
  "gravity",
  "hate",
  "life",
  "light",
  "love",
  "metal",
  "plague",
  "psychic",
  "speed",
  "spirit",
  "water",
] as const;

export type ProtocolName = (typeof PROTOCOLS)[number];

export const isProtocolName = (s: string): s is ProtocolName =>
  (PROTOCOLS as readonly string[]).includes(s);

export type CardValue = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const CARD_VALUES: readonly CardValue[] = [0, 1, 2, 3, 4, 5] as const;

/**
 * Most protocols' decks are values 0..5, but a few replace one of those
 * values with a 6 (e.g. gravity has no 3, has a 6 instead). The card
 * filenames in `cards/<protocol>/` are authoritative.
 */
export const PROTOCOL_VALUES: Record<ProtocolName, readonly CardValue[]> = {
  apathy: [0, 1, 2, 3, 4, 5],
  darkness: [0, 1, 2, 3, 4, 5],
  death: [0, 1, 2, 3, 4, 5],
  fire: [0, 1, 2, 3, 4, 5],
  gravity: [0, 1, 2, 4, 5, 6],
  hate: [0, 1, 2, 3, 4, 5],
  life: [0, 1, 2, 3, 4, 5],
  light: [0, 1, 2, 3, 4, 5],
  love: [1, 2, 3, 4, 5, 6],
  metal: [0, 1, 2, 3, 5, 6],
  plague: [0, 1, 2, 3, 4, 5],
  psychic: [0, 1, 2, 3, 4, 5],
  speed: [0, 1, 2, 3, 4, 5],
  spirit: [0, 1, 2, 3, 4, 5],
  water: [0, 1, 2, 3, 4, 5],
};

export const cardId = (protocol: ProtocolName, value: CardValue): string =>
  `${protocol}-${value}`;
