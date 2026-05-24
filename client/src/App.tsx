import { useCallback, useEffect, useRef, useState } from "react";
import { connect, send, type ClientSocket } from "./socket.js";
import type {
  PlayerIdx,
  ProtocolName,
  Question,
  RedactedState,
} from "./types.js";
import { answerForDraftPick } from "./answers.js";
import { BoardScreen } from "./BoardScreen.js";
import { CardDetailPanel, HoverProvider } from "./hover.js";
import { AnchorProvider } from "./ui/anchors.js";

// ────────────────────────────────────────────────────────────
// Persistent identity (per-browser, survives refresh → enables reconnect)
// ────────────────────────────────────────────────────────────

const LS_PLAYER_ID = "compile.playerId";
const LS_LAST_GAME = "compile.lastGame"; // JSON { gameId, playerIdx }

interface LastGame {
  gameId: string;
  playerIdx: PlayerIdx;
}

function loadOrCreatePlayerId(): string {
  try {
    const existing = localStorage.getItem(LS_PLAYER_ID);
    if (existing) return existing;
    const fresh = `p-${crypto.randomUUID()}`;
    localStorage.setItem(LS_PLAYER_ID, fresh);
    return fresh;
  } catch {
    return `p-${Math.random().toString(36).slice(2)}`;
  }
}

