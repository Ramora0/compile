import { useContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  LineIdx,
  LogEntry,
  OpponentQuestionSummary,
  PlayerIdx,
  Question,
  RedactedCard,
  RedactedPlayer,
  RedactedState,
} from "./types.js";
import type { NotifyFn } from "./App.js";
import { getCard } from "./cards.js";
import { promptTargets, type PromptTargets } from "./prompts.js";
import { send, type ClientSocket } from "./socket.js";
import {
  answerForAck,
  answerForChooseCard,
  answerForChooseLine,
  answerForChooseOption,
  answerForCompile,
  answerForDiscard,
  answerForPlay,
  answerForPlayFromHand,
  answerForRearrange,
  answerForRefresh,
  compileLinesFromQuestion,
  playTargetsFromQuestion,
} from "./answers.js";
import { Stage } from "./ui/Stage.js";
import { Card } from "./ui/Card.js";
import { Sigil } from "./ui/Sigil.js";
import { CompileBar } from "./ui/CompileBar.js";
import { elClass, elCssVar } from "./ui/elements.js";
import { HoverCtx } from "./hover.js";
import { useAnchor } from "./ui/anchors.js";
import { useAnimationQueue } from "./ui/useAnimationQueue.js";
import { AnimationLayer } from "./ui/AnimationLayer.js";
import { AnimationProvider, useAnchorAnimClass, useCardAnimClass } from "./ui/animationContext.js";

// ────────────────────────────────────────────────────────────
// Layout constants
// Hand sits on the left as a 2-wide vertical grid; lanes occupy the middle
// full-height; right rail (opp/turn/you) tops the right column with the
// action log docked below it in the bottom-right corner.
// ────────────────────────────────────────────────────────────
const PAD = 48;
const HAND_W = 540;
const RIGHT_W = 320;
const RAIL_GAP = 20;
const TOP_OFFSET = 18;
const BOTTOM_OFFSET = 18;
const RAIL_VERTICAL_GAP = 12;
const LOG_PANEL_H = 260;
const LANES_X = PAD + HAND_W + RAIL_GAP;
const LANES_W = 1920 - PAD * 2 - HAND_W - RIGHT_W - RAIL_GAP * 2;
const LANES_H = 1200 - TOP_OFFSET - BOTTOM_OFFSET;
const HAND_H = 1200 - TOP_OFFSET - BOTTOM_OFFSET;
const RIGHT_RAIL_H = 1200 - TOP_OFFSET - BOTTOM_OFFSET - LOG_PANEL_H - RAIL_VERTICAL_GAP;
const LOG_Y = TOP_OFFSET + RIGHT_RAIL_H + RAIL_VERTICAL_GAP;
const FIELD_COL_W = 140;
const CARD_STACK_SPACING = 88;
const CARD_STACK_SPACING_NARROW = 36;

// Hand grid: 2 columns inside HAND_W with 14px horizontal padding and 14px gap.
// Cards default to 248×352 (aspect 1.4194). Once the hand grows past 6 (>3
// rows), there isn't enough vertical room for default-size cards, so we shrink
// width — height and font sizes follow because the card derives every
// dimension from --cp-card-w (see .cp-card in styles.css).
const HAND_PAD_X = 14;
const HAND_PAD_TOP = 16;
const HAND_PAD_BOTTOM = 18;
const HAND_GRID_GAP = 14;
const HAND_CARD_W_DEFAULT = 248;
const HAND_CARD_ASPECT_H = 1.4194;
const HAND_CARD_W_MIN = 110;

function handCardWidth(count: number): number {
  if (count <= 0) return HAND_CARD_W_DEFAULT;
  const rows = Math.ceil(count / 2);
  const innerW = HAND_W - HAND_PAD_X * 2;
  const innerH = HAND_H - HAND_PAD_TOP - HAND_PAD_BOTTOM;
  const maxByWidth = (innerW - HAND_GRID_GAP) / 2;
  const maxByHeight =
    (innerH - (rows - 1) * HAND_GRID_GAP) / rows / HAND_CARD_ASPECT_H;
  return Math.max(
    HAND_CARD_W_MIN,
    Math.min(HAND_CARD_W_DEFAULT, maxByWidth, maxByHeight),
  );
}

function gapAfterCard(card: RedactedCard): number {
  if (card.faceDown) return CARD_STACK_SPACING_NARROW;
  const top = getCard(card.cardId)?.top?.trim();
  return top ? CARD_STACK_SPACING : CARD_STACK_SPACING_NARROW;
}

function stackOffsets(stack: RedactedCard[]): { offsets: number[]; total: number } {
  const offsets: number[] = [];
  let cum = 0;
  for (let i = 0; i < stack.length; i++) {
    offsets.push(cum);
    if (i < stack.length - 1) cum += gapAfterCard(stack[i]!);
  }
  return { offsets, total: cum };
}

export interface BoardScreenProps {
  state: RedactedState;
  client: ClientSocket;
  myIdx: PlayerIdx;
  gameId: string;
  onNotify: NotifyFn;
}

// Parse "fire-3" → { el: "fire", num: 3 }.
function parseCardId(id: string | null | undefined): { el: string; num: number | undefined } {
  if (!id) return { el: "void", num: undefined };
  const m = id.match(/^([a-z]+)-(\d+)$/);
  if (!m) return { el: "void", num: undefined };
  return { el: m[1]!, num: Number(m[2]!) };
}

function lineValueFor(state: RedactedState, playerIdx: PlayerIdx, lineIdx: LineIdx): number {
  return state.lineValues[playerIdx]?.[lineIdx] ?? 0;
}

function compiledCount(player: RedactedPlayer): number {
  return player.protocols.reduce((n, p) => n + (p.compiled ? 1 : 0), 0);
}

/**
 * Why a play is currently legal. Drives drag-drop UI (hand draggability, lane
 * drop zones, allowed orientation) regardless of whether the underlying play
 * is a primary turn action or a prompt-driven "Play 1 card" effect (Speed 0,
 * Darkness 3).
 *
 * `dispatch` is the only thing the action-phase and prompt cases differ on —
 * action plays go through `submit_action`, prompt plays through `prompt_response`.
 */
type PlayContext = {
  mode: "action" | "prompt";
  allowedLines: ReadonlySet<LineIdx>;
  orientation: "any" | "face-up" | "face-down";
  dispatch: (instanceId: string, lineIdx: LineIdx, faceDown: boolean) => void;
};

/** Wrapper for the central turn-band that exposes itself as the `turn-band`
 *  anchor + applies in-place pulse classes (control-flash, turn-sweep, etc.). */
