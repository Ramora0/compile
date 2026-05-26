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
  SWAP_SECOND_REASON,
  buildPermuteAnswer,
  buildSkipAnswer,
  buildSwapFirstAnswer,
  buildSwapSecondAnswer,
  deriveReorderSession,
  isIdentity,
  moveIndex,
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

  const session = useMemo(
    () => deriveReorderSession(pendingQuestion, myIdx),
    [pendingQuestion, myIdx],
  );

  const [order, setOrder] = useState<ReorderOrder>(REORDER_IDENTITY);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Stashed second line of a Spirit-4 swap, kept between its two prompts (and
  // for the whole duration of the second prompt, so the default line-pick UI
  // never flashes). `swapAnswered` guards against re-sending the same answer if
  // an unrelated state update re-fires the effect while we await the engine.
  const [swapSecond, setSwapSecond] = useState<LineIdx | null>(null);
  const swapAnswered = useRef<string | null>(null);

  // Reset the working order whenever the active reorder question changes (or
  // closes), so a stale preview never leaks into the next one.
  const sessionId = session?.questionId ?? null;
  useEffect(() => {
    setOrder(REORDER_IDENTITY);
    setDragIdx(null);
  }, [sessionId]);

  // Swap handshake: when the engine asks for the second line, answer it with the
  // stashed target. Drop the stash once we move off that prompt. (A reconnect
  // with no stash falls through to the default line-pick UI — see `ownsPending`.)
  const pendingIsSwapSecond =
    pendingQuestion?.kind === "choose-line" && pendingQuestion.reason === SWAP_SECOND_REASON;
  useEffect(() => {
    if (pendingIsSwapSecond && pendingQuestion) {
      if (swapSecond !== null && swapAnswered.current !== pendingQuestion.questionId) {
        swapAnswered.current = pendingQuestion.questionId;
        const ans = buildSwapSecondAnswer(pendingQuestion, swapSecond);
        if (ans) send.answer(client, gameId, ans);
      }
    } else if (swapSecond !== null) {
      setSwapSecond(null);
      swapAnswered.current = null;
    }
  }, [pendingIsSwapSecond, pendingQuestion, swapSecond, client, gameId]);

  const changed = !isIdentity(order);
  // Permute commits any order (identity is a legal no-op); swap needs a real pair.
  const canConfirm = session === null ? false : session.mode === "swap" ? changed : true;

  const onDragStart = (displayIdx: number) => setDragIdx(displayIdx);
  const onDragEnd = () => setDragIdx(null);
  const onDrop = (displayIdx: number) => {
    if (dragIdx !== null && session) {
      setOrder(
        session.mode === "swap"
          ? swapPositions(dragIdx, displayIdx)
          : moveIndex(order, dragIdx, displayIdx),
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
    const ans = buildPermuteAnswer(pendingQuestion, order);
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
    onDragStart,
    onDragEnd,
    onDrop,
    confirm,
    reset,
    skip,
  };
}
