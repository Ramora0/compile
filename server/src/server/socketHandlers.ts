/**
 * Socket.IO event wiring. Single client-to-server channel ("answer") and a
 * single server-to-client channel ("state_update"). The redacted state push
 * carries everything the client needs to render — pending question, draft
 * progress, opponent online flag, game-over winner — without side-channel
 * events.
 */

import type { Server, Socket } from "socket.io";
import type { Lobby, Match } from "./lobby.js";
import { redactState } from "./redact.js";
import type { Answer, DraftPickPayload } from "../engine/question.js";
import type { PlayerIdx } from "../engine/types.js";

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
        // Once both seats have a player, kick off the draft.
        match.startDraftIfReady();
        emitState(io, match);
      });
    });

    socket.on("answer", (payload: { gameId: string; answer: Answer }) => {
      safe(() => {
        const match = requireMatch(lobby, payload.gameId);
        const playerIdx = requirePlayerIdx(match, sd.playerId);

        const q = match.currentQuestion();
        if (!q) throw new Error("no pending question");
        if (q.forPlayerIdx !== playerIdx) {
          throw new Error(`question is for player ${q.forPlayerIdx}`);
        }
        if (payload.answer.questionId !== q.questionId) {
          throw new Error(`stale answer: expected ${q.questionId}`);
        }

        if (q.kind === "draft-pick") {
          // Draft answers are routed through the Match (no Game yet).
          if (payload.answer.kind !== "single") {
            throw new Error("draft-pick requires a single-answer");
          }
          const optionId = payload.answer.optionId;
          const opt = q.options.find((o) => o.id === optionId);
          if (!opt) throw new Error(`unknown optionId: ${optionId}`);
          const draftPayload = opt.payload as DraftPickPayload;
          match.applyDraftPick(playerIdx, draftPayload.protocols);
          // If the draft just completed, drive the engine to its first block.
          if (match.game) match.game.run();
        } else {
          if (!match.game) throw new Error("no active game");
          match.game.commit(playerIdx, payload.answer);
        }

        emitState(io, match);
      });
    });

    socket.on("disconnect", () => {
      for (const m of lobby.matchesForSocket(socket.id)) {
        const idx = m.scheduleDetach(socket.id, graceMs, (expiredIdx) => {
          if (!m.game) m.releaseSlot(expiredIdx);
          // Push state again on slot release so the opponent sees the offline flag.
          emitState(io, m);
        });
        if (idx !== null) {
          // Opponent will see online = false via the redacted state push.
          emitState(io, m);
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

function requirePlayerIdx(match: Match, playerId: string | undefined): PlayerIdx {
  if (!playerId) throw new Error("not authenticated — join_game first");
  for (let i = 0; i < 2; i++) {
    if (match.players[i]?.playerId === playerId) return i as PlayerIdx;
  }
  throw new Error("not in this match");
}

function emitState(io: Server, match: Match): void {
  for (let i = 0; i < 2; i++) {
    const slot = match.players[i];
    if (!slot?.socketId) continue;
    const viewer = i as PlayerIdx;
    const oppIdx = (1 - i) as PlayerIdx;
    // null = slot has never been filled (no opponent yet). false = previously
    // joined but currently disconnected. Lets the client distinguish "share
    // your code" from "opponent dropped".
    const opponentOnline = match.players[oppIdx] ? match.online[oppIdx] : null;
    const view = redactState(
      {
        state: match.game?.state ?? null,
        matchQuestion: match.game ? null : match.currentDraftQuestion(),
        draft: match.redactedDraft(),
        opponentOnline,
        matchId: match.id,
      },
      viewer,
    );
    io.to(slot.socketId).emit("state_update", view);
  }
}
