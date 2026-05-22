import {
  PROTOCOLS,
  PROTOCOL_VALUES,
  cardId,
  type CardValue,
  type ProtocolName,
} from "../shared/protocols.js";
import type {
  CardInstance,
  GameState,
  PlayerIdx,
  PlayerState,
  ProtocolSlot,
  Stack,
} from "./types.js";
import { shuffle } from "./random.js";

export interface DraftPick {
  /** Which player is picking. Matches the index they will hold in the resulting GameState. */
  playerIdx: PlayerIdx;
  protocols: ProtocolName[];
}

/**
 * The 1-2-2-1 draft order from rules.md:16. The youngest player drafts
 * first; they will be playerIdx 0 (and play first).
 */
export const DRAFT_ORDER: readonly { playerIdx: PlayerIdx; count: 1 | 2 }[] = [
  { playerIdx: 0, count: 1 },
  { playerIdx: 1, count: 2 },
  { playerIdx: 0, count: 2 },
  { playerIdx: 1, count: 1 },
] as const;

export interface NewGameOptions {
  gameId: string;
  rngSeed: number;
  playerIds: [string, string];
  /** Picks must follow DRAFT_ORDER. Each pick lists the protocols chosen on that turn. */
  draft: DraftPick[];
}

let instanceCounter = 0;
function nextInstanceId(): string {
  instanceCounter++;
  return `i${instanceCounter}`;
}

/** For tests — reset the monotonic instance counter for stable IDs across runs. */
export function _resetInstanceCounter(): void {
  instanceCounter = 0;
}

function buildDeck(protocols: readonly ProtocolName[], ownerIdx: PlayerIdx): CardInstance[] {
  const deck: CardInstance[] = [];
  for (const protocol of protocols) {
    for (const value of PROTOCOL_VALUES[protocol]) {
      deck.push({
        instanceId: nextInstanceId(),
        cardId: cardId(protocol, value),
        faceDown: false, // hand cards are conceptually face-down to the opponent
        ownerIdx,
      });
    }
  }
  return deck;
}

function emptyStacks(): [[Stack, Stack, Stack], [Stack, Stack, Stack]] {
  return [
    [{ cards: [] }, { cards: [] }, { cards: [] }],
    [{ cards: [] }, { cards: [] }, { cards: [] }],
  ];
}

function makePlayer(
  id: string,
  protocols: readonly ProtocolName[],
  ownerIdx: PlayerIdx,
  rngSeed: number,
  cursor: number,
): { player: PlayerState; cursor: number } {
  const allCards = buildDeck(protocols, ownerIdx);
  const shuffled = shuffle(allCards, rngSeed, cursor);
  const deck = shuffled.result;

  // Opening hand of 5: rules.md:26.
  const hand = deck.splice(deck.length - 5, 5);

  const slots = protocols.map((p): ProtocolSlot => ({ protocol: p, compiled: false }));
  if (slots.length !== 3) throw new Error(`expected 3 protocols, got ${slots.length}`);

  return {
    player: {
      id,
      hand,
      deck,
      trash: [],
      protocols: [slots[0]!, slots[1]!, slots[2]!],
    },
    cursor: shuffled.cursor,
  };
}

/** Validates a completed draft (6 protocols total per player; no overlap; from the pool). */
export function validateDraft(picks: readonly DraftPick[]): {
  perPlayer: [ProtocolName[], ProtocolName[]];
} {
  if (picks.length !== DRAFT_ORDER.length) {
    throw new Error(`expected ${DRAFT_ORDER.length} draft picks, got ${picks.length}`);
  }
  const remainingPool = new Set<ProtocolName>(PROTOCOLS);
  const perPlayer: [ProtocolName[], ProtocolName[]] = [[], []];

  for (let i = 0; i < picks.length; i++) {
    const expected = DRAFT_ORDER[i]!;
    const actual = picks[i]!;
    if (actual.playerIdx !== expected.playerIdx) {
      throw new Error(`pick ${i}: expected player ${expected.playerIdx}, got ${actual.playerIdx}`);
    }
    if (actual.protocols.length !== expected.count) {
      throw new Error(
        `pick ${i}: expected ${expected.count} protocols, got ${actual.protocols.length}`,
      );
    }
    for (const p of actual.protocols) {
      if (!remainingPool.has(p)) {
        throw new Error(`pick ${i}: protocol ${p} not in remaining pool`);
      }
      remainingPool.delete(p);
      perPlayer[actual.playerIdx].push(p);
    }
  }

  if (perPlayer[0].length !== 3 || perPlayer[1].length !== 3) {
    throw new Error("each player must end the draft with exactly 3 protocols");
  }
  return { perPlayer };
}

export function createGame(opts: NewGameOptions): GameState {
  const { perPlayer } = validateDraft(opts.draft);

  const p0 = makePlayer(opts.playerIds[0], perPlayer[0], 0, opts.rngSeed, 0);
  const p1 = makePlayer(opts.playerIds[1], perPlayer[1], 1, opts.rngSeed, p0.cursor);

  return {
    id: opts.gameId,
    rngSeed: opts.rngSeed,
    rngCursor: p1.cursor,
    players: [p0.player, p1.player],
    stacks: emptyStacks(),
    phase: "start",
    activePlayerIdx: 0,
    turnNumber: 1,
    control: "neutral",
    pendingPrompt: null,
    pendingQuestion: null,
    opStack: [],
    overrides: [],
    log: [{ t: 0, type: "game-created", gameId: opts.gameId }],
    winnerIdx: null,
    compiledThisTurn: false,
    compileBans: [0, 0],
  };
}

/**
 * For convenience in early development & tests — produce a deterministic draft
 * picking the first 6 protocols in 1-2-2-1 order.
 */
export function trivialDraft(pool: readonly ProtocolName[] = PROTOCOLS): DraftPick[] {
  if (pool.length < 6) throw new Error("draft pool must have at least 6 protocols");
  const it = pool[Symbol.iterator]();
  const next = (n: number): ProtocolName[] => {
    const out: ProtocolName[] = [];
    for (let i = 0; i < n; i++) {
      const r = it.next();
      if (r.done || r.value === undefined) throw new Error("pool exhausted");
      out.push(r.value as ProtocolName);
    }
    return out;
  };
  return DRAFT_ORDER.map(({ playerIdx, count }) => ({
    playerIdx,
    protocols: next(count),
  }));
}

export type { CardValue };