function loadLastGame(): LastGame | null {
  try {
    const raw = localStorage.getItem(LS_LAST_GAME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastGame;
    if (typeof parsed.gameId !== "string") return null;
    if (parsed.playerIdx !== 0 && parsed.playerIdx !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLastGame(g: LastGame | null): void {
  try {
    if (g) localStorage.setItem(LS_LAST_GAME, JSON.stringify(g));
    else localStorage.removeItem(LS_LAST_GAME);
  } catch {
    // ignore
  }
}

// ────────────────────────────────────────────────────────────
// App state
// ────────────────────────────────────────────────────────────

type NotifyKind = "error" | "info";
interface Notification {
  id: number;
  message: string;
  kind: NotifyKind;
}
export type NotifyFn = (message: string, kind?: NotifyKind) => void;

type ConnStatus = "connecting" | "connected" | "reconnecting";

interface Session {
  client: ClientSocket;
  /** Game id, known after `game_created` (creator) or chosen by the user (joiner). */
  gameId: string | null;
  /** My seat in the match, set on the `joined` event. */
  myIdx: PlayerIdx | null;
  state: RedactedState | null;
  connStatus: ConnStatus;
}

export function App() {
  const [playerId] = useState<string>(() => loadOrCreatePlayerId());
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notifIdRef = useRef(0);

  const dismissNotification = useCallback((id: number) => {
    setNotifications((cur) => cur.filter((n) => n.id !== id));
  }, []);
  const pushNotification = useCallback<NotifyFn>(
    (message, kind = "error") => {
      const id = ++notifIdRef.current;
      setNotifications((cur) => [...cur, { id, message, kind }]);
      setTimeout(() => dismissNotification(id), 4500);
    },
    [dismissNotification],
  );

  // `forceTick` is used to re-render after we mutate fields on `session.client`
  // (the ClientSocket holds direct refs that React doesn't observe).
  const [, forceTick] = useState(0);
  const tick = useCallback(() => forceTick((n) => n + 1), []);

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const wireSocket = useCallback(
    (s: Session, intent: { kind: "create" } | { kind: "join"; gameId: string }) => {
      const sk = s.client.socket;

      sk.on("connect", () => {
        s.connStatus = "connected";
        const cur = sessionRef.current;
        const knownGameId = cur?.gameId ?? (intent.kind === "join" ? intent.gameId : null);
        if (knownGameId) {
          send.joinGame(s.client, knownGameId);
        } else if (intent.kind === "create") {
          send.createGame(s.client);
        }
        tick();
      });

      sk.on("disconnect", () => {
        s.connStatus = "reconnecting";
        tick();
      });

      sk.on("connect_error", (e) => {
        s.connStatus = "reconnecting";
        pushNotification(`socket connect error: ${e.message}`);
        tick();
      });

      sk.on("error", (p: { message: string }) => {
        setError(p.message);
        pushNotification(p.message);
      });

      sk.on("game_created", (p: { gameId: string }) => {
        s.gameId = p.gameId;
        send.joinGame(s.client, p.gameId);
        tick();
      });

      sk.on("joined", (p: { gameId: string; playerIdx: PlayerIdx }) => {
        s.gameId = p.gameId;
        s.myIdx = p.playerIdx;
        saveLastGame({ gameId: p.gameId, playerIdx: p.playerIdx });
        tick();
      });

      sk.on("state_update", (p: RedactedState) => {
        s.state = p;
        tick();
      });
    },
    [pushNotification, tick],
  );

  const startCreate = useCallback(() => {
    setError(null);
    const client = connect(playerId);
    const s: Session = {
      client,
      gameId: null,
      myIdx: null,
      state: null,
      connStatus: "connecting",
    };
    setSession(s);
    wireSocket(s, { kind: "create" });
  }, [playerId, wireSocket]);

  const startJoin = useCallback(
    (gameId: string) => {
      setError(null);
      const client = connect(playerId);
      const s: Session = {
        client,
        gameId,
        myIdx: null,
        state: null,
        connStatus: "connecting",
      };
      setSession(s);
      wireSocket(s, { kind: "join", gameId });
    },
    [playerId, wireSocket],
  );

  useEffect(() => {
    return () => {
      sessionRef.current?.client.socket.disconnect();
    };
  }, []);

  if (!session) {
    return (
      <HoverProvider>
        <LobbyScreen
          playerId={playerId}
          onCreate={startCreate}
          onJoin={startJoin}
          lastGame={loadLastGame()}
          error={error}
          onDismissError={() => setError(null)}
        />
        <NotificationToasts items={notifications} onDismiss={dismissNotification} />
      </HoverProvider>
    );
  }

  const opponentOnline = session.state?.opponentOnline;

  return (
    <HoverProvider>
      <AnchorProvider>
        <SessionView
          session={session}
          onNotify={pushNotification}
          error={error}
          onDismissError={() => setError(null)}
        />
        <ConnectionBanner status={session.connStatus} />
        {opponentOnline === false && session.myIdx !== null && (
          <OpponentOfflineBanner />
        )}
        <CardDetailPanel />
        <NotificationToasts items={notifications} onDismiss={dismissNotification} />
      </AnchorProvider>
    </HoverProvider>
  );
}

// ────────────────────────────────────────────────────────────
// Session view: routes within an active session based on what's loaded
// ────────────────────────────────────────────────────────────

function SessionView({
  session,
  onNotify,
  error,
  onDismissError,
}: {
  session: Session;
  onNotify: NotifyFn;
  error: string | null;
  onDismissError: () => void;
}) {
  const state = session.state;
  const myIdx = session.myIdx;
  const gameId = session.gameId;

  if (!state || myIdx === null || !gameId) {
    return <Connecting />;
  }

  // No draft and no game yet → we're the creator waiting for an opponent to
  // join. Show the gameId so it can be shared.
  if (!state.draft && state.opponentOnline === null) {
    return <WaitingForOpponentScreen gameId={gameId} />;
  }

  // Active draft: route into the draft picker / opponent-drafting screen.
  if (state.draft) {
    const q = state.pendingQuestion;
    if (q && q.kind === "draft-pick" && q.forPlayerIdx === myIdx) {
      return (
        <DraftScreen
          client={session.client}
          gameId={gameId}
          draft={state.draft}
          question={q}
          error={error}
          onDismissError={onDismissError}
        />
      );
    }
    return <OpponentDraftingScreen pool={state.draft.remainingPool} />;
  }

  // No draft → board (which renders its own overlays for compile-line,
  // rearrange, prompts, game-over).
  return (
    <BoardScreen
      state={state}
      client={session.client}
      myIdx={myIdx}
      gameId={gameId}
      onNotify={onNotify}
    />
  );
}

function Connecting() {
  return (
    <div className="cp-screen">
      <div className="cp-screen-inner">
        <div className="cp-banner">
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.18em" }}>
            CONNECTING…
          </span>
        </div>
      </div>
    </div>
  );
}

function WaitingForOpponentScreen({ gameId }: { gameId: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard?.writeText(gameId).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div className="cp-screen">
      <div className="cp-screen-inner">
        <h1 className="cp-title">COMPILE</h1>
        <p className="cp-subtitle">Share this code with your opponent to start the game.</p>
        <div
          className="cp-banner"
          style={{ flexDirection: "column", alignItems: "flex-start", gap: 12 }}
        >
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: "0.18em", opacity: 0.6 }}
          >
            GAME CODE
          </span>
          <span
            className="mono"
            style={{
              fontSize: 16,
              letterSpacing: "0.08em",
              wordBreak: "break-all",
              userSelect: "all",
            }}
          >
            {gameId}
          </span>
          <button className="cp-btn" onClick={onCopy}>
            {copied ? "COPIED" : "COPY CODE"}
          </button>
        </div>
        <div className="cp-banner">
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.18em" }}>
            WAITING FOR OPPONENT…
          </span>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Lobby
// ────────────────────────────────────────────────────────────

function LobbyScreen({
  playerId,
  onCreate,
  onJoin,
  lastGame,
  error,
  onDismissError,
}: {
  playerId: string;
  onCreate: () => void;
  onJoin: (gameId: string) => void;
  lastGame: LastGame | null;
  error: string | null;
  onDismissError: () => void;
}) {
  const [joinCode, setJoinCode] = useState("");
  const trimmed = joinCode.trim();

  return (
    <div className="cp-screen">
      <div className="cp-screen-inner">
        <div>
          <h1 className="cp-title">COMPILE</h1>
          <p className="cp-subtitle">
            Two-player online card game. Create a game and share the code, or paste a code to
            join.
          </p>
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.18em",
              opacity: 0.55,
              marginTop: 8,
            }}
          >
            YOU: {playerId}
          </div>
        </div>

        {error && (
          <div className="cp-banner error">
            <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em" }}>
              {error}
            </span>
            <button className="cp-btn ghost" onClick={onDismissError}>
              DISMISS
            </button>
          </div>
        )}

        <div className="row gap-3" style={{ flexWrap: "wrap" }}>
          <button className="cp-btn primary" onClick={onCreate}>
            CREATE NEW GAME ▶
          </button>
        </div>

        <div className="row gap-3" style={{ alignItems: "stretch", flexWrap: "wrap" }}>
          <input
            className="cp-input"
            placeholder="paste game code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            style={{
              minWidth: 320,
              padding: "10px 14px",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 13,
              letterSpacing: "0.08em",
              background: "rgba(0,0,0,0.35)",
              color: "inherit",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
            }}
          />
          <button
            className="cp-btn"
            disabled={trimmed.length === 0}
            onClick={() => onJoin(trimmed)}
          >
            JOIN GAME
          </button>
        </div>

        {lastGame && (
          <div
            className="cp-banner"
            style={{ marginTop: 8, gap: 12, alignItems: "center", display: "flex" }}
          >
            <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em" }}>
              RESUME LAST GAME · {lastGame.gameId}
            </span>
            <button className="cp-btn ghost" onClick={() => onJoin(lastGame.gameId)}>
              RECONNECT
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Draft (single perspective)
// ────────────────────────────────────────────────────────────

function DraftScreen({
  client,
  gameId,
  draft,
  question,
  error,
  onDismissError,
}: {
  client: ClientSocket;
  gameId: string;
  draft: NonNullable<RedactedState["draft"]>;
  question: Extract<Question, { kind: "draft-pick" }>;
  error: string | null;
  onDismissError: () => void;
}) {
  const need = question.pickCount;
  const [picked, setPicked] = useState<ProtocolName[]>([]);

  useEffect(() => setPicked([]), [question.questionId]);

  const toggle = (p: ProtocolName) => {
    setPicked((cur) =>
      cur.includes(p) ? cur.filter((x) => x !== p) : cur.length < need ? [...cur, p] : cur,
    );
  };

  const submit = () => {
    if (picked.length !== need) return;
    const answer = answerForDraftPick(question, picked);
    if (!answer) return;
    send.answer(client, gameId, answer);
  };

  const randomize = () => {
    const pool = [...draft.remainingPool];
    const picks: ProtocolName[] = [];
    for (let i = 0; i < need && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(idx, 1)[0]!);
    }
    const answer = answerForDraftPick(question, picks);
    if (answer) send.answer(client, gameId, answer);
  };

  return (
    <div className="cp-screen">
      <div className="cp-screen-inner">
        <div>
          <div
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.24em",
              color: "var(--purple-300)",
              marginBottom: 6,
            }}
          >
            YOUR DRAFT · PICK {draft.picks.length + 1}/4
          </div>
          <h1 className="cp-title" style={{ fontSize: 36 }}>
            Pick {need} protocol{need > 1 ? "s" : ""}
          </h1>
          <p className="cp-subtitle">
            Each pick locks a lane element for the match. Draft order is 1-2-2-1.
          </p>
        </div>

        {error && (
          <div className="cp-banner error">
            <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em" }}>
              {error}
            </span>
            <button className="cp-btn ghost" onClick={onDismissError}>
              DISMISS
            </button>
          </div>
        )}

        <div className="cp-protocol-pool">
          {draft.remainingPool.map((p) => (
            <div
              key={p}
              className={`cp-protocol-pill${picked.includes(p) ? " selected" : ""}`}
              onClick={() => toggle(p)}
            >
              {p}
            </div>
          ))}
        </div>

        <div className="row gap-3">
          <button className="cp-btn primary" disabled={picked.length !== need} onClick={submit}>
            CONFIRM PICK ({picked.length}/{need})
          </button>
          <button className="cp-btn ghost" onClick={randomize} title="Auto-pick at random">
            RANDOMIZE
          </button>
        </div>
      </div>
    </div>
  );
}

function OpponentDraftingScreen({ pool }: { pool: ProtocolName[] }) {
  return (
    <div className="cp-screen">
      <div className="cp-screen-inner">
        <div>
          <div
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.24em",
              color: "var(--purple-300)",
              marginBottom: 6,
            }}
          >
            OPPONENT IS DRAFTING
          </div>
          <h1 className="cp-title" style={{ fontSize: 36 }}>
            Waiting on their pick…
          </h1>
          <p className="cp-subtitle">Remaining protocols in the pool:</p>
        </div>
        <div className="cp-protocol-pool">
          {pool.map((p) => (
            <div key={p} className="cp-protocol-pill" style={{ opacity: 0.55, cursor: "default" }}>
              {p}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Status banners
// ────────────────────────────────────────────────────────────

function ConnectionBanner({ status }: { status: ConnStatus }) {
  if (status === "connected") return null;
  const label = status === "connecting" ? "CONNECTING…" : "RECONNECTING…";
  return (
    <div
      className="mono"
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        fontSize: 11,
        letterSpacing: "0.2em",
        background: "rgba(0,0,0,0.75)",
        color: "#fff",
        padding: "8px 16px",
        borderRadius: 4,
        border: "1px solid rgba(255,255,255,0.15)",
      }}
    >
      ● {label}
    </div>
  );
}

function OpponentOfflineBanner() {
  return (
    <div
      className="mono"
      style={{
        position: "fixed",
        top: 48,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 999,
        fontSize: 11,
        letterSpacing: "0.18em",
        background: "rgba(80, 20, 20, 0.85)",
        color: "#fff",
        padding: "6px 14px",
        borderRadius: 4,
      }}
    >
      ⚠ OPPONENT DISCONNECTED · WAITING FOR RECONNECT
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Toasts
// ────────────────────────────────────────────────────────────

function NotificationToasts({
  items,
  onDismiss,
}: {
  items: Notification[];
  onDismiss: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="cp-toast-stack">
      {items.map((n) => (
        <div key={n.id} className={`cp-toast cp-toast-${n.kind}`}>
          <span className="cp-toast-kind">{n.kind === "error" ? "⚠ ERROR" : "ⓘ INFO"}</span>
          <span className="cp-toast-msg">{n.message}</span>
          <button
            className="cp-toast-close"
            onClick={() => onDismiss(n.id)}
            aria-label="dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
