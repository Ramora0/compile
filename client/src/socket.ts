import { io, Socket } from "socket.io-client";
import type {
  DraftPromptEv,
  DraftStartedEv,
  PlayerAction,
  PlayerIdx,
  PromptResponse,
  ProtocolName,
  RedactedState,
  LineIdx,
} from "./types.js";

// VITE_SERVER_URL behaviour:
//   unset          → http://localhost:3000 (dev default)
//   explicit URL   → connect to that URL
//   empty string   → connect to the page's own origin (use this when the
//                    server hosts the built client, e.g. a single ngrok tunnel)
const RAW_SERVER_URL = import.meta.env.VITE_SERVER_URL;
const SERVER_URL: string | undefined =
  RAW_SERVER_URL === undefined
    ? "http://localhost:3000"
    : RAW_SERVER_URL === ""
      ? undefined
      : RAW_SERVER_URL;

export interface ClientSocket {
  socket: Socket;
  playerId: string;
  joined: { gameId: string; playerIdx: PlayerIdx } | null;
  state: RedactedState | null;
}

const SOCKET_OPTS = {
  transports: ["websocket" as const],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
};

export function connect(playerId: string): ClientSocket {
  const socket = SERVER_URL ? io(SERVER_URL, SOCKET_OPTS) : io(SOCKET_OPTS);
  return { socket, playerId, joined: null, state: null };
}

// ---- helpers wrapping the documented event names ----

export const send = {
  createGame: (s: ClientSocket) => s.socket.emit("create_game"),
  joinGame: (s: ClientSocket, gameId: string) =>
    s.socket.emit("join_game", { gameId, playerId: s.playerId }),
  draftPick: (s: ClientSocket, gameId: string, protocols: ProtocolName[]) =>
    s.socket.emit("draft_pick", { gameId, protocols }),
  submitAction: (s: ClientSocket, gameId: string, action: PlayerAction) =>
    s.socket.emit("submit_action", { gameId, action }),
  chooseCompileLine: (s: ClientSocket, gameId: string, lineIdx: LineIdx) =>
    s.socket.emit("choose_compile_line", { gameId, lineIdx }),
  rearrangeProtocols: (
    s: ClientSocket,
    gameId: string,
    side: PlayerIdx,
    newOrder: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2],
  ) => s.socket.emit("rearrange_protocols", { gameId, side, newOrder }),
  promptResponse: (s: ClientSocket, gameId: string, response: PromptResponse) =>
    s.socket.emit("prompt_response", { gameId, response }),
};

export type ServerEvents = {
  game_created: (p: { gameId: string }) => void;
  joined: (p: { gameId: string; playerIdx: PlayerIdx }) => void;
  draft_started: (p: DraftStartedEv) => void;
  draft_prompt: (p: DraftPromptEv) => void;
  draft_pick_made: (p: {
    playerIdx: PlayerIdx;
    protocols: ProtocolName[];
    remainingPool: ProtocolName[];
  }) => void;
  draft_completed: (p: Record<string, never>) => void;
  state_update: (p: RedactedState) => void;
  game_over: (p: { winnerIdx: PlayerIdx }) => void;
  opponent_status: (p: { playerIdx: PlayerIdx; online: boolean }) => void;
  error: (p: { message: string }) => void;
};
