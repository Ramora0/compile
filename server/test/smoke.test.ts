/**
 * End-to-end smoke: boot the Socket.IO server, run two client sockets through
 * draft → first turn, and confirm state propagates with proper redaction.
 *
 * No real cards are registered. The engine must still drive draft + the
 * action phase using synthetic state mutations.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { Server as IoServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { Lobby } from "../src/server/lobby.js";
import { attachHandlers } from "../src/server/socketHandlers.js";
import { PROTOCOLS } from "../src/shared/protocols.js";

interface Bootstrapped {
  http: HttpServer;
  io: IoServer;
  port: number;
  lobby: Lobby;
}

async function bootServer(): Promise<Bootstrapped> {
  const http = createServer();
  const io = new IoServer(http);
  const lobby = new Lobby();
  attachHandlers(io, lobby);
  await new Promise<void>((resolve) => http.listen(0, () => resolve()));
  const addr = http.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return { http, io, port: addr.port, lobby };
}

async function close(b: Bootstrapped): Promise<void> {
  b.io.close();
  await new Promise<void>((resolve) => b.http.close(() => resolve()));
}

function connect(port: number): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
}

function once<T>(sock: ClientSocket, event: string, timeoutMs = 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    sock.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

/**
 * Queue events so we don't race against listener registration order.
 * The queue captures any messages that arrived between event emissions.
 */
function makeQueue(sock: ClientSocket, event: string) {
  const buffer: unknown[] = [];
  const waiters: ((v: unknown) => void)[] = [];
  sock.on(event, (payload: unknown) => {
    const w = waiters.shift();
    if (w) w(payload);
    else buffer.push(payload);
  });
  return {
    next<T>(timeoutMs = 1500): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (buffer.length > 0) {
          resolve(buffer.shift() as T);
          return;
        }
        const t = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
        waiters.push((v) => {
          clearTimeout(t);
          resolve(v as T);
        });
      });
    },
  };
}

let env: Bootstrapped;
let alice: ClientSocket;
let bob: ClientSocket;

beforeEach(async () => {
  env = await bootServer();
  alice = connect(env.port);
  bob = connect(env.port);
  await Promise.all([
    new Promise<void>((r) => alice.once("connect", () => r())),
    new Promise<void>((r) => bob.once("connect", () => r())),
  ]);
});

afterEach(async () => {
  alice.disconnect();
  bob.disconnect();
  await close(env);
});

describe("server smoke", () => {
  it("draft → join → first action round-trips through the wire", async () => {
    // Pre-register queues so no event is missed.
    const aliceState = makeQueue(alice, "state_update");
    const bobState = makeQueue(bob, "state_update");
    const aliceDraftPick = makeQueue(alice, "draft_pick_made");

    // 1. alice creates the game.
    alice.emit("create_game");
    const created = await once<{ gameId: string }>(alice, "game_created");
    expect(created.gameId).toBeTruthy();

    // 2. Alice joins first → slot 0; then Bob → slot 1.
    alice.emit("join_game", { gameId: created.gameId, playerId: "alice" });
    const aliceJoined = await once<{ playerIdx: 0 | 1 }>(alice, "joined");
    expect(aliceJoined.playerIdx).toBe(0);

    const draftStartedP = once<{ youngestPlayerIdx: number }>(alice, "draft_started");
    bob.emit("join_game", { gameId: created.gameId, playerId: "bob" });
    const bobJoined = await once<{ playerIdx: 0 | 1 }>(bob, "joined");
    expect(bobJoined.playerIdx).toBe(1);
    const draftStarted = await draftStartedP;
    expect(draftStarted.youngestPlayerIdx).toBe(0);

    // 3. Run the 1-2-2-1 draft.
    alice.emit("draft_pick", { gameId: created.gameId, protocols: [PROTOCOLS[0]!] });
    await aliceDraftPick.next();
    bob.emit("draft_pick", {
      gameId: created.gameId,
      protocols: [PROTOCOLS[1]!, PROTOCOLS[2]!],
    });
    await aliceDraftPick.next();
    alice.emit("draft_pick", {
      gameId: created.gameId,
      protocols: [PROTOCOLS[3]!, PROTOCOLS[4]!],
    });
    await aliceDraftPick.next();
    bob.emit("draft_pick", {
      gameId: created.gameId,
      protocols: [PROTOCOLS[5]!],
    });
    await once(alice, "draft_completed");

    // 4. After completion, the server emits state_update twice (one from
    // emitState immediately after draft, then driveAndEmit). Read the first.
    const stateA = await aliceState.next<{
      players: { hand: unknown }[];
      activePlayerIdx: number;
      phase: string;
    }>();
    expect(stateA.activePlayerIdx).toBe(0);
    expect(Array.isArray(stateA.players[0]!.hand)).toBe(true);
    expect(stateA.players[1]!.hand).toEqual({ count: 5 });

    // Drain the second post-draft state_update on alice & bob queues.
    await aliceState.next();
    await bobState.next();
    await bobState.next();

    // 5. Alice submits a Refresh action; both clients receive an updated state.
    alice.emit("submit_action", {
      gameId: created.gameId,
      action: { kind: "refresh" },
    });
    const a = await aliceState.next<{ phase: string; activePlayerIdx: number }>();
    const b = await bobState.next<{ phase: string; activePlayerIdx: number }>();
    // After a refresh, the engine runs through check-cache → end → swap → next player's start
    // → check-control → check-compile → action, blocking on action again.
    expect(a.phase).toBe("action");
    expect(b.phase).toBe("action");
    expect(a.activePlayerIdx).toBe(1);
  });
});
