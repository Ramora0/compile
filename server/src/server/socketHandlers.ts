/**
 * Socket.IO event wiring. Translates client events into engine API calls and
 * pushes redacted state updates back. The bound socket carries the
 * authenticated playerId; matches are joined by gameId.
 */

import type { Server, Socket } from "socket.io";
import type { Lobby, Match } from "./lobby.js";
import { redactState } from "./redact.js";
import type { PlayerAction } from "../engine/actions.js";
import type { PromptResponse } from "../engine/ops.js";
import type { PlayerIdx, LineIdx } from "../engine/types.js";
import type { ProtocolName } from "../shared/protocols.js";

interface ClientToServer {
  create_game: () => void;
  join_game: (payload: { gameId: string; playerId: string }) => void;
  draft_pick: (payload: { gameId: string; protocols: ProtocolName[] }) => void;
  submit_action: (payload: { gameId: string; action: PlayerAction }) => void;
  choose_compile_line: (payload: { gameId: string; lineIdx: LineIdx }) => void;
  rearrange_protocols: (payload: {
    gameId: string;
    side: PlayerIdx;
    newOrder: [0|1|2, 0|1|2, 0|1|2];
  }) => void;
  prompt_response: (payload: { gameId: string; response: PromptResponse }) => void;
}

interface SocketData {
  playerId?: string;
}

export interface AttachOptions {
  /** Grace window for reconnect before a slot is released. */
  disconnectGraceMs?: number;
}

export function attachHandlers(io: Server, lobby: Lobby, opts: AttachOptions = {}): void {
  const graceMs = opts.disconnectGraceMs ?? 120_000;

  io.on("connection", (socket: Socket) => {
    const sd = socket.data as SocketData;

    const safe = <T>(fn: () => T): T | void => {
      try {
        return fn();
      } catch (err) {
        socket.emit("error", { message: err instanceof Error ? err.message : String(err) });
      }
    };

    socket.on("create_game", () => {
      safe(() => {
        const match = lobby.create();
        socket.emit("game_created", { gameId: match.id });
      });
    });

    socket.on("join_game", (payload: { gameId: string; playerId: string }) => {
      safe(() => {
        const match = requireMatch(lobby, payload.gameId);
        sd.playerId = payload.playerId;
        const idx = match.attach(payload.playerId, socket.id);
        socket.join(roomName(match));
        socket.emit("joined", { gameId: match.id, playerIdx: idx });
        // Tell the other seat their opponent is back / has joined.
        socket.to(roomName(match)).emit("opponent_status", { playerIdx: idx, online: true });

        if (match.startDraftIfReady()) {
          io.to(roomName(match)).emit("draft_started", {
            youngestPlayerIdx: 0,
            order: [
              { playerIdx: 0, count: 1 },
              { playerIdx: 1, count: 2 },
              { playerIdx: 0, count: 2 },
              { playerIdx: 1, count: 1 },
            ],
            pool: match.draft?.remainingPool ?? [],
          });
          emitDraftPrompt(io, match);
        } else if (match.game) {
          // Reconnect into an in-flight game.
          emitState(io, match);
        }
      });
    });

    socket.on("draft_pick", (payload: { gameId: string; protocols: ProtocolName[] }) => {
      safe(() => {
        const match = requireMatch(lobby, payload.gameId);
        const playerIdx = requirePlayerIdx(match, sd.playerId);
        const completed = match.applyDraftPick(playerIdx, payload.protocols);
        if (completed) {
          io.to(roomName(match)).emit("draft_completed", {});
          emitState(io, match);
          // After draft completion, run the engine into its initial blocked state.
          driveAndEmit(io, match);
        } else {
          io.to(roomName(match)).emit("draft_pick_made", {
            playerIdx,
            protocols: payload.protocols,
            remainingPool: match.draft?.remainingPool ?? [],
          });
          emitDraftPrompt(io, match);
        }
      });
    });

    socket.on("submit_action", (payload: { gameId: string; action: PlayerAction }) => {
      safe(() => {
        const match = requireMatch(lobby, payload.gameId);
        const game = requireGame(match);
        const playerIdx = requirePlayerIdx(match, sd.playerId);
        game.submitAction(playerIdx, payload.action);
        driveAndEmit(io, match);
      });
    });

    socket.on("choose_compile_line", (payload: { gameId: string; lineIdx: LineIdx }) => {
      safe(() => {
        const match = requireMatch(lobby, payload.gameId);
        const game = requireGame(match);
        // Only the active player picks the line; trusting the engine to validate.
        game.chooseCompileLine(payload.lineIdx);
        driveAndEmit(io, match);
      });
    });

    socket.on(
      "rearrange_protocols",
      (payload: {
        gameId: string;
        side: PlayerIdx;
        newOrder: [0|1|2, 0|1|2, 0|1|2];
      }) => {
        safe(() => {
          const match = requireMatch(lobby, payload.gameId);
          const game = requireGame(match);
          game.submitRearrange(payload.side, payload.newOrder);
          driveAndEmit(io, match);
        });
      },
    );

    socket.on("prompt_response", (payload: { gameId: string; response: PromptResponse }) => {
      safe(() => {
        const match = requireMatch(lobby, payload.gameId);
        const game = requireGame(match);
        game.resolvePrompt(payload.response);
        driveAndEmit(io, match);
      });
    });

    socket.on("disconnect", () => {
      for (const m of lobby.matchesForSocket(socket.id)) {
        const idx = m.scheduleDetach(socket.id, graceMs, (expiredIdx) => {
          // Grace elapsed without a reconnect. If the game never started, free
          // the slot so a fresh player can take it; otherwise leave the slot
          // marked offline (the seat stays reserved by playerId).
          if (!m.game) m.releaseSlot(expiredIdx);
        });
        if (idx !== null) {
          io.to(roomName(m)).emit("opponent_status", { playerIdx: idx, online: false });
        }
      }
    });
  });
}

function roomName(match: Match): string {
  return `game:${match.id}`;
}

function requireMatch(lobby: Lobby, gameId: string): Match {
  const m = lobby.get(gameId);
  if (!m) throw new Error(`unknown gameId: ${gameId}`);
  return m;
}

function requireGame(match: Match) {
  if (!match.game) throw new Error("game has not started yet");
  return match.game;
}

function requirePlayerIdx(match: Match, playerId: string | undefined): PlayerIdx {
  if (!playerId) throw new Error("not authenticated — join_game first");
  for (let i = 0; i < 2; i++) {
    if (match.players[i]?.playerId === playerId) return i as PlayerIdx;
  }
  throw new Error("not in this match");
}

function emitDraftPrompt(io: Server, match: Match): void {
  if (!match.draft) return;
  const next = match.draftWhoseTurn();
  if (next === null) return;
  io.to(roomName(match)).emit("draft_prompt", {
    playerIdx: next,
    pickCount: match.draft.picks.length, // 0..3
    remainingPool: match.draft.remainingPool,
  });
}

function emitState(io: Server, match: Match): void {
  if (!match.game) return;
  for (let i = 0; i < 2; i++) {
    const slot = match.players[i];
    if (!slot?.socketId) continue;
    const view = redactState(match.game.state, i as PlayerIdx);
    io.to(slot.socketId).emit("state_update", view);
  }
}

function driveAndEmit(io: Server, match: Match): void {
  if (!match.game) return;
  const blocked = match.game.run();
  emitState(io, match);
  if (blocked.kind === "game-over") {
    io.to(roomName(match)).emit("game_over", { winnerIdx: blocked.winnerIdx });
  }
}

export type { ClientToServer };
