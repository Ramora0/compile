import { _resetInstanceCounter, createGame, trivialDraft } from "../../src/engine/setup.js";
import type { CardInstance, GameState, LineIdx, PlayerIdx } from "../../src/engine/types.js";

export interface HarnessOptions {
  rngSeed?: number;
  playerIds?: [string, string];
}

/** Spin up a deterministic, draft-complete GameState for tests. */
export function newGame(opts: HarnessOptions = {}): GameState {
  _resetInstanceCounter();
  return createGame({
    gameId: "test-game",
    rngSeed: opts.rngSeed ?? 1,
    playerIds: opts.playerIds ?? ["p0", "p1"],
    draft: trivialDraft(),
  });
}

/** Place a synthetic card directly onto a line for testing. Bypasses play validation / triggers. */
export function placeCard(
  state: GameState,
  playerIdx: PlayerIdx,
  lineIdx: LineIdx,
  cardId: string,
  faceDown = false,
): CardInstance {
  const card: CardInstance = {
    instanceId: `t${state.stacks[playerIdx][lineIdx].cards.length}-${playerIdx}-${lineIdx}-${cardId}`,
    cardId,
    faceDown,
    ownerIdx: playerIdx,
  };
  state.stacks[playerIdx][lineIdx].cards.push(card);
  return card;
}