function TurnBandWrap({ children }: { children: React.ReactNode }) {
  const anchorId = "turn-band";
  const anchorRef = useAnchor(anchorId);
  const animClass = useAnchorAnimClass(anchorId);
  return (
    <div
      ref={anchorRef as React.RefCallback<HTMLDivElement>}
      data-anim-anchor={anchorId}
      className={animClass}
      style={{
        position: "relative",
        margin: "14px 0",
        padding: "16px 18px",
        background:
          "linear-gradient(180deg, rgba(139,92,246,0.10), rgba(139,92,246,0.04)), rgba(13,11,34,0.7)",
        border: "1px solid var(--purple-500)",
        borderRadius: 8,
        boxShadow: "0 0 0 1px rgba(139,92,246,0.25) inset, 0 0 28px rgba(139,92,246,0.2)",
      }}
    >
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Board screen
// ────────────────────────────────────────────────────────────

export function BoardScreen({ state, client, myIdx, gameId, onNotify }: BoardScreenProps) {
  const animQueue = useAnimationQueue(state);
  const youIdx = myIdx;
  const oppIdx = (1 - youIdx) as PlayerIdx;
  const isMyTurn = state.activePlayerIdx === myIdx;

  const [dragInstanceId, setDragInstanceId] = useState<string | null>(null);
  const [pickedDiscards, setPickedDiscards] = useState<string[]>([]);
  const [pendingCard, setPendingCard] = useState<string | null>(null);
  const [pendingLine, setPendingLine] = useState<LineIdx | null>(null);
  const [pendingOption, setPendingOption] = useState<string | null>(null);
  const [logExpanded, setLogExpanded] = useState(false);
  const [pileView, setPileView] = useState<{
    title: string;
    cards: { instanceId: string; cardId: string | null }[];
    emptyText?: string;
  } | null>(null);

  // Clear any stale drag state on turn flip.
  useEffect(() => {
    setDragInstanceId(null);
  }, [state.turnNumber, state.activePlayerIdx]);

  // Clear all pending picks when the outstanding question changes.
  const questionId = state.pendingQuestion?.questionId ?? null;
  useEffect(() => {
    setPickedDiscards([]);
    setPendingCard(null);
    setPendingLine(null);
    setPendingOption(null);
  }, [questionId]);

  const youPlayer = state.players[youIdx];
  const oppPlayer = state.players[oppIdx];
  const youHand = Array.isArray(youPlayer.hand) ? youPlayer.hand : [];
  const oppHand = Array.isArray(oppPlayer.hand) ? oppPlayer.hand : [];

  const youProtocolOrder = youPlayer.protocols.map((p) => p.protocol).join(",");
  const sortedYouHand = useMemo(() => {
    const order = youProtocolOrder.split(",");
    const protoRank = (el: string) => {
      const i = order.indexOf(el);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return youHand.slice().sort((a, b) => {
      const ap = parseCardId(a.cardId);
      const bp = parseCardId(b.cardId);
      const ra = protoRank(ap.el);
      const rb = protoRank(bp.el);
      if (ra !== rb) return ra - rb;
      return (ap.num ?? 0) - (bp.num ?? 0);
    });
  }, [youHand, youProtocolOrder]);

  // canAct: it's the right phase AND the active question is the unrestricted
  // "pick an action" question (action / play / refresh).
  const canAct =
    isMyTurn &&
    state.gameOver === null &&
    state.pendingQuestion?.kind === "action" &&
    state.pendingQuestion?.forPlayerIdx === myIdx;

  const compilable: LineIdx[] = useMemo(() => {
    if (!isMyTurn) return [];
    if (state.pendingQuestion?.kind !== "compile-line") return [];
    if (state.pendingQuestion.forPlayerIdx !== myIdx) return [];
    return compileLinesFromQuestion(state.pendingQuestion);
  }, [state.pendingQuestion, isMyTurn, myIdx]);

  const rearrangeQuestion =
    state.pendingQuestion &&
    state.pendingQuestion.kind === "control-rearrange" &&
    state.pendingQuestion.forPlayerIdx === myIdx
      ? state.pendingQuestion
      : null;

  const draggedCard = dragInstanceId
    ? youHand.find((c) => c.instanceId === dragInstanceId) ?? null
    : null;
  const draggedProtocol = draggedCard ? getCard(draggedCard.cardId)?.protocol ?? null : null;

  // ── question-driven selection ──────────────────────────────────
  // Only surface targets when the question is for me; otherwise the
  // opponent's question would highlight cards on my screen with no way to act.
  const pendingPrompt =
    state.pendingQuestion && state.pendingQuestion.forPlayerIdx === myIdx
      ? state.pendingQuestion
      : null;

  // A `play-from-hand` question borrows the normal play UI (drag-drop with
  // face-up/face-down lane drop zones); the question's options enumerate
  // every legal (card × line × orientation) tuple.
  const playPrompt =
    pendingPrompt && pendingPrompt.kind === "play-from-hand" ? pendingPrompt : null;

  const showHandPrompt =
    pendingPrompt && pendingPrompt.kind === "show-hand" ? pendingPrompt : null;

  const playContext: PlayContext | null = useMemo(() => {
    if (canAct && pendingPrompt) {
      return {
        mode: "action",
        allowedLines: new Set<LineIdx>([0, 1, 2]),
        orientation: "any",
        dispatch: (instanceId, lineIdx, faceDown) => {
          const ans = answerForPlay(pendingPrompt, { instanceId, lineIdx, faceDown });
          if (!ans) {
            onNotify("illegal play", "error");
            return;
          }
          send.answer(client, gameId, ans);
        },
      };
    }
    if (playPrompt) {
      // Derive allowed orientations from the question's enumerated options.
      let hasUp = false;
      let hasDown = false;
      const lines = new Set<LineIdx>();
      for (const opt of playPrompt.options) {
        const p = opt.payload as { instanceId: string; lineIdx: LineIdx; faceDown: boolean };
        lines.add(p.lineIdx);
        if (p.faceDown) hasDown = true;
        else hasUp = true;
      }
      const orientation: "any" | "face-up" | "face-down" =
        hasUp && hasDown ? "any" : hasDown ? "face-down" : "face-up";
      return {
        mode: "prompt",
        allowedLines: lines,
        orientation,
        dispatch: (instanceId, lineIdx, faceDown) => {
          const ans = answerForPlayFromHand(playPrompt, { instanceId, lineIdx, faceDown });
          if (!ans) {
            onNotify("illegal play-from-hand", "error");
            return;
          }
          send.answer(client, gameId, ans);
        },
      };
    }
    return null;
  }, [canAct, pendingPrompt, playPrompt, client, gameId, onNotify]);

  const refresh = () => {
    if (!canAct || !pendingPrompt) return;
    const ans = answerForRefresh(pendingPrompt);
    if (!ans) return;
    send.answer(client, gameId, ans);
  };
  const targets = useMemo<PromptTargets>(
    () => promptTargets(pendingPrompt, state),
    [pendingPrompt, state],
  );

  const handleCardPick = (instanceId: string) => {
    if (!pendingPrompt) return;
    if (!targets.cards.has(instanceId)) return;
    if (pendingPrompt.kind === "choose-card") {
      setPendingCard((cur) => (cur === instanceId ? null : instanceId));
    } else if (pendingPrompt.kind === "discard-selection") {
      const max = pendingPrompt.picks?.max ?? 1;
      setPickedDiscards((cur) => {
        if (cur.includes(instanceId)) return cur.filter((x) => x !== instanceId);
        if (cur.length >= max) {
          return [...cur.slice(1), instanceId];
        }
        return [...cur, instanceId];
      });
    }
  };

  const handleLinePick = (lineIdx: LineIdx) => {
    if (!pendingPrompt || pendingPrompt.kind !== "choose-line") return;
    if (!targets.lines.has(lineIdx)) return;
    setPendingLine((cur) => (cur === lineIdx ? null : lineIdx));
  };

  const handleOptionPick = (optionId: string) => {
    if (!pendingPrompt || pendingPrompt.kind !== "choose-option") return;
    setPendingOption((cur) => (cur === optionId ? null : optionId));
  };

  const confirmPick = () => {
    if (!pendingPrompt) return;
    let ans = null;
    if (pendingPrompt.kind === "choose-card") {
      if (!pendingCard) return;
      ans = answerForChooseCard(pendingPrompt, pendingCard);
    } else if (pendingPrompt.kind === "choose-line") {
      if (pendingLine === null) return;
      ans = answerForChooseLine(pendingPrompt, pendingLine);
    } else if (pendingPrompt.kind === "choose-option") {
      if (!pendingOption) return;
      ans = answerForChooseOption(pendingPrompt, pendingOption);
    } else if (pendingPrompt.kind === "discard-selection") {
      const need = pendingPrompt.picks?.min ?? pickedDiscards.length;
      if (pickedDiscards.length !== need) return;
      ans = answerForDiscard(pendingPrompt, pickedDiscards);
    }
    if (ans) send.answer(client, gameId, ans);
  };

  const skipPrompt = () => {
    if (!pendingPrompt || pendingPrompt.kind !== "choose-card" || !pendingPrompt.optional) return;
    const ans = answerForChooseCard(pendingPrompt, null);
    if (ans) send.answer(client, gameId, ans);
  };

  const ackShowHand = () => {
    if (!showHandPrompt) return;
    const ans = answerForAck(showHandPrompt);
    if (ans) send.answer(client, gameId, ans);
  };

  const pickedSet = useMemo(() => {
    const s = new Set(pickedDiscards);
    if (pendingCard) s.add(pendingCard);
    return s;
  }, [pickedDiscards, pendingCard]);

  return (
    <Stage>
      <AnimationProvider value={animQueue}>
      <LeftRail
        log={state.log}
        onExpand={() => setLogExpanded(true)}
      />

      <LanesGrid
        state={state}
        youIdx={youIdx}
        oppIdx={oppIdx}
        playContext={playContext}
        dragInstanceId={dragInstanceId}
        draggedProtocol={draggedProtocol}
        compilable={compilable}
        onNotify={onNotify}
        targets={targets}
        pickedSet={pickedSet}
        pendingLine={pendingLine}
        onCardPick={handleCardPick}
        onLinePick={handleLinePick}
      />

      <RightRail
        state={state}
        youIdx={youIdx}
        oppIdx={oppIdx}
        youPlayer={youPlayer}
        oppPlayer={oppPlayer}
        oppHandCount={oppHand.length}
        canAct={canAct}
        onRefresh={refresh}
        onViewPile={setPileView}
      />

      <HandStrip
        hand={sortedYouHand}
        canDrag={playContext !== null}
        dragInstanceId={dragInstanceId}
        onDragStart={setDragInstanceId}
        onDragEnd={() => setDragInstanceId(null)}
        targets={targets}
        pickedSet={pickedSet}
        onCardPick={handleCardPick}
        youIdx={youIdx}
      />

      {logExpanded && (
        <LogOverlay log={state.log} onClose={() => setLogExpanded(false)} />
      )}

      {compilable.length > 0 &&
        state.pendingQuestion?.kind === "compile-line" &&
        state.pendingQuestion.forPlayerIdx === myIdx && (
          <CompilePickerOverlay
            state={state}
            client={client}
            gameId={gameId}
            onNotify={onNotify}
            question={state.pendingQuestion}
            lines={compilable}
          />
        )}

      {rearrangeQuestion && (
        <RearrangeOverlay
          client={client}
          gameId={gameId}
          question={rearrangeQuestion}
          onNotify={onNotify}
        />
      )}

      {pendingPrompt && !showHandPrompt && pendingPromptIsBanner(pendingPrompt) && (
        <PromptBanner
          prompt={pendingPrompt}
          targets={targets}
          pickedCount={pickedDiscards.length}
          pendingCard={pendingCard}
          pendingLine={pendingLine}
          pendingOption={pendingOption}
          onOption={handleOptionPick}
          onConfirm={confirmPick}
          onSkip={skipPrompt}
        />
      )}

      {state.gameOver === null &&
        !pendingPrompt &&
        (state.opponentQuestion !== null || !isMyTurn) && (
          <WaitingOverlay
            oppIdx={oppIdx}
            summary={state.opponentQuestion}
            phase={state.phase}
          />
        )}

      {state.gameOver !== null && (
        <GameOverOverlay
          winnerIdx={state.gameOver.winnerIdx}
          players={state.players}
        />
      )}

      {showHandPrompt && (
        <CardListOverlay
          title={`PLAYER ${showHandPrompt.ownerIdx + 1} HAND REVEALED`}
          cards={showHandPrompt.cards}
          onClose={ackShowHand}
        />
      )}

      {pileView && (
        <CardListOverlay
          title={pileView.title}
          cards={pileView.cards}
          onClose={() => setPileView(null)}
          dismissOnBackdrop
          emptyText={pileView.emptyText ?? "EMPTY"}
        />
      )}

      <AnimationLayer activeFly={animQueue.activeFly} />
      </AnimationProvider>
    </Stage>
  );
}

// ────────────────────────────────────────────────────────────
// Waiting overlay (shown when it's the opponent's turn and no prompt is for me)
// ────────────────────────────────────────────────────────────

/**
 * Map a prompt's `reason` code (e.g. "delete", "shift-to", "darkness-3") to
 * a short verb phrase used in "choosing a card to <verb>" / "picking a lane
 * to <verb>". Returns null if the reason doesn't hint at an action, in which
 * case the caller falls back to a generic description.
 */
function reasonVerb(reason: string): string | null {
  if (reason.startsWith("flip")) return "flip";
  if (reason.startsWith("delete")) return "delete";
  if (reason.startsWith("return")) return "return";
  if (reason.startsWith("shift")) return "shift";
  if (reason.startsWith("reveal")) return "reveal";
  return null;
}

/**
 * Human-readable description of what the opponent is currently being asked to
 * do. Used by the wait overlay and the right-rail status label. Falls back to
 * a phase-based label when there is no active prompt for them.
 */
function describeOpponentActivity(
  summary: OpponentQuestionSummary | null,
  phase: RedactedState["phase"],
): string {
  if (summary) {
    switch (summary.kind) {
      case "choose-card": {
        const verb = reasonVerb(summary.reason);
        return verb ? `choosing a card to ${verb}` : "choosing a card";
      }
      case "choose-line": {
        if (summary.reason === "shift-to") return "picking a lane to shift to";
        if (summary.reason.startsWith("swap-protocol")) return "choosing protocols to swap";
        return "choosing a lane";
      }
      case "choose-option":
        return "choosing an option";
      case "discard-selection": {
        const n = summary.count ?? 0;
        const plural = n === 1 ? "" : "s";
        if (summary.reason === "check-cache") {
          return `discarding ${n} card${plural} (over the 5-card limit)`;
        }
        return `discarding ${n} card${plural}`;
      }
      case "play-from-hand":
        return "playing a card from their hand";
      case "show-hand":
        return "reviewing your hand";
    }
  }
  if (phase === "check-compile") return "choosing a line to compile";
  if (phase === "action") return "taking their turn";
  if (phase === "check-cache") return "wrapping up their turn";
  if (phase === "end") return "ending their turn";
  if (phase === "start" || phase === "check-control") return "starting their turn";
  return "thinking";
}

function WaitingOverlay({
  oppIdx,
  summary,
  phase,
}: {
  oppIdx: PlayerIdx;
  summary: OpponentQuestionSummary | null;
  phase: RedactedState["phase"];
}) {
  const label = describeOpponentActivity(summary, phase);
  return (
    <div
      className="mono"
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 900,
        background: "rgba(0,0,0,0.78)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 6,
        padding: "10px 16px",
        color: "#fff",
        fontSize: 11,
        letterSpacing: "0.18em",
        display: "flex",
        alignItems: "center",
        gap: 10,
        pointerEvents: "none",
        maxWidth: 420,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--purple-400, #b693ff)",
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span>
        WAITING ON PLAYER {oppIdx + 1} — {label.toUpperCase()}…
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Lanes
// ────────────────────────────────────────────────────────────

function LanesGrid({
  state,
  youIdx,
  oppIdx,
  playContext,
  dragInstanceId,
  draggedProtocol,
  compilable,
  onNotify,
  targets,
  pickedSet,
  pendingLine,
  onCardPick,
  onLinePick,
}: {
  state: RedactedState;
  youIdx: PlayerIdx;
  oppIdx: PlayerIdx;
  playContext: PlayContext | null;
  dragInstanceId: string | null;
  draggedProtocol: string | null;
  compilable: LineIdx[];
  onNotify: NotifyFn;
  targets: PromptTargets;
  pickedSet: Set<string>;
  pendingLine: LineIdx | null;
  onCardPick: (instanceId: string) => void;
  onLinePick: (lineIdx: LineIdx) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: TOP_OFFSET,
        left: LANES_X,
        width: LANES_W,
        height: LANES_H,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 22,
      }}
    >
      {[0, 1, 2].map((l) => {
        const lineIdx = l as LineIdx;
        return (
          <Lane
            key={l}
            state={state}
            youIdx={youIdx}
            oppIdx={oppIdx}
            lineIdx={lineIdx}
            playContext={playContext}
            dragInstanceId={dragInstanceId}
            draggedProtocol={draggedProtocol}
            compilable={compilable.includes(lineIdx)}
            onNotify={onNotify}
            targets={targets}
            pickedSet={pickedSet}
            isPending={pendingLine === lineIdx}
            onCardPick={onCardPick}
            onLinePick={onLinePick}
          />
        );
      })}
    </div>
  );
}

function Lane({
  state,
  youIdx,
  oppIdx,
  lineIdx,
  playContext,
  dragInstanceId,
  draggedProtocol,
  compilable,
  onNotify,
  targets,
  pickedSet,
  isPending,
  onCardPick,
  onLinePick,
}: {
  state: RedactedState;
  youIdx: PlayerIdx;
  oppIdx: PlayerIdx;
  lineIdx: LineIdx;
  playContext: PlayContext | null;
  dragInstanceId: string | null;
  draggedProtocol: string | null;
  compilable: boolean;
  onNotify: NotifyFn;
  targets: PromptTargets;
  pickedSet: Set<string>;
  isPending: boolean;
  onCardPick: (instanceId: string) => void;
  onLinePick: (lineIdx: LineIdx) => void;
}) {
  const lineIsTarget = targets.lines.has(lineIdx);
  const youSlot = state.players[youIdx].protocols[lineIdx];
  const oppSlot = state.players[oppIdx].protocols[lineIdx];
  const youStack = state.stacks[youIdx]?.[lineIdx] ?? [];
  const oppStack = state.stacks[oppIdx]?.[lineIdx] ?? [];

  const youEl = youSlot?.protocol ?? "void";
  const oppEl = oppSlot?.protocol ?? "void";

  const youCompile = lineValueFor(state, youIdx, lineIdx);
  const oppCompile = lineValueFor(state, oppIdx, lineIdx);

  const youStackOffsets = stackOffsets(youStack);
  const oppStackOffsets = stackOffsets(oppStack);

  const youCompiled = !!youSlot?.compiled;
  const oppCompiled = !!oppSlot?.compiled;

  const laneAllowed = playContext?.allowedLines.has(lineIdx) ?? false;
  const isDragging = playContext !== null && dragInstanceId !== null && laneAllowed;
  const orientation = playContext?.orientation ?? "any";
  const showFaceUpZone = isDragging && orientation !== "face-down";
  const showFaceDownZone = isDragging && orientation !== "face-up";
  // Server-authoritative drop legality: validatePlayCard already encodes
  // protocol-match, play-anywhere overrides (Spirit 1 top), and play-restriction
  // overrides (Apathy etc.). The client just reads the precomputed answer.
  const dragOptions = dragInstanceId
    ? playTargetsFromQuestion(state.pendingQuestion, dragInstanceId)
    : undefined;
  const faceUpLegal = showFaceUpZone && (dragOptions?.faceUpLines.includes(lineIdx) ?? false);
  const faceDownLegal =
    showFaceDownZone && (dragOptions?.faceDownLines.includes(lineIdx) ?? false);
  const laneProtocolLabel = youSlot?.protocol?.toUpperCase() ?? "—";
  const draggedProtocolLabel = draggedProtocol?.toUpperCase() ?? "?";

  return (
    <div
      className={`cp-panel${lineIsTarget ? " is-target" : ""}${isPending ? " is-pending" : ""}`}
      onClick={lineIsTarget ? () => onLinePick(lineIdx) : undefined}
      style={{
        position: "relative",
        height: "100%",
        padding: 0,
        display: "flex",
        flexDirection: "column",
        borderColor: youCompiled || oppCompiled ? "var(--line-3)" : "var(--line-2)",
        overflow: "hidden",
        cursor: lineIsTarget ? "pointer" : undefined,
        ...(compilable
          ? {
              boxShadow:
                "0 0 0 1px var(--purple-400), 0 0 32px rgba(var(--purple-glow), 0.4)",
            }
          : null),
      }}
    >
      {/* OPP HALF — lightly tinted by opp's protocol, glow strongest near the centered headers */}
      <div
        className={elClass(oppEl)}
        style={{
          flex: 1,
          position: "relative",
          background:
            "linear-gradient(0deg, rgba(var(--el-rgb), 0.07), rgba(var(--el-rgb), 0.01) 70%, transparent)",
        }}
      >
        <div
          style={{
            position: "absolute",
            bottom: 18,
            left: "50%",
            transform: "translateX(-50%)",
            width: FIELD_COL_W,
          }}
        >
          {oppStack.map((c, i) => {
            const { el, num } = parseCardId(c.cardId);
            const isTop = i === oppStack.length - 1;
            const selectable = targets.cards.has(c.instanceId);
            // Stack hugs the bottom of opp's half (against the centered
            // headers). Oldest card sits at the top of the visible stack;
            // newest (top of pile) at the bottom — flush with the headers.
            return (
              <CardStackSlot
                key={c.instanceId}
                positionStyle={{ bottom: oppStackOffsets.total - oppStackOffsets.offsets[i]! }}
                isTop={isTop}
                coveredCount={oppStack.length - 1 - i}
                el={el}
                num={num}
                instanceId={c.instanceId}
                cardId={c.cardId}
                faceDown={c.faceDown}
                selectable={selectable}
                selected={pickedSet.has(c.instanceId)}
                onPick={selectable ? onCardPick : undefined}
                playerIdx={oppIdx}
                lineIdx={lineIdx}
                side="opp"
              />
            );
          })}
        </div>
      </div>

      {/* CENTER BAND — both headers back-to-back at the lane's midline, each
          facing its own stack. Both remain right-side-up for the local viewer. */}
      <div
        style={{
          position: "relative",
          flexShrink: 0,
          zIndex: 5,
          background: "var(--void-2)",
        }}
      >
        <SlimLaneHeader
          side="opp"
          el={oppEl}
          value={oppCompile}
          compiled={oppCompiled}
          playerIdx={oppIdx}
          lineIdx={lineIdx}
          centered
        />

        <div
          style={{
            position: "relative",
            height: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 14,
              right: 14,
              top: "50%",
              borderTop: "1px dashed var(--line-3)",
            }}
          />
          <span
            className="mono"
            style={{
              background: "var(--void-2)",
              padding: "1px 10px",
              fontSize: 8,
              letterSpacing: "0.28em",
              color: "var(--ink-faint)",
            }}
          >
            L{lineIdx + 1}
          </span>
        </div>

        <SlimLaneHeader
          side="you"
          el={youEl}
          value={youCompile}
          compiled={youCompiled}
          playerIdx={youIdx}
          lineIdx={lineIdx}
          centered
        />
      </div>

      {/* YOUR HALF — lightly tinted by your protocol, glow strongest near the centered headers */}
      <div
        className={elClass(youEl)}
        style={{
          flex: 1,
          position: "relative",
          background:
            "linear-gradient(180deg, rgba(var(--el-rgb), 0.07), rgba(var(--el-rgb), 0.01) 70%, transparent)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 18,
            left: "50%",
            transform: "translateX(-50%)",
            width: FIELD_COL_W,
          }}
        >
          {youStack.map((c, i) => {
            const { el, num } = parseCardId(c.cardId);
            const isTop = i === youStack.length - 1;
            const selectable = targets.cards.has(c.instanceId);
            // Stack hugs the top of your half (against the centered headers).
            // Oldest card sits at the top of the visible stack — flush with the
            // headers; newest (top of pile) at the bottom of the visible stack.
            return (
              <CardStackSlot
                key={c.instanceId}
                positionStyle={{ top: youStackOffsets.offsets[i] }}
                isTop={isTop}
                coveredCount={youStack.length - 1 - i}
                el={el}
                num={num}
                instanceId={c.instanceId}
                cardId={c.cardId}
                faceDown={c.faceDown}
                selectable={selectable}
                selected={pickedSet.has(c.instanceId)}
                onPick={selectable ? onCardPick : undefined}
                playerIdx={youIdx}
                lineIdx={lineIdx}
                side="you"
              />
            );
          })}
        </div>

        {isDragging && (
          <div className="cp-drop-zones">
            {showFaceUpZone && (
              <PlayDropZone
                legal={faceUpLegal}
                label="PLAY FACE-UP"
                hint={faceUpLegal ? laneProtocolLabel : `NEED ${draggedProtocolLabel}`}
                onAccept={() => {
                  if (dragInstanceId) playContext?.dispatch(dragInstanceId, lineIdx, false);
                }}
                onReject={() =>
                  onNotify(
                    `Can't play face-up in line ${lineIdx + 1}: this card is ${draggedProtocolLabel}, lane is ${laneProtocolLabel}.`,
                    "error",
                  )
                }
              />
            )}
            {showFaceDownZone && (
              <PlayDropZone
                legal={faceDownLegal}
                label="PLAY FACE-DOWN"
                hint={faceDownLegal ? "FACE-DOWN" : "FORBIDDEN HERE"}
                onAccept={() => {
                  if (dragInstanceId) playContext?.dispatch(dragInstanceId, lineIdx, true);
                }}
                onReject={() =>
                  onNotify(
                    `Can't play face-down in line ${lineIdx + 1}: blocked by an active rule.`,
                    "error",
                  )
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayDropZone({
  legal,
  label,
  hint,
  onAccept,
  onReject,
}: {
  legal: boolean;
  label: string;
  hint: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`cp-drop-zone ${legal ? "legal" : "illegal"}${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = legal ? "move" : "none";
        if (!over) setOver(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        const r = e.relatedTarget as Node | null;
        if (r && e.currentTarget.contains(r)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (legal) onAccept();
        else onReject();
      }}
    >
      <span className="cp-drop-zone-label">{label}</span>
      <span className="cp-drop-zone-hint">{hint}</span>
    </div>
  );
}

function CardStackSlot({
  positionStyle,
  isTop,
  coveredCount,
  el,
  num,
  instanceId,
  cardId,
  faceDown,
  selectable,
  selected,
  onPick,
  playerIdx,
  lineIdx,
  side,
}: {
  positionStyle: CSSProperties;
  isTop: boolean;
  /** How many newer cards are stacked on top of this one (0 = uncovered/newest). */
  coveredCount: number;
  el: string;
  num: number | undefined;
  instanceId: string;
  cardId: string | null;
  faceDown: boolean;
  selectable?: boolean;
  selected?: boolean;
  onPick?: (instanceId: string) => void;
  playerIdx: PlayerIdx;
  lineIdx: LineIdx;
  side: "you" | "opp";
}) {
  const { setHovered } = useContext(HoverCtx);
  const info = getCard(cardId);
  // Newer cards (smaller coveredCount) always render on top of older ones —
  // works regardless of whether the stack grows up or down. Selectable covered
  // cards lift above their coverers so they remain clickable.
  const baseZ = 100 - coveredCount;
  const zIndex = selectable ? 500 : baseZ;
  const animClass = useCardAnimClass(instanceId);
  const anchorId = `stack:${playerIdx}:${lineIdx}:${instanceId}`;
  const anchorRef = useAnchor(anchorId);
  const anyAnchorRef = useAnchor(`stack:any:${instanceId}`);
  const classes = ["cp-card-slot", `side-${side}`];
  if (selectable) classes.push("is-selectable");
  if (selected) classes.push("is-selected");
  if (animClass) classes.push(animClass);
  // Only the local player's own face-down cards reveal on hover; the
  // opponent's face-down cards stay secret.
  const revealOnHover = side === "you" && faceDown;
  return (
    <div
      className={classes.join(" ")}
      ref={(el) => { anchorRef(el); anyAnchorRef(el); }}
      data-anim-anchor={anchorId}
      style={{
        position: "absolute",
        left: 0,
        ...positionStyle,
        zIndex,
        filter: isTop || selectable ? "none" : "brightness(0.85)",
        cursor: selectable ? "pointer" : undefined,
      }}
      onClick={(e) => {
        if (!selectable || !onPick) return;
        e.stopPropagation();
        onPick(instanceId);
      }}
    >
      <Card
        el={el}
        num={num}
        faceDown={faceDown}
        revealOnHover={revealOnHover}
        top={info?.top}
        middle={info?.middle}
        bottom={info?.bottom}
        size="field"
        className={`${selectable ? "is-selectable" : ""}${selected ? " is-selected" : ""}`}
        onMouseEnter={() => cardId && setHovered(cardId)}
        onMouseLeave={() => setHovered(null)}
      />
      {/* Tooltip-only data for non-design purposes — instanceId is opaque */}
      <span style={{ display: "none" }}>{instanceId}</span>
    </div>
  );
}

function SlimLaneHeader({
  side,
  el,
  value,
  compiled,
  playerIdx,
  lineIdx,
  centered,
}: {
  side: "you" | "opp";
  el: string;
  value: number;
  compiled: boolean;
  playerIdx: PlayerIdx;
  lineIdx: LineIdx;
  /** When true, the header sits at the lane's midline, with opp's header on
   *  top of the center band and yours below it. Each header's outer border
   *  faces its own stack (top for opp, bottom for you). */
  centered?: boolean;
}) {
  const elColor = elCssVar(el);
  const compiledCls = compiled ? (side === "you" ? "cp-lane-compiled bottom" : "cp-lane-compiled") : "";
  const anchorId = `lane-header:${playerIdx}:${lineIdx}`;
  const anchorRef = useAnchor(anchorId);
  const animClass = useAnchorAnimClass(anchorId);
  const borderColor = `1px solid rgba(var(--el-rgb), ${compiled ? 0.4 : 0.18})`;
  // Centered headers face outward toward their own stack: opp's stack is above,
  // your stack is below. At the lane edges (non-centered), they face inward.
  const showBorderTop = centered ? side === "opp" : side === "you";
  const showBorderBottom = centered ? side === "you" : side === "opp";
  return (
    <div
      ref={anchorRef as React.RefCallback<HTMLDivElement>}
      data-anim-anchor={anchorId}
      className={`${elClass(el)} ${compiledCls} ${animClass}`}
      style={{
        height: 44,
        padding: "0 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: showBorderBottom ? borderColor : "none",
        borderTop: showBorderTop ? borderColor : "none",
        flexShrink: 0,
      }}
    >
      <div className="row gap-2 middle" style={{ alignItems: "center", minWidth: 110 }}>
        <Sigil el={el} />
        <span
          className="mono"
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.18em",
            color: elColor,
          }}
        >
          {el.toUpperCase()}
        </span>
      </div>

      <div style={{ flex: 1 }}>
        <CompileBar el={el} value={Math.min(10, value)} compiled={compiled} />
      </div>

      <span
        className="mono"
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: elColor,
          minWidth: 48,
          textAlign: "right",
        }}
      >
        {value}
        <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>/10</span>
      </span>

      {compiled && (
        <span
          className="mono"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.2em",
            color: elColor,
            padding: "3px 8px",
            border: `1px solid ${elColor}`,
            borderRadius: 4,
            background: "rgba(var(--el-rgb), 0.12)",
            whiteSpace: "nowrap",
          }}
        >
          ✓ COMPILED
        </span>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Left rail — action log
// ────────────────────────────────────────────────────────────

function cardLabel(cardId: string | null | undefined): string {
  if (!cardId) return "card";
  return cardId.toUpperCase();
}

function formatLogEntry(ev: LogEntry): {
  who: string;
  txt: string;
  tone: string;
  bold: boolean;
} {
  const type = String(ev.type);
  const playerIdx = typeof ev.playerIdx === "number" ? (ev.playerIdx as 0 | 1) : null;
  const who = playerIdx === 0 ? "P1" : playerIdx === 1 ? "P2" : "·";
  let tone: string = "dim";
  let bold = false;
  let txt = type;

  const cardId = typeof ev.cardId === "string" ? ev.cardId : null;
  const lineIdx = typeof ev.lineIdx === "number" ? ev.lineIdx : null;
  const fromLineIdx = typeof ev.fromLineIdx === "number" ? ev.fromLineIdx : null;
  const toLineIdx = typeof ev.toLineIdx === "number" ? ev.toLineIdx : null;
  const toPlayerIdx = typeof ev.toPlayerIdx === "number" ? ev.toPlayerIdx : null;

  if (cardId) {
    tone = parseCardId(cardId).el;
  } else if (typeof ev.protocol === "string") {
    tone = ev.protocol;
  }

  switch (type) {
    case "play":
      if (ev.faceDown) {
        txt = `played face-down → L${lineIdx != null ? lineIdx + 1 : "?"}`;
        tone = "dim";
      } else {
        txt = `played ${cardLabel(cardId)} → L${lineIdx != null ? lineIdx + 1 : "?"}`;
      }
      break;
    case "play-facedown":
      txt = `played face-down → L${lineIdx != null ? lineIdx + 1 : "?"}`;
      tone = "dim";
      break;
    case "draw":
      txt = `drew ${typeof ev.count === "number" ? ev.count : 1}`;
      tone = "dim";
      break;
    case "discard":
      txt = `discarded ${cardLabel(cardId)}`;
      break;
    case "delete": {
      const cause = typeof ev.cause === "string" ? ev.cause : "effect";
      const fdHint = ev.faceDown ? " (face-down)" : "";
      const fromLane = lineIdx != null ? ` from L${lineIdx + 1}` : "";
      txt = `deleted ${cardLabel(cardId)}${fdHint}${fromLane} · ${cause}`;
      break;
    }
    case "flip": {
      const dir = ev.nowFaceDown ? "→ face-down" : "→ face-up";
      txt = `flipped ${cardLabel(cardId)} ${dir}${lineIdx != null ? ` on L${lineIdx + 1}` : ""}`;
      break;
    }
    case "shift":
      txt = `shifted ${cardLabel(cardId)} L${fromLineIdx != null ? fromLineIdx + 1 : "?"} → L${toLineIdx != null ? toLineIdx + 1 : "?"}`;
      break;
    case "return": {
      const dest = toPlayerIdx === 0 ? "P1 hand" : toPlayerIdx === 1 ? "P2 hand" : "hand";
      txt = `returned ${cardLabel(cardId)} → ${dest}`;
      break;
    }
    case "reveal":
      txt = `revealed ${cardLabel(typeof ev.revealedCardId === "string" ? ev.revealedCardId : cardId)}${
        toPlayerIdx != null ? ` to P${toPlayerIdx + 1}` : ""
      }`;
      tone = "light";
      break;
    case "refresh":
      txt = "refresh hand";
      tone = "dim";
      break;
    case "compile":
      txt = `compile ${typeof ev.protocol === "string" ? ev.protocol.toUpperCase() : ""}${
        lineIdx != null ? ` → L${lineIdx + 1}` : ""
      }`;
      bold = true;
      break;
    case "protocol-compiled":
      txt = `COMPILED ${typeof ev.protocol === "string" ? ev.protocol.toUpperCase() : "?"}${
        lineIdx != null ? ` (L${lineIdx + 1})` : ""
      }`;
      bold = true;
      break;
    case "protocol-recompiled":
      txt = `RECOMPILED ${typeof ev.protocol === "string" ? ev.protocol.toUpperCase() : "?"}${
        lineIdx != null ? ` (L${lineIdx + 1})` : ""
      } — drew 1`;
      bold = true;
      break;
    case "control":
    case "control-gained":
      txt = "took control";
      tone = "psychic";
      bold = true;
      break;
    case "control-released":
      txt = "released control";
      tone = "psychic";
      break;
    case "turn-start":
    case "turn-started": {
      const turn = typeof ev.turn === "number" ? ev.turn : typeof ev.turnNumber === "number" ? ev.turnNumber : null;
      txt = `turn ${turn ?? "?"}`;
      tone = "dim";
      break;
    }
    case "phase-changed":
      txt = `phase ${String(ev.from ?? "?")} → ${String(ev.to ?? "?")}`;
      tone = "dim";
      break;
    case "prompt-issued": {
      const kind = typeof ev.kind === "string" ? ev.kind : "prompt";
      txt = `prompt: ${kind}`;
      tone = "psychic";
      break;
    }
    case "hand-transfer": {
      const f = typeof ev.fromIdx === "number" ? ev.fromIdx : null;
      const t = typeof ev.toIdx === "number" ? ev.toIdx : null;
      txt = `hand-transfer P${(f ?? 0) + 1} → P${(t ?? 0) + 1}`;
      tone = "psychic";
      break;
    }
    case "ownership-transfer": {
      const n = typeof ev.newOwnerIdx === "number" ? ev.newOwnerIdx : null;
      txt = `ownership of ${cardLabel(cardId)} → P${(n ?? 0) + 1}`;
      tone = "psychic";
      break;
    }
    case "protocols-rearranged": {
      const side = typeof ev.side === "number" ? `P${ev.side + 1}` : "?";
      const order = Array.isArray(ev.newOrder) ? (ev.newOrder as number[]).map((n) => n + 1).join(",") : "?";
      txt = `rearranged ${side} protocols → [${order}]`;
      tone = "psychic";
      break;
    }
    case "game-over":
      txt = `GAME OVER — P${(typeof ev.winnerIdx === "number" ? ev.winnerIdx : 0) + 1} wins`;
      tone = "psychic";
      bold = true;
      break;
    default:
      txt = type;
      break;
  }

  return { who, txt, tone, bold };
}

function toneColor(tone: string): string {
  if (tone === "dim") return "var(--ink-faint)";
  return elCssVar(tone);
}

/** Phase changes flood the log every turn; hide them from the preview rail. */
const PREVIEW_HIDE_TYPES = new Set([
  "phase-changed",
  "prompt-issued",
]);

function isInterestingForPreview(ev: LogEntry): boolean {
  return !PREVIEW_HIDE_TYPES.has(String(ev.type));
}

function LeftRail({
  log,
  onExpand,
}: {
  log: RedactedState["log"];
  onExpand: () => void;
}) {
  // Newest first; hide noisy phase/prompt events from the preview pane —
  // the full log overlay still shows everything.
  const filteredWithIdx = log
    .map((ev, idx) => ({ ev, idx }))
    .filter((x) => isInterestingForPreview(x.ev as LogEntry));
  const recent = filteredWithIdx.slice().reverse().slice(0, 4);
  return (
    <div
      className="cp-panel"
      style={{
        position: "absolute",
        right: PAD,
        top: LOG_Y,
        width: RIGHT_W,
        height: LOG_PANEL_H,
        padding: 16,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className="row between middle" style={{ alignItems: "center", marginBottom: 10 }}>
        <span className="cp-panel-title">Action Log</span>
        <button
          className="cp-btn ghost"
          style={{ padding: "4px 10px", fontSize: 9 }}
          onClick={onExpand}
          disabled={log.length === 0}
        >
          EXPAND ⇗
        </button>
      </div>

      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            maskImage: "linear-gradient(180deg, black 70%, transparent)",
          }}
        >
          {recent.length === 0 && (
            <div
              className="mono"
              style={{ color: "var(--ink-faint)", fontSize: 11, padding: "8px 6px" }}
            >
              awaiting first turn…
            </div>
          )}
          {recent.map(({ ev, idx }, i) => {
            const f = formatLogEntry(ev as LogEntry);
            return (
              <div
                key={idx}
                className={i === 0 ? "cp-log-entry-incoming" : undefined}
                style={{
                  padding: "4px 6px",
                  background: i === 0 ? "rgba(139,92,246,0.10)" : "transparent",
                  borderLeft:
                    i === 0 ? "2px solid var(--purple-400)" : "2px solid transparent",
                  opacity: 1 - Math.min(0.45, i * 0.08),
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 11,
                  borderRadius: 2,
                  marginBottom: 2,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 4,
                }}
              >
                <span
                  style={{
                    color: "var(--ink-faint)",
                    fontSize: 8.5,
                    letterSpacing: 0,
                    flexShrink: 0,
                  }}
                >
                  T{ev.t}
                </span>
                <span
                  style={{
                    fontSize: 8.5,
                    letterSpacing: 0,
                    fontWeight: 700,
                    color: f.who === "P1" ? "var(--purple-400)" : "var(--ink-dim)",
                    flexShrink: 0,
                  }}
                >
                  {f.who}
                </span>
                <span
                  style={{
                    color: toneColor(f.tone),
                    fontSize: 10.5,
                    fontWeight: f.bold ? 700 : 400,
                    flex: 1,
                    minWidth: 0,
                    lineHeight: 1.25,
                    wordBreak: "break-word",
                  }}
                >
                  {f.txt}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LogOverlay({
  log,
  onClose,
}: {
  log: RedactedState["log"];
  onClose: () => void;
}) {
  const all = log.slice().reverse();
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 100,
        background: "rgba(6,6,26,0.78)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cp-panel"
        style={{
          width: 620,
          maxHeight: 820,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 0 0 1px var(--purple-500) inset, 0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        <div className="row between middle" style={{ alignItems: "center", marginBottom: 16 }}>
          <span className="cp-panel-title" style={{ fontSize: 12 }}>
            Action Log · Full History
          </span>
          <button className="cp-btn" style={{ padding: "6px 14px", fontSize: 10 }} onClick={onClose}>
            CLOSE ×
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {all.map((ev, i) => {
            const f = formatLogEntry(ev);
            return (
              <div
                key={i}
                style={{
                  padding: "8px 10px",
                  background: i === 0 ? "rgba(139,92,246,0.10)" : "transparent",
                  borderLeft:
                    i === 0 ? "2px solid var(--purple-400)" : "2px solid transparent",
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 12,
                  borderRadius: 2,
                  marginBottom: 3,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    color: "var(--ink-faint)",
                    fontSize: 10,
                    letterSpacing: 0,
                    flexShrink: 0,
                  }}
                >
                  T{ev.t}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: 0,
                    fontWeight: 700,
                    color: f.who === "P1" ? "var(--purple-400)" : "var(--ink-dim)",
                    flexShrink: 0,
                  }}
                >
                  {f.who}
                </span>
                <span
                  style={{
                    color: toneColor(f.tone),
                    fontSize: 12,
                    fontWeight: f.bold ? 700 : 400,
                    flex: 1,
                    minWidth: 0,
                    wordBreak: "break-word",
                  }}
                >
                  {f.txt}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Right rail — opp / turn / you
// ────────────────────────────────────────────────────────────

function RightRail({
  state,
  youIdx,
  oppIdx,
  youPlayer,
  oppPlayer,
  oppHandCount,
  canAct,
  onRefresh,
  onViewPile,
}: {
  state: RedactedState;
  youIdx: PlayerIdx;
  oppIdx: PlayerIdx;
  youPlayer: RedactedPlayer;
  oppPlayer: RedactedPlayer;
  oppHandCount: number;
  canAct: boolean;
  onRefresh: () => void;
  onViewPile: (pile: {
    title: string;
    cards: { instanceId: string; cardId: string | null }[];
    emptyText?: string;
  }) => void;
}) {
  const youCompiled = compiledCount(youPlayer);
  const oppCompiled = compiledCount(oppPlayer);
  const youHandLen = Array.isArray(youPlayer.hand) ? youPlayer.hand.length : 0;

  const isMyTurn = state.activePlayerIdx === youIdx;
  const gameOver = state.gameOver !== null;
  const youActive = !gameOver && isMyTurn;
  const oppActive = !gameOver && !isMyTurn;

  const youLabel = "YOU";
  const oppLabel = `OPPONENT`;

  // When the opponent has a pending question (or it's just their turn), the
  // status row should describe what we're waiting on, not just "OPP'S TURN".
  const waitingOnOpp = !gameOver && (state.opponentQuestion !== null || !isMyTurn);
  const statusTone: "you" | "opp" | "neutral" = gameOver
    ? "neutral"
    : waitingOnOpp
      ? "opp"
      : "you";
  const oppActivity = describeOpponentActivity(state.opponentQuestion, state.phase);
  const myQuestion =
    state.pendingQuestion && state.pendingQuestion.forPlayerIdx === youIdx
      ? state.pendingQuestion
      : null;
  const statusLabel = gameOver
    ? "GAME OVER"
    : canAct
      ? "YOUR TURN"
      : !waitingOnOpp
        ? myQuestion
          ? "YOUR INPUT NEEDED"
          : state.phase === "check-compile"
            ? "YOUR COMPILE PHASE"
            : "YOUR TURN"
        : `${oppLabel} — ${oppActivity.toUpperCase()}`;

  return (
    <div
      style={{
        position: "absolute",
        right: PAD,
        top: TOP_OFFSET,
        width: RIGHT_W,
        height: RIGHT_RAIL_H,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* OPP BLOCK */}
      <div
        className={`cp-panel ${oppActive ? "cp-active-panel-opp" : "cp-inactive-panel"}`}
        style={{
          padding: "18px 20px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div className="row gap-3 middle" style={{ alignItems: "center" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: oppActive ? "1.5px solid var(--fire)" : "1.5px solid var(--line-3)",
              background: oppActive
                ? "linear-gradient(135deg, rgba(var(--fire-rgb), 0.45), transparent)"
                : "linear-gradient(135deg, rgba(255,255,255,0.05), transparent)",
              boxShadow: oppActive ? "0 0 14px rgba(var(--fire-rgb), 0.5)" : "none",
              display: "grid",
              placeItems: "center",
              fontSize: 18,
              fontFamily: "JetBrains Mono, monospace",
              color: oppActive ? "var(--fire)" : "var(--ink-dim)",
              flexShrink: 0,
            }}
          >
            ◎
          </div>
          <div className="col" style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={oppPlayer.id}
            >
              {oppLabel}
              {oppActive && <span className="cp-turn-badge opp">◀ TURN</span>}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 9,
                color: "var(--light)",
                letterSpacing: "0.14em",
                marginTop: 2,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: "var(--light)",
                  boxShadow: "0 0 6px var(--light)",
                  marginRight: 5,
                  verticalAlign: "middle",
                }}
              />
              P{oppIdx + 1} · {oppCompiled}/3 COMPILED
            </div>
            <div
              className="mono"
              style={{
                fontSize: 8.5,
                color: "var(--ink-faint)",
                letterSpacing: "0.12em",
                marginTop: 2,
              }}
            >
              {oppPlayer.protocols.map((p) => p.protocol.toUpperCase()).join(" · ")}
            </div>
          </div>
        </div>

        <OppHandBackwards count={oppHandCount} playerIdx={oppIdx} />

        <div className="row gap-3" style={{ alignItems: "flex-end" }}>
          <ResourceTile
            label="DECK"
            count={Array.isArray(oppPlayer.deck) ? oppPlayer.deck.length : oppPlayer.deck.count}
            kind="deck"
            playerIdx={oppIdx}
          />
          <ResourceTile
            label="DISCARD"
            count={oppPlayer.trash.length}
            kind="discard"
            playerIdx={oppIdx}
            onClick={() =>
              onViewPile({
                title: `PLAYER ${oppIdx + 1} DISCARD`,
                cards: oppPlayer.trash,
              })
            }
          />
        </div>
      </div>

      {/* TURN BAND */}
      <TurnBandWrap>
        <div className="row between middle" style={{ alignItems: "center" }}>
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: "0.24em", color: "var(--ink-faint)" }}
          >
            TURN {state.turnNumber}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: "0.24em",
              color: "var(--ink-faint)",
              textTransform: "uppercase",
            }}
          >
            {state.phase}
          </span>
        </div>

        <div
          className="row gap-3 middle"
          style={{ alignItems: "center", justifyContent: "center", marginTop: 10 }}
        >
          <div className="col" style={{ alignItems: "center", flex: 1 }}>
            <span
              className="mono"
              style={{ fontSize: 8, letterSpacing: "0.22em", color: "var(--ink-faint)" }}
            >
              {oppLabel}
            </span>
            <span
              className="disp"
              style={{
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 0.9,
                color: "var(--fire)",
                textShadow: "0 0 22px rgba(var(--fire-rgb), 0.6)",
                marginTop: 4,
                letterSpacing: "-0.04em",
              }}
            >
              {oppCompiled}
            </span>
          </div>
          <div className="col" style={{ alignItems: "center", minWidth: 40 }}>
            <span
              className="mono"
              style={{ fontSize: 8, color: "var(--ink-faint)", letterSpacing: "0.22em" }}
            >
              COMP
            </span>
            <span style={{ fontSize: 22, color: "var(--ink-quiet)", marginTop: 6 }}>—</span>
            <span
              className="mono"
              style={{
                fontSize: 8,
                color: "var(--ink-faint)",
                letterSpacing: "0.22em",
                marginTop: 6,
              }}
            >
              TO 3
            </span>
          </div>
          <div className="col" style={{ alignItems: "center", flex: 1 }}>
            <span
              className="mono"
              style={{ fontSize: 8, letterSpacing: "0.22em", color: "var(--purple-300)" }}
            >
              YOU
            </span>
            <span
              className="disp"
              style={{
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 0.9,
                color: "var(--purple-400)",
                textShadow: "0 0 22px rgba(var(--purple-glow), 0.7)",
                marginTop: 4,
                letterSpacing: "-0.04em",
              }}
            >
              {youCompiled}
            </span>
          </div>
        </div>

        {statusTone === "opp" && (
          <div className={`cp-turn-status opp`} style={{ marginTop: 12 }}>
            <span className="cp-turn-arrow">▲</span>
            <span>{statusLabel}</span>
            <span className="cp-turn-arrow">▲</span>
          </div>
        )}
        {statusTone === "you" && (
          <div className={`cp-turn-status you`} style={{ marginTop: 12 }}>
            <span className="cp-turn-arrow">▼</span>
            <span>{statusLabel}</span>
            <span className="cp-turn-arrow">▼</span>
          </div>
        )}
        {statusTone === "neutral" && (
          <div className={`cp-turn-status neutral`} style={{ marginTop: 12 }}>
            <span>{statusLabel}</span>
          </div>
        )}
      </TurnBandWrap>

      {/* YOU BLOCK */}
      <div
        className={`cp-panel ${youActive ? "cp-active-panel-you" : "cp-inactive-panel"}`}
        style={{
          padding: "18px 20px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          borderColor: "var(--purple-500)",
          background:
            "linear-gradient(180deg, rgba(139,92,246,0.06), rgba(139,92,246,0.01)), rgba(13,11,34,0.6)",
        }}
      >
        <div className="row gap-3" style={{ alignItems: "flex-end" }}>
          <ResourceTile
            label="DECK"
            count={Array.isArray(youPlayer.deck) ? youPlayer.deck.length : youPlayer.deck.count}
            kind="deck"
            playerIdx={youIdx}
            onClick={
              Array.isArray(youPlayer.deck)
                ? () =>
                    onViewPile({
                      title: "YOUR DECK",
                      cards: Array.isArray(youPlayer.deck) ? youPlayer.deck : [],
                    })
                : undefined
            }
          />
          <ResourceTile
            label="DISCARD"
            count={youPlayer.trash.length}
            kind="discard"
            playerIdx={youIdx}
            onClick={() =>
              onViewPile({
                title: "YOUR DISCARD",
                cards: youPlayer.trash,
              })
            }
          />
        </div>

        <div className="row gap-3 middle" style={{ alignItems: "center" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              border: "1.5px solid var(--purple-400)",
              background: "linear-gradient(135deg, rgba(139,92,246,0.4), transparent)",
              boxShadow: "0 0 14px rgba(139,92,246,0.4)",
              display: "grid",
              placeItems: "center",
              fontSize: 18,
              fontFamily: "JetBrains Mono, monospace",
              color: "var(--purple-300)",
              flexShrink: 0,
            }}
          >
            ◉
          </div>
          <div className="col" style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={youPlayer.id}
            >
              {youLabel}
              {youActive && <span className="cp-turn-badge you">TURN ▶</span>}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 8.5,
                color: "var(--ink-faint)",
                letterSpacing: "0.12em",
                marginTop: 2,
              }}
            >
              P{youIdx + 1} · {youCompiled}/3 COMPILED
            </div>
            <div
              className="mono"
              style={{
                fontSize: 8.5,
                color: "var(--ink-faint)",
                letterSpacing: "0.12em",
                marginTop: 2,
              }}
            >
              {youPlayer.protocols.map((p) => p.protocol.toUpperCase()).join(" · ")}
            </div>
          </div>
          <div className="col" style={{ alignItems: "flex-end" }}>
            <span
              className="mono"
              style={{ fontSize: 8, letterSpacing: "0.2em", color: "var(--ink-faint)" }}
            >
              HAND
            </span>
            <span
              className="disp"
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "var(--purple-300)",
                lineHeight: 1,
              }}
            >
              {youHandLen}
            </span>
          </div>
        </div>

        <button
          className="cp-btn primary"
          disabled={!canAct}
          style={{
            width: "100%",
            padding: "14px 0",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.24em",
            justifyContent: "center",
          }}
          onClick={onRefresh}
        >
          REFRESH ▶
        </button>
      </div>
    </div>
  );
}

function ResourceTile({
  label,
  count,
  kind,
  playerIdx,
  onClick,
}: {
  label: string;
  count: number;
  kind: "deck" | "discard";
  playerIdx: PlayerIdx;
  onClick?: () => void;
}) {
  const anchorId = `${kind}:${playerIdx}`;
  const anchorRef = useAnchor(anchorId);
  const animClass = useAnchorAnimClass(anchorId);
  return (
    <div className="col gap-1" style={{ alignItems: "center", flex: 1 }}>
      <div
        ref={anchorRef as React.RefCallback<HTMLDivElement>}
        data-anim-anchor={anchorId}
        className={animClass}
        onClick={onClick}
        style={{
          position: "relative",
          width: 96,
          height: 134,
          borderRadius: 8,
          overflow: "hidden",
          cursor: onClick ? "pointer" : "default",
          ...(kind === "deck"
            ? {
                background:
                  "repeating-linear-gradient(45deg, rgba(139,92,246,0.18) 0 6px, transparent 6px 12px), radial-gradient(circle at 50% 40%, rgba(139,92,246,0.35), transparent 70%), var(--void-3)",
                border: "1px solid var(--purple-500)",
                boxShadow:
                  "0 0 0 1px var(--purple-500) inset, 0 4px 18px rgba(139,92,246,0.25)",
              }
            : {
                background: "rgba(245,243,255,0.02)",
                border: "1px dashed var(--line-3)",
              }),
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "rgba(6,6,26,0.55)",
            backdropFilter: "blur(2px)",
          }}
        >
          <span
            className="disp"
            style={{
              fontSize: 44,
              fontWeight: 700,
              lineHeight: 0.9,
              color: "var(--ink)",
              textShadow: kind === "deck" ? "0 0 16px rgba(139,92,246,0.6)" : "none",
              letterSpacing: "-0.02em",
            }}
          >
            {count}
          </span>
        </div>
      </div>
      <span
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: "0.2em",
          color: "var(--ink-faint)",
          marginTop: 4,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function OppHandBackwards({ count, playerIdx }: { count: number; playerIdx: PlayerIdx }) {
  const cardW = 38;
  const cardH = 56;
  const gap = 6;
  const safeCount = Math.max(0, count);
  const totalW = Math.max(cardW, safeCount * cardW + (safeCount - 1) * gap);
  const zoneRef = useAnchor(`hand-zone:${playerIdx}`);
  return (
    <div className="col gap-2" style={{ alignItems: "center" }}>
      <div
        ref={zoneRef as React.RefCallback<HTMLDivElement>}
        data-anim-anchor={`hand-zone:${playerIdx}`}
        style={{ display: "flex", gap, width: totalW, justifyContent: "center", minHeight: cardH }}
      >
        {Array.from({ length: safeCount }).map((_, i) => (
          <div
            key={i}
            className="cp-card facedown"
            style={{
              width: cardW,
              height: cardH,
              transform: "rotate(180deg)",
              borderRadius: 4,
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      <span
        className="mono"
        style={{ fontSize: 9, letterSpacing: "0.2em", color: "var(--ink-faint)" }}
      >
        OPP HAND · {safeCount}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Hand strip
// ────────────────────────────────────────────────────────────

function HandStrip({
  hand,
  canDrag,
  dragInstanceId,
  onDragStart,
  onDragEnd,
  targets,
  pickedSet,
  onCardPick,
  youIdx,
}: {
  hand: RedactedCard[];
  canDrag: boolean;
  dragInstanceId: string | null;
  onDragStart: (instanceId: string) => void;
  onDragEnd: () => void;
  targets: PromptTargets;
  pickedSet: Set<string>;
  onCardPick: (instanceId: string) => void;
  youIdx: PlayerIdx;
}) {
  const zoneAnchor = useAnchor(`hand-zone:${youIdx}`);
  const cardWidth = handCardWidth(hand.length);
  // Hover enlargement only kicks in when cards have been shrunk to fit (>6 in
  // hand). Scale always lands on 1.2× the default card width so the hovered
  // card has a consistent visual size regardless of hand count.
  const enlargeOnHover = hand.length > 6;
  const hoverScale = enlargeOnHover
    ? (HAND_CARD_W_DEFAULT * 1.2) / cardWidth
    : 1;
  return (
    <div
      ref={zoneAnchor as React.RefCallback<HTMLDivElement>}
      data-anim-anchor={`hand-zone:${youIdx}`}
      style={{
        position: "absolute",
        top: TOP_OFFSET,
        left: PAD,
        width: HAND_W,
        height: HAND_H,
        borderRight: "1px solid var(--line-2)",
        background: "linear-gradient(90deg, transparent, rgba(13,11,34,0.7))",
        padding: `${HAND_PAD_TOP}px ${HAND_PAD_X}px ${HAND_PAD_BOTTOM}px`,
        overflow: "visible",
        zIndex: 50,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: HAND_GRID_GAP,
          alignItems: "start",
          justifyItems: "center",
        }}
      >
        {hand.length === 0 && (
          <div
            className="mono"
            style={{
              gridColumn: "1 / -1",
              color: "var(--ink-faint)",
              fontSize: 12,
              padding: 40,
              textAlign: "center",
            }}
          >
            HAND EMPTY
          </div>
        )}
        {hand.map((c, i) => {
          const selectable = targets.cards.has(c.instanceId);
          const totalRows = Math.max(1, Math.ceil(hand.length / 2));
          const row = Math.floor(i / 2);
          const rowKind: "top" | "bottom" | "middle" =
            row === 0 ? "top" : row === totalRows - 1 ? "bottom" : "middle";
          return (
            <HandCard
              key={c.instanceId}
              card={c}
              draggable={canDrag}
              dragging={dragInstanceId === c.instanceId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              selectable={selectable}
              selected={pickedSet.has(c.instanceId)}
              onPick={selectable ? onCardPick : undefined}
              rowKind={rowKind}
              width={cardWidth}
              enlargeOnHover={enlargeOnHover}
              hoverScale={hoverScale}
            />
          );
        })}
      </div>
    </div>
  );
}

function HandCard({
  card,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
  selectable,
  selected,
  onPick,
  rowKind,
  width,
  enlargeOnHover,
  hoverScale,
}: {
  card: RedactedCard;
  draggable: boolean;
  dragging: boolean;
  onDragStart: (instanceId: string) => void;
  onDragEnd: () => void;
  selectable?: boolean;
  selected?: boolean;
  onPick?: (instanceId: string) => void;
  rowKind: "top" | "bottom" | "middle";
  width: number;
  enlargeOnHover: boolean;
  hoverScale: number;
}) {
  const { setHovered } = useContext(HoverCtx);
  const { el, num } = parseCardId(card.cardId);
  const info = getCard(card.cardId);
  const anchorRef = useAnchor(`hand:${card.instanceId}`);
  const animClass = useCardAnimClass(card.instanceId);
  const classes = ["cp-hand-card", `row-${rowKind}`];
  if (dragging) classes.push("dragging");
  if (selectable) classes.push("is-selectable");
  if (selected) classes.push("is-selected");
  if (enlargeOnHover) classes.push("can-enlarge");
  if (animClass) classes.push(animClass);

  return (
    <div
      ref={anchorRef as React.RefCallback<HTMLDivElement>}
      data-anim-anchor={`hand:${card.instanceId}`}
      className={classes.join(" ")}
      style={{
        cursor: selectable ? "pointer" : draggable ? "grab" : "default",
        ...(enlargeOnHover
          ? { ["--cp-hover-scale" as never]: String(hoverScale) }
          : {}),
      }}
      onMouseEnter={() => {
        if (card.cardId) setHovered(card.cardId);
      }}
      onMouseLeave={() => setHovered(null)}
      onClick={(e) => {
        if (!selectable || !onPick) return;
        e.stopPropagation();
        onPick(card.instanceId);
      }}
    >
      <Card
        el={el}
        num={num}
        faceDown={card.faceDown}
        top={info?.top}
        middle={info?.middle}
        bottom={info?.bottom}
        width={width}
        className={`${dragging ? "dragging" : ""}${selectable ? " is-selectable" : ""}${selected ? " is-selected" : ""}`}
        draggable={draggable && !selectable}
        onDragStart={(e) => {
          if (!draggable || selectable) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", card.instanceId);
          onDragStart(card.instanceId);
        }}
        onDragEnd={() => onDragEnd()}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Overlays
// ────────────────────────────────────────────────────────────

function CompilePickerOverlay({
  state,
  client,
  gameId,
  onNotify,
  question,
  lines,
}: {
  state: RedactedState;
  client: ClientSocket;
  gameId: string;
  onNotify: NotifyFn;
  question: Extract<Question, { kind: "compile-line" }>;
  lines: LineIdx[];
}) {
  const player = state.players[state.activePlayerIdx];
  const choose = (l: LineIdx) => {
    const ans = answerForCompile(question, l);
    if (!ans) {
      onNotify("compile line not available", "error");
      return;
    }
    send.answer(client, gameId, ans);
  };
  return (
    <ModalOverlay>
      <h2 style={modalTitle}>
        Compile — Player {state.activePlayerIdx + 1} must compile a line
      </h2>
      <div className="row gap-3" style={{ flexWrap: "wrap" }}>
        {lines.map((l) => (
          <button key={l} className="cp-btn primary" onClick={() => choose(l)}>
            LINE {l + 1} · {player.protocols[l]?.protocol.toUpperCase()}
          </button>
        ))}
      </div>
    </ModalOverlay>
  );
}

/**
 * Modal that surfaces the control-rearrange question. Six perm buttons + skip.
 * Only fires when the active player holds Control; the engine emits this just
 * before the action-phase question or compile-line question, so its visibility
 * gates the rest of the turn.
 */
function RearrangeOverlay({
  client,
  gameId,
  question,
  onNotify,
}: {
  client: ClientSocket;
  gameId: string;
  question: Extract<Question, { kind: "control-rearrange" }>;
  onNotify: NotifyFn;
}) {
  const perms: { order: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]; label: string }[] = [
    { order: [0, 1, 2], label: "1·2·3" },
    { order: [0, 2, 1], label: "1·3·2" },
    { order: [1, 0, 2], label: "2·1·3" },
    { order: [1, 2, 0], label: "2·3·1" },
    { order: [2, 0, 1], label: "3·1·2" },
    { order: [2, 1, 0], label: "3·2·1" },
  ];
  const choose = (
    arg: "skip" | { side: PlayerIdx; newOrder: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] },
  ) => {
    const ans = answerForRearrange(question, arg);
    if (!ans) {
      onNotify("rearrange option not available", "error");
      return;
    }
    send.answer(client, gameId, ans);
  };
  return (
    <ModalOverlay>
      <h2 style={modalTitle}>
        Control — rearrange your protocols (optional)
      </h2>
      <p
        className="mono"
        style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--ink-dim)" }}
      >
        Reorder your three protocols before this {question.reason.includes("compile") ? "compile" : "action"}. Skip to leave them as-is.
      </p>
      <div className="row gap-3" style={{ flexWrap: "wrap" }}>
        {perms.map((p) => (
          <button
            key={p.label}
            className="cp-btn primary"
            onClick={() => choose({ side: question.forPlayerIdx, newOrder: p.order })}
          >
            {p.label}
          </button>
        ))}
        <button className="cp-btn ghost" onClick={() => choose("skip")}>
          SKIP
        </button>
      </div>
    </ModalOverlay>
  );
}

function pendingPromptIsBanner(q: Question): boolean {
  return (
    q.kind === "choose-card" ||
    q.kind === "choose-line" ||
    q.kind === "choose-option" ||
    q.kind === "discard-selection" ||
    q.kind === "play-from-hand"
  );
}

function PromptBanner({
  prompt,
  targets,
  pickedCount,
  pendingCard,
  pendingLine,
  pendingOption,
  onOption,
  onConfirm,
  onSkip,
}: {
  prompt: Question;
  targets: PromptTargets;
  pickedCount: number;
  pendingCard: string | null;
  pendingLine: LineIdx | null;
  pendingOption: string | null;
  onOption: (optionId: string) => void;
  onConfirm: () => void;
  onSkip: () => void;
}) {
  const discardCount =
    prompt.kind === "discard-selection" ? (prompt.picks?.min ?? 1) : 0;
  const targetCount =
    prompt.kind === "choose-line" ? targets.lines.size : targets.cards.size;

  let instruction = "";
  switch (prompt.kind) {
    case "choose-card":
      instruction = pendingCard ? "Confirm your pick or click another card" : "Click a highlighted card";
      break;
    case "choose-line":
      instruction = pendingLine !== null ? "Confirm your pick or click another line" : "Click a highlighted line";
      break;
    case "choose-option":
      instruction = pendingOption ? "Confirm your pick or choose another option" : "Pick an option";
      break;
    case "discard-selection":
      instruction = `Select ${discardCount} card${discardCount === 1 ? "" : "s"} from your hand`;
      break;
    case "play-from-hand": {
      // Derive orientation + lanes from the question's enumerated options.
      let hasUp = false;
      let hasDown = false;
      const lanes = new Set<LineIdx>();
      for (const opt of prompt.options) {
        const p = opt.payload as { lineIdx: LineIdx; faceDown: boolean };
        lanes.add(p.lineIdx);
        if (p.faceDown) hasDown = true;
        else hasUp = true;
      }
      const parts: string[] = [];
      if (hasDown && !hasUp) parts.push("face-down");
      else if (hasUp && !hasDown) parts.push("face-up");
      const lanesArr = [...lanes].sort();
      const lineHint =
        lanesArr.length < 3
          ? ` to ${lanesArr.map((l) => `L${l + 1}`).join(" or ")}`
          : "";
      instruction = `Drag a card from your hand onto a lane to play${
        parts.length > 0 ? ` ${parts.join(", ")}` : ""
      }${lineHint}`;
      break;
    }
    default:
      instruction = "";
      break;
  }

  const showSkip = prompt.kind === "choose-card" && prompt.optional;
  const showConfirm =
    prompt.kind === "choose-card" ||
    prompt.kind === "choose-line" ||
    prompt.kind === "choose-option" ||
    prompt.kind === "discard-selection";
  const confirmEnabled =
    (prompt.kind === "choose-card" && pendingCard !== null) ||
    (prompt.kind === "choose-line" && pendingLine !== null) ||
    (prompt.kind === "choose-option" && pendingOption !== null) ||
    (prompt.kind === "discard-selection" && pickedCount === discardCount);

  return (
    <div className="cp-prompt-banner">
      <div className="cp-prompt-banner-body">
        <div className="cp-prompt-banner-head">
          <span className="cp-prompt-banner-kind">
            ◆ PLAYER {prompt.forPlayerIdx + 1} · PROMPT
          </span>
          {(prompt.kind === "choose-card" || prompt.kind === "choose-line") && (
            <span className="cp-prompt-banner-count">{targetCount} target{targetCount === 1 ? "" : "s"}</span>
          )}
          {prompt.kind === "discard-selection" && (
            <span className="cp-prompt-banner-count">
              {pickedCount}/{discardCount} selected
            </span>
          )}
        </div>
        <div className="cp-prompt-banner-reason">{prompt.reason}</div>
        <div className="cp-prompt-banner-instruction">{instruction}</div>
      </div>

      {prompt.kind === "choose-option" && (
        <div className="cp-prompt-banner-options">
          {prompt.options.map((o) => {
            const innerId = (o.payload as { optionId: string }).optionId;
            return (
              <button
                key={o.id}
                className={`cp-btn ${pendingOption === innerId ? "primary is-selected" : "ghost"}`}
                onClick={() => onOption(innerId)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {(showSkip || showConfirm) && (
        <div className="cp-prompt-banner-actions">
          {showSkip && (
            <button className="cp-btn ghost" onClick={onSkip}>
              SKIP
            </button>
          )}
          {showConfirm && (
            <button
              className="cp-btn primary"
              disabled={!confirmEnabled}
              onClick={onConfirm}
            >
              CONFIRM
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GameOverOverlay({
  winnerIdx,
  players,
}: {
  winnerIdx: PlayerIdx;
  players: RedactedState["players"];
}) {
  const winner = players[winnerIdx];
  return (
    <ModalOverlay>
      <h2 style={{ ...modalTitle, fontSize: 24, color: "var(--purple-300)" }}>
        ▶ GAME OVER
      </h2>
      <div style={{ textAlign: "center", padding: "12px 0" }}>
        <div
          className="disp"
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: "var(--purple-400)",
            textShadow: "0 0 22px rgba(var(--purple-glow), 0.7)",
            letterSpacing: "-0.02em",
          }}
          title={winner.id}
        >
          PLAYER {winnerIdx + 1}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 12,
            letterSpacing: "0.22em",
            color: "var(--ink-dim)",
            marginTop: 8,
          }}
        >
          PLAYER {winnerIdx + 1} WINS
        </div>
      </div>
    </ModalOverlay>
  );
}

function CardListOverlay({
  title,
  cards,
  onClose,
  dismissOnBackdrop = false,
  emptyText = "EMPTY",
}: {
  title: string;
  cards: { instanceId: string; cardId: string | null }[];
  onClose: () => void;
  /** Whether clicking the dimmed backdrop dismisses. Off for engine-driven prompts. */
  dismissOnBackdrop?: boolean;
  emptyText?: string;
}) {
  return (
    <div
      onClick={dismissOnBackdrop ? onClose : undefined}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        background: "rgba(6,6,26,0.78)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cp-panel"
        style={{
          minWidth: 480,
          maxWidth: 1280,
          padding: 28,
          boxShadow: "0 0 0 1px var(--purple-500) inset, 0 20px 60px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h2 style={{ ...modalTitle, fontSize: 18, color: "var(--purple-300)" }}>
          ◆ {title}
        </h2>
        {cards.length === 0 ? (
          <div
            className="mono"
            style={{
              padding: 40,
              textAlign: "center",
              color: "var(--ink-faint)",
              letterSpacing: "0.2em",
              fontSize: 12,
            }}
          >
            {emptyText}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              justifyContent: "center",
              padding: "8px 0",
            }}
          >
            {cards.map((c) => {
              const { el, num } = parseCardId(c.cardId);
              const info = getCard(c.cardId);
              return (
                <Card
                  key={c.instanceId}
                  el={el}
                  num={num}
                  top={info?.top}
                  middle={info?.middle}
                  bottom={info?.bottom}
                  width={180}
                />
              );
            })}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button className="cp-btn primary" onClick={onClose}>
            DONE
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 90,
        background: "rgba(6,6,26,0.78)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        className="cp-panel"
        style={{
          minWidth: 480,
          maxWidth: 720,
          padding: 28,
          boxShadow: "0 0 0 1px var(--purple-500) inset, 0 20px 60px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const modalTitle: CSSProperties = {
  margin: 0,
  fontFamily: "Space Grotesk, sans-serif",
  fontSize: 18,
  fontWeight: 700,
  color: "var(--ink)",
  letterSpacing: "-0.01em",
};

