// Standalone visual preview of the board UI. No server, no socket.
// Open with `?preview` in the URL. Builds a synthetic RedactedState with a
// curated hand and pre-stacked field so card text/sizing can be eyeballed in
// realistic context.

import { useMemo } from "react";
import { BoardScreen } from "./BoardScreen.js";
import { CardDetailPanel, HoverProvider } from "./hover.js";
import { AnchorProvider } from "./ui/anchors.js";
import type {
  ClientSocket,
} from "./socket.js";
import type {
  LineIdx,
  PlayerIdx,
  RedactedCard,
  RedactedPlayer,
  RedactedState,
} from "./types.js";

const STUB_CLIENT = {
  socket: { emit: () => undefined },
  playerId: "preview",
  joined: { gameId: "preview", playerIdx: 0 },
  state: null,
} as unknown as ClientSocket;

let idCounter = 0;
const nextId = (tag: string) => `${tag}-${++idCounter}`;

function card(
  cardId: string | null,
  ownerIdx: PlayerIdx,
  faceDown = false,
): RedactedCard {
  return {
    instanceId: nextId("inst"),
    cardId: faceDown ? null : cardId,
    faceDown,
    ownerIdx,
  };
}

function player(idx: PlayerIdx, protocols: string[], handIds: (string | null)[]): RedactedPlayer {
  return {
    id: idx === 0 ? "preview-you" : "preview-opp",
    hand: handIds.map((cid) => card(cid, idx, cid === null)),
    deckCount: 18,
    trash: [],
    protocols: protocols.map((p) => ({ protocol: p, compiled: false })),
  };
}

function buildState(): RedactedState {
  // Protocols chosen to match the stress-test cards below so a few of them
  // could legally be played face-up if you wanted to drop them on a lane.
  const youProtocols = ["spirit", "life", "apathy"];
  const oppProtocols = ["fire", "love", "gravity"];

  // Stress-test hand — the densest cards in the catalog:
  //   spirit-1  → only card with text in all 3 slots
  //   life-0    → biggest 2-slot card (180 chars)
  //   love-1    → 2-slot, long bottom with conditional draw
  //   apathy-2  → top + bottom, both substantial
  //   speed-2   → single very long top
  //   apathy-0  → single long top
  const youHand: string[] = [
    "spirit-1",
    "life-0",
    "love-1",
    "apathy-2",
    "speed-2",
    "apathy-0",
  ];
  const oppHand: (string | null)[] = ["fire-0", "gravity-0", "love-3"];

  const p0 = player(0, youProtocols, youHand);
  const p1 = player(1, oppProtocols, oppHand);

  // Field stacks loaded with more long-text cards so the stress test covers
  // the field-size render path too (smaller font, tighter padding).
  const stacks: RedactedCard[][][] = [
    [
      // Covered long-text card under another long-text card → exercises both
      // the partly-occluded covered layer and the uncovered top.
      [card("darkness-2", 0), card("life-3", 0)],
      [card("plague-2", 0), card(null, 0, true), card("fire-0", 0)],
      [card("spirit-1", 0)],
    ],
    [
      [card("gravity-0", 1)],
      [card("love-1", 1), card("apathy-2", 1)],
      [card(null, 1, true), card("speed-2", 1)],
    ],
  ];

  return {
    id: "preview",
    phase: "action",
    activePlayerIdx: 0,
    turnNumber: 1,
    control: 0,
    winnerIdx: null,
    pendingPrompt: null,
    players: [p0, p1],
    stacks,
    log: [
      { t: 1, type: "turn-start", turn: 1, playerIdx: 0 },
      { t: 2, type: "play", playerIdx: 0, cardId: "fire-3", lineIdx: 0 as LineIdx, faceDown: false },
      { t: 3, type: "draw", playerIdx: 1, count: 1 },
    ],
  };
}

export function PreviewScreen() {
  const state = useMemo(buildState, []);
  return (
    <HoverProvider>
      <AnchorProvider>
        <BoardScreen
          state={state}
          client={STUB_CLIENT}
          myIdx={0}
          gameId="preview"
          onNotify={(msg) => console.log("[preview notify]", msg)}
        />
        <CardDetailPanel />
      </AnchorProvider>
    </HoverProvider>
  );
}
