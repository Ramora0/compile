import { useContext, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  LineIdx,
  LogEntry,
  PlayerAction,
  PlayerIdx,
  Prompt,
  PromptResponse,
  RedactedCard,
  RedactedPlayer,
  RedactedState,
} from "./types.js";
import type { NotifyFn } from "./App.js";
import { getCard } from "./cards.js";
import { promptTargets, type PromptTargets } from "./prompts.js";
import { send, type ClientSocket } from "./socket.js";
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
const HAND_W = 490;
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

function stackValue(stack: RedactedCard[]): number {
  let total = 0;
  for (const c of stack) {
    if (c.faceDown) {
      total += 2;
    } else {
      const v = parseCardId(c.cardId).num ?? 0;
      total += v;
    }
  }
  return total;
}

function isCompilable(state: RedactedState, playerIdx: PlayerIdx, lineIdx: LineIdx): boolean {
  const opp = (1 - playerIdx) as PlayerIdx;
  const my = stackValue(state.stacks[playerIdx]?.[lineIdx] ?? []);
  const their = stackValue(state.stacks[opp]?.[lineIdx] ?? []);
  return my >= 10 && my > their;
}

function compiledCount(player: RedactedPlayer): number {
  return player.protocols.reduce((n, p) => n + (p.compiled ? 1 : 0), 0);
}

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
  const [logExpanded, setLogExpanded] = useState(false);

  // Clear any stale drag state on turn flip.
  useEffect(() => {
    setDragInstanceId(null);
  }, [state.turnNumber, state.activePlayerIdx]);

  // Clear discard picks when prompt changes (id null or different promptId).
  const promptId = state.pendingPrompt?.promptId ?? null;
  useEffect(() => {
    setPickedDiscards([]);
  }, [promptId]);

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

  const canAct =
    state.phase === "action" &&
    state.pendingPrompt === null &&
    state.winnerIdx === null &&
    isMyTurn;

  const compilable: LineIdx[] = useMemo(() => {
    if (state.phase !== "check-compile" || state.winnerIdx !== null) return [];
    if (!isMyTurn) return [];
    return ([0, 1, 2] as LineIdx[]).filter((l) => isCompilable(state, youIdx, l));
  }, [state, youIdx, isMyTurn]);

  const draggedCard = dragInstanceId
    ? youHand.find((c) => c.instanceId === dragInstanceId) ?? null
    : null;
  const draggedProtocol = draggedCard ? getCard(draggedCard.cardId)?.protocol ?? null : null;

  const play = (instanceId: string, lineIdx: LineIdx, faceDown: boolean) => {
    if (!canAct) return;
    const action: PlayerAction = { kind: "play", instanceId, lineIdx, faceDown };
    try {
      send.submitAction(client, gameId, action);
    } catch (e) {
      onNotify((e as Error).message, "error");
    }
  };

  const refresh = () => {
    if (!canAct) return;
    try {
      send.submitAction(client, gameId, { kind: "refresh" });
    } catch (e) {
      onNotify((e as Error).message, "error");
    }
  };

  // ── prompt-driven selection ──────────────────────────────────
  // Only surface prompt targets when the prompt is for me; otherwise the
  // opponent's prompt would highlight cards on my screen with no way to act.
  const pendingPrompt =
    state.pendingPrompt && state.pendingPrompt.forPlayerIdx === myIdx
      ? state.pendingPrompt
      : null;
  const targets = useMemo<PromptTargets>(
    () => promptTargets(pendingPrompt, state),
    [pendingPrompt, state],
  );
  const sendPromptResponse = (response: PromptResponse) => {
    if (!pendingPrompt) return;
    try {
      send.promptResponse(client, gameId, response);
    } catch (e) {
      onNotify((e as Error).message, "error");
    }
  };

  const handleCardPick = (instanceId: string) => {
    if (!pendingPrompt) return;
    if (!targets.cards.has(instanceId)) return;
    if (pendingPrompt.kind === "choose-card") {
      sendPromptResponse({
        kind: "card-chosen",
        promptId: pendingPrompt.promptId,
        instanceId,
      });
    } else if (pendingPrompt.kind === "discard-selection") {
      setPickedDiscards((cur) =>
        cur.includes(instanceId)
          ? cur.filter((x) => x !== instanceId)
          : cur.length >= pendingPrompt.count
            ? cur
            : [...cur, instanceId],
      );
    }
  };

  const handleLinePick = (lineIdx: LineIdx) => {
    if (!pendingPrompt || pendingPrompt.kind !== "choose-line") return;
    if (!targets.lines.has(lineIdx)) return;
    sendPromptResponse({
      kind: "line-chosen",
      promptId: pendingPrompt.promptId,
      lineIdx,
    });
  };

  const handleOptionPick = (optionId: string) => {
    if (!pendingPrompt || pendingPrompt.kind !== "choose-option") return;
    sendPromptResponse({
      kind: "option-chosen",
      promptId: pendingPrompt.promptId,
      optionId,
    });
  };

  const confirmDiscards = () => {
    if (!pendingPrompt || pendingPrompt.kind !== "discard-selection") return;
    if (pickedDiscards.length !== pendingPrompt.count) return;
    sendPromptResponse({
      kind: "discard-chosen",
      promptId: pendingPrompt.promptId,
      instanceIds: pickedDiscards,
    });
  };

  const skipPrompt = () => {
    if (!pendingPrompt || pendingPrompt.kind !== "choose-card" || !pendingPrompt.optional) return;
    sendPromptResponse({
      kind: "card-chosen",
      promptId: pendingPrompt.promptId,
      instanceId: null,
    });
  };

  const pickedSet = useMemo(() => new Set(pickedDiscards), [pickedDiscards]);

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
        canAct={canAct}
        dragInstanceId={dragInstanceId}
        draggedProtocol={draggedProtocol}
        compilable={compilable}
        onPlay={play}
        onNotify={onNotify}
        targets={targets}
        pickedSet={pickedSet}
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
      />

      <HandStrip
        hand={sortedYouHand}
        canAct={canAct}
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

      {state.phase === "check-compile" &&
        state.winnerIdx === null &&
        isMyTurn &&
        compilable.length > 0 && (
          <CompilePickerOverlay
            state={state}
            client={client}
            gameId={gameId}
            onNotify={onNotify}
            lines={compilable}
          />
        )}

      {pendingPrompt && (
        <PromptBanner
          prompt={pendingPrompt}
          targets={targets}
          pickedCount={pickedDiscards.length}
          onOption={handleOptionPick}
          onConfirmDiscards={confirmDiscards}
          onSkip={skipPrompt}
        />
      )}

      {state.winnerIdx === null && !isMyTurn && !pendingPrompt && (
        <WaitingOverlay oppIdx={oppIdx} phase={state.phase} />
      )}

      {state.winnerIdx !== null && (
        <GameOverOverlay
          winnerIdx={state.winnerIdx}
          players={state.players}
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

function WaitingOverlay({ oppIdx, phase }: { oppIdx: PlayerIdx; phase: RedactedState["phase"] }) {
  const label =
    phase === "check-compile"
      ? "choosing a line to compile"
      : phase === "action"
        ? "taking their turn"
        : "thinking";
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
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--purple-400, #b693ff)",
          display: "inline-block",
        }}
      />
      PLAYER {oppIdx + 1} IS {label.toUpperCase()}…
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
  canAct,
  dragInstanceId,
  draggedProtocol,
  compilable,
  onPlay,
  onNotify,
  targets,
  pickedSet,
  onCardPick,
  onLinePick,
}: {
  state: RedactedState;
  youIdx: PlayerIdx;
  oppIdx: PlayerIdx;
  canAct: boolean;
  dragInstanceId: string | null;
  draggedProtocol: string | null;
  compilable: LineIdx[];
  onPlay: (instanceId: string, lineIdx: LineIdx, faceDown: boolean) => void;
  onNotify: NotifyFn;
  targets: PromptTargets;
  pickedSet: Set<string>;
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
            canAct={canAct}
            dragInstanceId={dragInstanceId}
            draggedProtocol={draggedProtocol}
            compilable={compilable.includes(lineIdx)}
            onPlay={onPlay}
            onNotify={onNotify}
            targets={targets}
            pickedSet={pickedSet}
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
  canAct,
  dragInstanceId,
  draggedProtocol,
  compilable,
  onPlay,
  onNotify,
  targets,
  pickedSet,
  onCardPick,
  onLinePick,
}: {
  state: RedactedState;
  youIdx: PlayerIdx;
  oppIdx: PlayerIdx;
  lineIdx: LineIdx;
  canAct: boolean;
  dragInstanceId: string | null;
  draggedProtocol: string | null;
  compilable: boolean;
  onPlay: (instanceId: string, lineIdx: LineIdx, faceDown: boolean) => void;
  onNotify: NotifyFn;
  targets: PromptTargets;
  pickedSet: Set<string>;
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

  const youCompile = stackValue(youStack);
  const oppCompile = stackValue(oppStack);

  const youStackOffsets = stackOffsets(youStack);
  const oppStackOffsets = stackOffsets(oppStack);

  const youCompiled = !!youSlot?.compiled;
  const oppCompiled = !!oppSlot?.compiled;

  const isDragging = canAct && dragInstanceId !== null;
  const faceUpLegal = isDragging && draggedProtocol !== null && draggedProtocol === youSlot?.protocol;
  const laneProtocolLabel = youSlot?.protocol?.toUpperCase() ?? "—";
  const draggedProtocolLabel = draggedProtocol?.toUpperCase() ?? "?";

  return (
    <div
      className={`cp-panel${lineIsTarget ? " is-target" : ""}`}
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
            <PlayDropZone
              legal={faceUpLegal}
              label="PLAY FACE-UP"
              hint={faceUpLegal ? laneProtocolLabel : `NEED ${draggedProtocolLabel}`}
              onAccept={() => {
                if (dragInstanceId) onPlay(dragInstanceId, lineIdx, false);
              }}
              onReject={() =>
                onNotify(
                  `Can't play face-up in line ${lineIdx + 1}: this card is ${draggedProtocolLabel}, lane is ${laneProtocolLabel}.`,
                  "error",
                )
              }
            />
            <PlayDropZone
              legal={true}
              label="PLAY FACE-DOWN"
              hint="ANY LANE · VALUE 2"
              onAccept={() => {
                if (dragInstanceId) onPlay(dragInstanceId, lineIdx, true);
              }}
              onReject={() => {}}
            />
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
}: {
  state: RedactedState;
  youIdx: PlayerIdx;
  oppIdx: PlayerIdx;
  youPlayer: RedactedPlayer;
  oppPlayer: RedactedPlayer;
  oppHandCount: number;
  canAct: boolean;
  onRefresh: () => void;
}) {
  const youCompiled = compiledCount(youPlayer);
  const oppCompiled = compiledCount(oppPlayer);
  const youHandLen = Array.isArray(youPlayer.hand) ? youPlayer.hand.length : 0;

  const isMyTurn = state.activePlayerIdx === youIdx;
  const gameOver = state.winnerIdx !== null;
  const youActive = !gameOver && isMyTurn;
  const oppActive = !gameOver && !isMyTurn;

  const youLabel = "YOU";
  const oppLabel = `OPPONENT`;

  const statusTone: "you" | "opp" | "neutral" = gameOver
    ? "neutral"
    : isMyTurn
      ? "you"
      : "opp";
  const statusLabel = gameOver
    ? "GAME OVER"
    : canAct
      ? "YOUR TURN"
      : isMyTurn
        ? state.pendingPrompt
          ? "YOUR INPUT NEEDED"
          : state.phase === "check-compile"
            ? "YOUR COMPILE PHASE"
            : "YOUR TURN"
        : state.pendingPrompt && state.pendingPrompt.forPlayerIdx === oppIdx
          ? `${oppLabel} — INPUT NEEDED`
          : state.phase === "check-compile"
            ? `${oppLabel} — COMPILE PHASE`
            : `${oppLabel}'S TURN`;

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
          <ResourceTile label="DECK" count={oppPlayer.deckCount} kind="deck" playerIdx={oppIdx} />
          <ResourceTile label="DISCARD" count={oppPlayer.trash.length} kind="discard" playerIdx={oppIdx} />
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
          <ResourceTile label="DECK" count={youPlayer.deckCount} kind="deck" playerIdx={youIdx} />
          <ResourceTile label="DISCARD" count={youPlayer.trash.length} kind="discard" playerIdx={youIdx} />
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
}: {
  label: string;
  count: number;
  kind: "deck" | "discard";
  playerIdx: PlayerIdx;
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
        style={{
          position: "relative",
          width: 96,
          height: 134,
          borderRadius: 8,
          overflow: "hidden",
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
  canAct,
  dragInstanceId,
  onDragStart,
  onDragEnd,
  targets,
  pickedSet,
  onCardPick,
  youIdx,
}: {
  hand: RedactedCard[];
  canAct: boolean;
  dragInstanceId: string | null;
  onDragStart: (instanceId: string) => void;
  onDragEnd: () => void;
  targets: PromptTargets;
  pickedSet: Set<string>;
  onCardPick: (instanceId: string) => void;
  youIdx: PlayerIdx;
}) {
  const zoneAnchor = useAnchor(`hand-zone:${youIdx}`);
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
        padding: "16px 14px 18px",
        overflow: "visible",
        zIndex: 50,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
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
        {hand.map((c) => {
          const selectable = targets.cards.has(c.instanceId);
          return (
            <HandCard
              key={c.instanceId}
              card={c}
              draggable={canAct}
              dragging={dragInstanceId === c.instanceId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              selectable={selectable}
              selected={pickedSet.has(c.instanceId)}
              onPick={selectable ? onCardPick : undefined}
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
}: {
  card: RedactedCard;
  draggable: boolean;
  dragging: boolean;
  onDragStart: (instanceId: string) => void;
  onDragEnd: () => void;
  selectable?: boolean;
  selected?: boolean;
  onPick?: (instanceId: string) => void;
}) {
  const { setHovered } = useContext(HoverCtx);
  const { el, num } = parseCardId(card.cardId);
  const info = getCard(card.cardId);
  const anchorRef = useAnchor(`hand:${card.instanceId}`);
  const animClass = useCardAnimClass(card.instanceId);
  const classes = ["cp-hand-card"];
  if (dragging) classes.push("dragging");
  if (selectable) classes.push("is-selectable");
  if (selected) classes.push("is-selected");
  if (animClass) classes.push(animClass);

  return (
    <div
      ref={anchorRef as React.RefCallback<HTMLDivElement>}
      data-anim-anchor={`hand:${card.instanceId}`}
      className={classes.join(" ")}
      style={{
        cursor: selectable ? "pointer" : draggable ? "grab" : "default",
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
  lines,
}: {
  state: RedactedState;
  client: ClientSocket;
  gameId: string;
  onNotify: NotifyFn;
  lines: LineIdx[];
}) {
  const player = state.players[state.activePlayerIdx];
  const choose = (l: LineIdx) => {
    try {
      send.chooseCompileLine(client, gameId, l);
    } catch (e) {
      onNotify((e as Error).message, "error");
    }
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

function PromptBanner({
  prompt,
  targets,
  pickedCount,
  onOption,
  onConfirmDiscards,
  onSkip,
}: {
  prompt: Prompt;
  targets: PromptTargets;
  pickedCount: number;
  onOption: (optionId: string) => void;
  onConfirmDiscards: () => void;
  onSkip: () => void;
}) {
  const targetCount =
    prompt.kind === "choose-line" ? targets.lines.size : targets.cards.size;

  let instruction = "";
  switch (prompt.kind) {
    case "choose-card":
      instruction = "Click a highlighted card";
      break;
    case "choose-line":
      instruction = "Click a highlighted line";
      break;
    case "choose-option":
      instruction = "Pick an option";
      break;
    case "discard-selection":
      instruction = `Select ${prompt.count} card${prompt.count === 1 ? "" : "s"} from your hand`;
      break;
  }

  const showSkip = prompt.kind === "choose-card" && prompt.optional;
  const showConfirm = prompt.kind === "discard-selection";
  const confirmEnabled = prompt.kind === "discard-selection" && pickedCount === prompt.count;

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
              {pickedCount}/{prompt.count} selected
            </span>
          )}
        </div>
        <div className="cp-prompt-banner-reason">{prompt.reason}</div>
        <div className="cp-prompt-banner-instruction">{instruction}</div>
      </div>

      {prompt.kind === "choose-option" && (
        <div className="cp-prompt-banner-options">
          {prompt.options.map((o) => (
            <button
              key={o.id}
              className="cp-btn primary"
              onClick={() => onOption(o.id)}
            >
              {o.label}
            </button>
          ))}
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
              onClick={onConfirmDiscards}
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

