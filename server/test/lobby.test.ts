import { describe, expect, it } from "vitest";
import { Lobby, Match } from "../src/server/lobby.js";
import { PROTOCOLS } from "../src/shared/protocols.js";

describe("Match — slot management", () => {
  it("attaches two distinct players to slots 0 and 1 (first-come)", () => {
    const m = new Match();
    expect(m.attach("alice", "sock1")).toBe(0);
    expect(m.attach("bob", "sock2")).toBe(1);
    expect(m.players[0]?.playerId).toBe("alice");
    expect(m.players[1]?.playerId).toBe("bob");
  });

  it("re-attaching the same player updates their socketId without changing slot", () => {
    const m = new Match();
    m.attach("alice", "sock1");
    m.attach("bob", "sock2");
    expect(m.attach("alice", "sock3")).toBe(0);
    expect(m.players[0]?.socketId).toBe("sock3");
  });

  it("rejects a third player", () => {
    const m = new Match();
    m.attach("a", "s1");
    m.attach("b", "s2");
    expect(() => m.attach("c", "s3")).toThrow(/match full/);
  });

  it("detach clears socketId but keeps the slot", () => {
    const m = new Match();
    m.attach("alice", "sock1");
    m.detach("sock1");
    expect(m.players[0]?.playerId).toBe("alice");
    expect(m.players[0]?.socketId).toBeNull();
  });
});

describe("Match — draft lifecycle", () => {
  it("startDraftIfReady requires both slots filled", () => {
    const m = new Match();
    m.attach("alice", "s1");
    expect(m.startDraftIfReady()).toBe(false);
    m.attach("bob", "s2");
    expect(m.startDraftIfReady()).toBe(true);
    expect(m.draft).not.toBeNull();
  });

  it("draft picks follow the 1-2-2-1 order and produce a Game on completion", () => {
    const m = new Match();
    m.attach("a", "s1");
    m.attach("b", "s2");
    m.startDraftIfReady();
    expect(m.draftWhoseTurn()).toBe(0);
    expect(m.applyDraftPick(0, [PROTOCOLS[0]!])).toBe(false);
    expect(m.draftWhoseTurn()).toBe(1);
    expect(m.applyDraftPick(1, [PROTOCOLS[1]!, PROTOCOLS[2]!])).toBe(false);
    expect(m.applyDraftPick(0, [PROTOCOLS[3]!, PROTOCOLS[4]!])).toBe(false);
    expect(m.applyDraftPick(1, [PROTOCOLS[5]!])).toBe(true);
    expect(m.game).not.toBeNull();
    expect(m.draft).toBeNull();
  });

  it("rejects picks from the wrong player", () => {
    const m = new Match();
    m.attach("a", "s1");
    m.attach("b", "s2");
    m.startDraftIfReady();
    expect(() => m.applyDraftPick(1, [PROTOCOLS[0]!])).toThrow(/it is player 0's pick/);
  });

  it("rejects wrong pick count", () => {
    const m = new Match();
    m.attach("a", "s1");
    m.attach("b", "s2");
    m.startDraftIfReady();
    expect(() => m.applyDraftPick(0, [PROTOCOLS[0]!, PROTOCOLS[1]!])).toThrow(/expected 1/);
  });

  it("rejects already-picked protocols", () => {
    const m = new Match();
    m.attach("a", "s1");
    m.attach("b", "s2");
    m.startDraftIfReady();
    m.applyDraftPick(0, [PROTOCOLS[0]!]);
    expect(() => m.applyDraftPick(1, [PROTOCOLS[0]!, PROTOCOLS[1]!])).toThrow(/not in remaining pool/);
  });
});

describe("Lobby", () => {
  it("create() returns a fresh match retrievable by id", () => {
    const lobby = new Lobby();
    const m = lobby.create();
    expect(lobby.get(m.id)).toBe(m);
  });

  it("matchesForSocket returns matches the socket is attached to", () => {
    const lobby = new Lobby();
    const m1 = lobby.create();
    const m2 = lobby.create();
    m1.attach("alice", "sockA");
    m2.attach("bob", "sockB");
    expect(lobby.matchesForSocket("sockA")).toEqual([m1]);
    expect(lobby.matchesForSocket("sockX")).toEqual([]);
  });
});
