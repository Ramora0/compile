/**
 * Stateful wrapper around the pure `protocolReorder` mechanism. Owns the local
 * working order + drag index for the in-progress reorder, resets them when the
 * active question changes, and commits answers over the socket. One hook
 * instance drives all four reorder flows (see `protocolReorder.ts`).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { LineIdx, PlayerIdx, Question } from "./types.js";
import type { NotifyFn } from "./App.js";
import { send, type ClientSocket } from "./socket.js";
import {
  REORDER_IDENTITY,
  SWAP_FIRST_REASON,
  SWAP_SECOND_REASON,
  buildPermuteAnswer,
  buildSkipAnswer,
  buildSwapFirstAnswer,
  buildSwapSecondAnswer,
  deriveReorderSession,
  isIdentity,
  swapIndices,
  swapPositions,
  transposition,
  type ReorderOrder,
  type ReorderSession,
} from "./protocolReorder.js";

export interface ReorderController {
  /** Non-null while a reorder question for this player is open. */
  session: ReorderSession | null;
  /** True when the reorder system owns the pending question — suppress the
   *  default prompt UI (banner, lane targets) for it. */
  ownsPending: boolean;
  order: ReorderOrder;
  dragIdx: number | null;
  changed: boolean;
  canConfirm: boolean;
  /** Switch which side is being rearranged (Control rearrange only). Resets
   *  the working order. No-op unless `session.chooseSide`. */
  setTargetSide: (side: PlayerIdx) => void;
  onDragStart: (displayIdx: number) => void;
  onDragEnd: () => void;
  onDrop: (displayIdx: number) => void;
  confirm: () => void;
  reset: () => void;
  skip: () => void;
}

export function useProtocolReorder(args: {
  pendingQuestion: Question | null;
  myIdx: PlayerIdx;
  client: ClientSocket;
  gameId: string;
  onNotify: NotifyFn;
}): ReorderController {
  const { pendingQuestion, myIdx, client, gameId, onNotify } = args;

  const baseSession = useMemo(
    () => deriveReorderSession(pendingQuestion, myIdx),
    [pendingQuestion, myIdx],
  );

  const [order, setOrder] = useState<ReorderOrder>(REORDER_IDENTITY);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Which side the Control holder is rearranging. Null until they pick; falls
  // back to the base session's side (their own). Only meaningful when the
  // session lets them choose (control-rearrange).
  const [sideOverride, setSideOverride] = useState<PlayerIdx | null>(null);

  // The session the UI acts on, with the chosen side folded into targetSide.
  const session = useMemo<ReorderSession | null>(() => {
    if (!baseSession) return null;
    if (!baseSession.chooseSide || sideOverride === null) return baseSession;
    return { ...baseSession, targetSide: sideOverride };
  }, [baseSession, sideOverride]);
  // Stashed second line of a Spirit-4 swap, kept between its two prompts (and
  // for the whole duration of the second prompt, so the default line-pick UI
  // never flashes). `swapAnswered` guards against re-sending the same answer if
  // an unrelated state update re-fires the effect while we await the engine.
  const [swapSecond, setSwapSecond] = useState<LineIdx | null>(null);
  const swapAnswered = useRef<string | null>(null);

  // Reset the working order (and chosen side) whenever the active reorder
  // question changes (or closes), so a stale preview never leaks into the next.
  const sessionId = baseSession?.questionId ?? null;
  useEffect(() => {
    setOrder(REORDER_IDENTITY);
    setDragIdx(null);
    setSideOverride(null);
  }, [sessionId]);

  // Swap handshake: when the engine asks for the second line, answer it with the
  // stashed target. Drop the stash once we move off that prompt. (A reconnect
  // with no stash falls through to the default line-pick UI — see `ownsPending`.)
  const pendingIsSwapSecond =
    pendingQuestion?.kind === "choose-line" && pendingQuestion.reason === SWAP_SECOND_REASON;
  // The first leg is still pending in the window between confirm() stashing
  // swapSecond and the server replying with the second prompt. Don't clear the
  // stash during that window, or the second leg leaks through as its own prompt.
  const pendingIsSwapFirst =
    pendingQuestion?.kind === "choose-line" && pendingQuestion.reason === SWAP_FIRST_REASON;
  useEffect(() => {
    if (pendingIsSwapSecond && pendingQuestion) {
      if (swapSecond !== null && swapAnswered.current !== pendingQuestion.questionId) {
        swapAnswered.current = pendingQuestion.questionId;
        const ans = buildSwapSecondAnswer(pendingQuestion, swapSecond);
        if (ans) send.answer(client, gameId, ans);
      }
    } else if (swapSecond !== null && !pendingIsSwapFirst) {
      setSwapSecond(null);
      swapAnswered.current = null;
    }
  }, [pendingIsSwapSecond, pendingIsSwapFirst, pendingQuestion, swapSecond, client, gameId]);

  const changed = !isIdentity(order);
  // Permute commits any order (identity is a legal no-op); swap needs a real pair.
  const canConfirm = session === null ? false : session.mode === "swap" ? changed : true;

  const setTargetSide = (side: PlayerIdx) => {
    if (!baseSession?.chooseSide) return;
    setSideOverride(side);
    setOrder(REORDER_IDENTITY);
    setDragIdx(null);
  };

  const onDragStart = (displayIdx: number) => setDragIdx(displayIdx);
  const onDragEnd = () => setDragIdx(null);
  const onDrop = (displayIdx: number) => {
    if (dragIdx !== null && session) {
      // Both modes drop-to-swap the two positions; swap mode is constrained to a
      // single transposition (one pick of A→B), permute composes repeated swaps.
      setOrder(
        session.mode === "swap"
          ? swapPositions(dragIdx, displayIdx)
          : swapIndices(order, dragIdx, displayIdx),
      );
    }
    setDragIdx(null);
  };

  const reset = () => setOrder(REORDER_IDENTITY);

  const skip = () => {
    if (!pendingQuestion) return;
    const ans = buildSkipAnswer(pendingQuestion);
    if (ans) send.answer(client, gameId, ans);
  };

  const confirm = () => {
    if (!session || !pendingQuestion) return;
    if (session.mode === "swap") {
      const pair = transposition(order);
      if (!pair) {
        onNotify("drag one protocol onto another to swap them", "error");
        return;
      }
      const ans = buildSwapFirstAnswer(pendingQuestion, pair[0]);
      if (!ans) {
        onNotify("swap not available", "error");
        return;
      }
      setSwapSecond(pair[1]);
      send.answer(client, gameId, ans);
      return;
    }
    const ans = buildPermuteAnswer(pendingQuestion, order, session.targetSide);
    if (!ans) {
      onNotify("rearrange option not available", "error");
      return;
    }
    send.answer(client, gameId, ans);
  };

  const ownsPending = session !== null || (pendingIsSwapSecond && swapSecond !== null);

  return {
    session,
    ownsPending,
    order,
    dragIdx,
    changed,
    canConfirm,
    setTargetSide,
    onDragStart,
    onDragEnd,
    onDrop,
    confirm,
    reset,
    skip,
  };
}
