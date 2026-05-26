// Standalone animation tester. No server, no socket. Open with `?anim`.
//
// Renders the real BoardScreen against a *fixed* synthetic board, then drives
// the live animation pipeline by appending log events on demand. The board
// itself never changes — only `state.log` grows — which is all `useAnimationQueue`
// needs to fire each animation. Because the board is static, every required
// anchor (stack slots, lane headers, deck/discard tiles, hand zone, turn band)
// is always mounted, so every animation resolves and can be replayed in
// isolation as many times as you like.
//
// Why static: animations key off the log diff, not the board contents. Keeping
// the board frozen means a "play" / "delete" / "draw" can be re-fired forever
// without depleting hands or piling up stacks. The motion you see (fly path,
// flip spin, lane burst, pulse) is identical to in-game; only the surrounding
// bookkeeping (hand count ticking, card actually leaving a stack) is omitted.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoardScreen } from "./BoardScreen.js";
import { CardDetailPanel, HoverProvider } from "./hover.js";
import { AnchorProvider } from "./ui/anchors.js";
import type { ClientSocket } from "./socket.js";
import type {
  LineIdx,
  LogEntry,
  PlayerIdx,
  RedactedCard,
  RedactedPlayer,
  RedactedState,
} from "./types.js";

const STUB_CLIENT = {
  socket: { emit: () => undefined },
  playerId: "anim-tester",
  joined: { gameId: "anim-tester", playerIdx: 0 },
  state: null,
} as unknown as ClientSocket;

// ────────────────────────────────────────────────────────────
// Fixed board. Instance ids are stable so log events can address them.
// ────────────────────────────────────────────────────────────

function c(instanceId: string, cardId: string | null, ownerIdx: PlayerIdx, faceDown = false): RedactedCard {
  return { instanceId, cardId, faceDown, ownerIdx };
}

function makeBaseState(): RedactedState {
  const you: RedactedPlayer = {
    id: "you",
    hand: [
      c("h0", "fire-0", 0),
      c("h1", "speed-3", 0),
      c("h2", "light-5", 0),
      c("h3", "love-2", 0),
    ],
    deck: { count: 8 },
    trash: [c("t0", "death-1", 0), c("t1", "plague-0", 0), c("t2", "hate-3", 0)],
    protocols: [
      { protocol: "fire", compiled: false },
      { protocol: "water", compiled: false },
      { protocol: "death", compiled: false },
    ],
  };
  const opp: RedactedPlayer = {
    id: "opp",
    hand: { count: 4 },
    deck: { count: 8 },
    trash: [c("to0", "love-0", 1), c("to1", "speed-2", 1)],
    protocols: [
      { protocol: "life", compiled: false },
      { protocol: "apathy", compiled: false },
      { protocol: "metal", compiled: false },
    ],
  };

  // stacks[playerIdx][lineIdx]
  const stacks: RedactedCard[][][] = [
    [
      [c("y0a", "fire-1", 0), c("y0b", "fire-3", 0)],
      [c("y1a", "water-2", 0)],
      [c("y2a", "death-4", 0, true)], // your face-down → flip / reveal target
    ],
    [
      [c("o0a", "life-2", 1)],
      [],
      [c("o2a", "metal-1", 1)],
    ],
  ];

  return {
    id: "anim-tester",
    phase: "action",
    activePlayerIdx: 0, // my turn → no waiting overlay, clean board
    turnNumber: 5,
    control: "neutral",
    gameOver: null,
    pendingQuestion: null,
    opponentQuestion: null,
    draft: null,
    opponentOnline: true,
    players: [you, opp],
    stacks,
    lineValues: [
      [4, 2, 0],
      [2, 0, 1],
    ],
    log: [{ t: 1, type: "turn-started", playerIdx: 0, turnNumber: 5 }],
  };
}

// ────────────────────────────────────────────────────────────
// Preset events. Each addresses anchors that exist on the fixed board.
// `entries` are stamped with a monotonic `t` at fire time.
// ────────────────────────────────────────────────────────────

type Entry = Omit<LogEntry, "t">;
interface Preset {
  id: string;
  label: string;
  note?: string;
  entries: Entry[];
}
interface Group {
  title: string;
  presets: Preset[];
}

const L = (n: number) => n as LineIdx;

