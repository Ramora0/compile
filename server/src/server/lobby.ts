/**
 * Lobby and Match lifecycle. A Match holds either:
 *  - a draft-in-progress (no Game yet), or
 *  - an active Game.
 *
 * Players join by gameId+playerId; sockets attach to their player slot. On
 * disconnect the slot persists for `disconnectGraceMs` so reconnection can
 * resume cleanly.
 */

import { randomUUID } from "node:crypto";
import { Game } from "../engine/game.js";
import { DRAFT_ORDER, createGame, type DraftPick } from "../engine/setup.js";
import { PROTOCOLS, type ProtocolName } from "../shared/protocols.js";

export interface PlayerSlot {
  playerId: string;
  /** Currently-attached socket id; null if disconnected. */
  socketId: string | null;
}

export interface DraftSession {
  picks: DraftPick[];
  remainingPool: ProtocolName[];
  /** Index into DRAFT_ORDER; the next pick belongs to DRAFT_ORDER[step]. */
  step: number;
}

export class Match {
  readonly id: string;
  /** Slot 0 is the youngest / drafts first / plays first. */
  players: [PlayerSlot | null, PlayerSlot | null] = [null, null];
  draft: DraftSession | null = null;
  game: Game | null = null;
  /** Pending grace-period timers keyed by slot index. */
  private graceTimers: Map<0 | 1, NodeJS.Timeout> = new Map();

  constructor(id?: string) {
    this.id = id ?? randomUUID();
  }

  attach(playerId: string, socketId: string): 0 | 1 {
    for (let i = 0; i < 2; i++) {
      const idx = i as 0 | 1;
      if (this.players[idx]?.playerId === playerId) {
        this.players[idx]!.socketId = socketId;
        this.cancelGrace(idx);
        return idx;
      }
    }
    for (let i = 0; i < 2; i++) {
      const idx = i as 0 | 1;
      if (!this.players[idx]) {
        this.players[idx] = { playerId, socketId };
        return idx;
      }
    }
    throw new Error("match full");
  }

  detach(socketId: string): void {
    for (const slot of this.players) {
      if (slot && slot.socketId === socketId) slot.socketId = null;
    }
  }

  /**
   * Mark a socket as gone but keep the slot reserved for `graceMs`. Returns the
   * slot index whose socket just went offline, or null if the socket wasn't
   * attached to this match. The caller supplies `onExpire` to fully release the
   * slot if the grace elapses without a reattach.
   */
  scheduleDetach(
    socketId: string,
    graceMs: number,
    onExpire: (playerIdx: 0 | 1) => void,
  ): 0 | 1 | null {
    for (let i = 0; i < 2; i++) {
      const idx = i as 0 | 1;
      const slot = this.players[idx];
      if (!slot || slot.socketId !== socketId) continue;
      slot.socketId = null;
      this.cancelGrace(idx);
      const timer = setTimeout(() => {
        this.graceTimers.delete(idx);
        const cur = this.players[idx];
        if (cur && cur.socketId === null) onExpire(idx);
      }, graceMs);
      this.graceTimers.set(idx, timer);
      return idx;
    }
    return null;
  }

  /** Forget a slot entirely (called when grace expires). */
  releaseSlot(playerIdx: 0 | 1): void {
    this.players[playerIdx] = null;
    this.cancelGrace(playerIdx);
  }

  private cancelGrace(playerIdx: 0 | 1): void {
    const t = this.graceTimers.get(playerIdx);
    if (t) {
      clearTimeout(t);
      this.graceTimers.delete(playerIdx);
    }
  }

  /** Begin the draft once both slots have players. */
  startDraftIfReady(): boolean {
    if (this.draft || this.game) return false;
    if (!this.players[0] || !this.players[1]) return false;
    this.draft = {
      picks: [],
      remainingPool: PROTOCOLS.filter((p) => p !== "hate" && p !== "apathy" && p !== "love"),
      step: 0,
    };
    return true;
  }

  /** Whose turn it is in the draft, or null if draft isn't active. */
  draftWhoseTurn(): 0 | 1 | null {
    if (!this.draft) return null;
    const expected = DRAFT_ORDER[this.draft.step];
    return expected ? expected.playerIdx : null;
  }

  /** Apply one draft pick. Throws if the pick is invalid. Returns true if draft completed. */
  applyDraftPick(playerIdx: 0 | 1, protocols: readonly ProtocolName[]): boolean {
    if (!this.draft) throw new Error("no draft in progress");
    const expected = DRAFT_ORDER[this.draft.step];
    if (!expected) throw new Error("draft is complete");
    if (expected.playerIdx !== playerIdx) {
      throw new Error(`it is player ${expected.playerIdx}'s pick`);
    }
    if (protocols.length !== expected.count) {
      throw new Error(`expected ${expected.count} protocols, got ${protocols.length}`);
    }
    for (const p of protocols) {
      const idx = this.draft.remainingPool.indexOf(p);
      if (idx < 0) throw new Error(`protocol ${p} not in remaining pool`);
      this.draft.remainingPool.splice(idx, 1);
    }
    this.draft.picks.push({ playerIdx, protocols: protocols.slice() });
    this.draft.step++;
    if (this.draft.step >= DRAFT_ORDER.length) {
      this.completeDraft();
      return true;
    }
    return false;
  }

  private completeDraft(): void {
    if (!this.draft || !this.players[0] || !this.players[1]) {
      throw new Error("cannot complete draft — players or draft missing");
    }
    const picks = this.draft.picks;
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const state = createGame({
      gameId: this.id,
      rngSeed: seed,
      playerIds: [this.players[0].playerId, this.players[1].playerId],
      draft: picks,
    });
    this.game = new Game(state);
    this.draft = null;
  }
}

export class Lobby {
  private readonly matches = new Map<string, Match>();

  create(): Match {
    const m = new Match();
    this.matches.set(m.id, m);
    return m;
  }

  get(id: string): Match | undefined {
    return this.matches.get(id);
  }

  remove(id: string): void {
    this.matches.delete(id);
  }

  /** All matches a socket is currently attached to (typically 0 or 1). */
  matchesForSocket(socketId: string): Match[] {
    return [...this.matches.values()].filter((m) =>
      m.players.some((p) => p?.socketId === socketId),
    );
  }
}
