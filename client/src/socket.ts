import { io, Socket } from "socket.io-client";
import type {
  Answer,
  PlayerIdx,
  RedactedState,
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
  answer: (s: ClientSocket, gameId: string, answer: Answer) =>
    s.socket.emit("answer", { gameId, answer }),
};

export type ServerEvents = {
  game_created: (p: { gameId: string }) => void;
  joined: (p: { gameId: string; playerIdx: PlayerIdx }) => void;
  state_update: (p: RedactedState) => void;
  error: (p: { message: string }) => void;
};