const GROUPS: Group[] = [
  {
    title: "Play / move",
    presets: [
      {
        id: "play-up",
        label: "Play (you, face-up)",
        note: "fly hand→stack + spawn pulse",
        entries: [{ type: "play", playerIdx: 0, lineIdx: L(0), instanceId: "y0b", cardId: "fire-3", faceDown: false }],
      },
      {
        id: "play-down",
        label: "Play (you, face-down)",
        entries: [{ type: "play", playerIdx: 0, lineIdx: L(1), instanceId: "y1a", cardId: "water-2", faceDown: true }],
      },
      {
        id: "play-opp",
        label: "Play (opponent)",
        note: "ghost rotates 180°",
        entries: [{ type: "play", playerIdx: 1, lineIdx: L(0), instanceId: "o0a", cardId: "life-2", faceDown: false }],
      },
      {
        id: "shift",
        label: "Shift (lane → lane)",
        entries: [{ type: "shift", playerIdx: 0, instanceId: "y1a", fromLineIdx: L(0), toLineIdx: L(1), cardId: "water-2", faceDown: false }],
      },
      {
        id: "return",
        label: "Return to hand",
        entries: [{ type: "return", playerIdx: 0, fromPlayerIdx: 0, toPlayerIdx: 0, fromLineIdx: L(0), instanceId: "y0b", cardId: "fire-3", faceDown: false }],
      },
      {
        id: "hand-transfer",
        label: "Hand transfer (opp→you)",
        entries: [{ type: "hand-transfer", fromIdx: 1, toIdx: 0, cardId: "light-5" }],
      },
    ],
  },
  {
    title: "Resources",
    presets: [
      { id: "draw1", label: "Draw 1 (you)", entries: [{ type: "draw", playerIdx: 0, count: 1 }] },
      { id: "draw3", label: "Draw 3 (you, staggered)", entries: [{ type: "draw", playerIdx: 0, count: 3 }] },
      { id: "draw-opp", label: "Draw 2 (opponent)", entries: [{ type: "draw", playerIdx: 1, count: 2 }] },
      {
        id: "discard",
        label: "Discard (you)",
        note: "fly hand→discard + pulse",
        entries: [{ type: "discard", playerIdx: 0, instanceId: "h0", cardId: "fire-0", faceDown: false }],
      },
      {
        id: "delete-you",
        label: "Delete (your stack)",
        note: "fly→discard + lane flicker",
        entries: [{ type: "delete", playerIdx: 0, lineIdx: L(0), instanceId: "y0b", cardId: "fire-3", faceDown: false }],
      },
      {
        id: "delete-opp",
        label: "Delete (opp stack)",
        entries: [{ type: "delete", playerIdx: 1, lineIdx: L(0), instanceId: "o0a", cardId: "life-2", faceDown: false }],
      },
    ],
  },
  {
    title: "Card state",
    presets: [
      { id: "flip", label: "Flip (3D spin)", entries: [{ type: "flip", instanceId: "y2a", cardId: "death-4" }] },
      { id: "reveal", label: "Reveal (glow ring)", entries: [{ type: "reveal", instanceId: "y2a", cardId: "death-4" }] },
    ],
  },
  {
    title: "Lane / board",
    presets: [
      {
        id: "compile",
        label: "Protocol compiled",
        note: "lane burst, both sides",
        entries: [{ type: "protocol-compiled", playerIdx: 0, lineIdx: L(0), protocol: "fire" }],
      },
      {
        id: "recompile",
        label: "Protocol recompiled",
        note: "burst + draw ghost",
        entries: [{ type: "protocol-recompiled", playerIdx: 0, lineIdx: L(0), protocol: "fire" }],
      },
      { id: "control", label: "Control change (flash)", entries: [{ type: "control-gained", playerIdx: 0 }] },
      { id: "turn", label: "Turn start (sweep)", entries: [{ type: "turn-started", playerIdx: 0, turnNumber: 6 }] },
      { id: "game-over", label: "Game over (flash)", entries: [{ type: "game-over", winnerIdx: 0 }] },
    ],
  },
];

const ALL_PRESETS = GROUPS.flatMap((g) => g.presets);

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export function AnimationTester() {
  const [state, setState] = useState<RedactedState>(makeBaseState);
  const [loopId, setLoopId] = useState<string | null>(null);
  const tRef = useRef(100);

  const fire = useCallback((entries: Entry[]) => {
    setState((s) => {
      const stamped = entries.map((e) => ({ ...e, t: tRef.current++ }) as LogEntry);
      return { ...s, log: [...s.log, ...stamped] };
    });
  }, []);

  const fireRef = useRef(fire);
  fireRef.current = fire;

  const fireAll = useCallback(() => {
    fire(ALL_PRESETS.flatMap((p) => p.entries));
  }, [fire]);

  const reset = useCallback(() => {
    tRef.current = 100;
    setLoopId(null);
    setState(makeBaseState());
  }, []);

  // Loop: re-fire the selected preset on an interval.
  useEffect(() => {
    if (!loopId) return;
    const preset = ALL_PRESETS.find((p) => p.id === loopId);
    if (!preset) return;
    fireRef.current(preset.entries); // fire immediately, then on interval
    const iv = setInterval(() => fireRef.current(preset.entries), 1900);
    return () => clearInterval(iv);
  }, [loopId]);

  const board = useMemo(
    () => (
      <BoardScreen
        state={state}
        client={STUB_CLIENT}
        myIdx={0}
        gameId="anim-tester"
        onNotify={(m) => console.log("[anim notify]", m)}
      />
    ),
    [state],
  );

  return (
    <HoverProvider>
      <AnchorProvider>
        {board}
        <CardDetailPanel />
        <ControlPanel
          loopId={loopId}
          onFire={fire}
          onToggleLoop={(id) => setLoopId((cur) => (cur === id ? null : id))}
          onFireAll={fireAll}
          onReset={reset}
        />
      </AnchorProvider>
    </HoverProvider>
  );
}

// ────────────────────────────────────────────────────────────
// Control panel (fixed, outside the scaled Stage so it stays crisp)
// ────────────────────────────────────────────────────────────

function ControlPanel({
  loopId,
  onFire,
  onToggleLoop,
  onFireAll,
  onReset,
}: {
  loopId: string | null;
  onFire: (entries: Entry[]) => void;
  onToggleLoop: (id: string) => void;
  onFireAll: () => void;
  onReset: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className="mono"
      style={{
        position: "fixed",
        top: 12,
        left: 12,
        zIndex: 100000,
        width: collapsed ? "auto" : 284,
        maxHeight: "calc(100vh - 24px)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        background: "rgba(8, 6, 22, 0.92)",
        border: "1px solid var(--purple-500, #6d46c9)",
        borderRadius: 8,
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        color: "var(--ink, #e8e6ff)",
        fontSize: 12,
        letterSpacing: "0.04em",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.22em", color: "var(--purple-300, #b79bff)" }}>
          🎬 ANIMATION TESTER
        </span>
        <button className="cp-btn ghost" style={btnSm} onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? "▸" : "▾"}
        </button>
      </div>

      {!collapsed && (
        <>
          <p style={{ margin: 0, fontSize: 10, lineHeight: 1.5, color: "var(--ink-faint, #8a86b8)" }}>
            Board is static — buttons append a log event so the real pipeline plays each
            animation in place. Replay freely; nothing depletes.
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="cp-btn primary" style={{ ...btnSm, flex: 1 }} onClick={onFireAll}>
              ▶ FIRE ALL
            </button>
            <button className="cp-btn ghost" style={{ ...btnSm, flex: 1 }} onClick={onReset}>
              ↺ RESET
            </button>
          </div>

          {GROUPS.map((g) => (
            <div key={g.title} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 9, letterSpacing: "0.2em", color: "var(--ink-faint, #8a86b8)", marginTop: 4 }}>
                {g.title.toUpperCase()}
              </span>
              {g.presets.map((p) => {
                const looping = loopId === p.id;
                return (
                  <div key={p.id} style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                    <button
                      className="cp-btn"
                      style={{ ...btnSm, flex: 1, textAlign: "left", justifyContent: "flex-start" }}
                      title={p.note}
                      onClick={() => onFire(p.entries)}
                    >
                      {p.label}
                      {p.note && (
                        <span style={{ display: "block", fontSize: 9, color: "var(--ink-faint, #8a86b8)", letterSpacing: 0 }}>
                          {p.note}
                        </span>
                      )}
                    </button>
                    <button
                      className={`cp-btn ${looping ? "primary" : "ghost"}`}
                      style={{ ...btnSm, width: 34, padding: 0 }}
                      title={looping ? "Stop looping" : "Loop every 1.9s"}
                      onClick={() => onToggleLoop(p.id)}
                    >
                      {looping ? "■" : "↻"}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}

          <a
            href="?preview"
            className="cp-btn ghost"
            style={{ ...btnSm, textAlign: "center", textDecoration: "none", marginTop: 6 }}
          >
            → static board preview
          </a>
        </>
      )}
    </div>
  );
}

const btnSm: React.CSSProperties = {
  fontSize: 11,
  padding: "7px 10px",
  lineHeight: 1.25,
};
