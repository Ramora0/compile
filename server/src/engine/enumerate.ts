/**
 * Pure functions that produce the Option[] for each kind of Question.
 * Inverts validation predicates into legal-set enumerations so the client
 * never has to construct its own action payloads.
 */
import { legalPlayLines, validatePlayCard } from "./actions.js";
import { compilableLines, LINE_INDICES } from "./field.js";
import { matchesCardFilter } from "./cardFilter.js";
import type { GameState, PlayerIdx } from "./types.js";
import type {
  ChooseCardPrompt,
  DiscardSelectionPrompt,
  PlayFromHandPrompt,
  Prompt,
  ShowHandPrompt,
} from "./ops.js";
import type { ProtocolName } from "../shared/protocols.js";
import type { Option } from "./question.js";

// ---------- Action (play / refresh) ----------

export function enumerateActionOptions(state: GameState, playerIdx: PlayerIdx): Option[] {
  const out: Option[] = [];
  const hand = state.players[playerIdx].hand;
  for (const card of hand) {
    const legal = legalPlayLines(state, playerIdx, card.instanceId);
    for (const lineIdx of legal.faceUpLines) {
      out.push({
        id: `play:${card.instanceId}:${lineIdx}:up`,
        label: `Play ${card.cardId} face-up to L${lineIdx + 1}`,
        payload: { kind: "play", instanceId: card.instanceId, lineIdx, faceDown: false },
      });
    }
    for (const lineIdx of legal.faceDownLines) {
      out.push({
        id: `play:${card.instanceId}:${lineIdx}:down`,
        label: `Play ${card.cardId} face-down to L${lineIdx + 1}`,
        payload: { kind: "play", instanceId: card.instanceId, lineIdx, faceDown: true },
      });
    }
  }
  // Refresh is always available (mandatory when hand is empty — actions.ts:35).
  out.push({
    id: "refresh",
    label: hand.length === 0 ? "Refresh (forced — empty hand)" : "Refresh",
    payload: { kind: "refresh" },
  });
  return out;
}

// ---------- Compile-line ----------

export function enumerateCompileOptions(state: GameState, playerIdx: PlayerIdx): Option[] {
  return compilableLines(state, playerIdx).map((lineIdx) => ({
    id: `compile:${lineIdx}`,
    label: `Compile L${lineIdx + 1}`,
    payload: { lineIdx },
  }));
}

// ---------- Control rearrange ----------

const PERMS_3: ReadonlyArray<[0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

/**
 * Control-rearrange options (rules.md:98): the holder may rearrange ONE
 * player's protocols — their own OR the opponent's. Emit every permutation for
 * both sides plus a single skip; the client picks the side and the order.
 */
export function enumerateRearrangeOptions(): Option[] {
  const out: Option[] = [];
  for (const side of [0, 1] as PlayerIdx[]) {
    for (const order of PERMS_3) {
      out.push({
        id: `rearrange:${side}:${order.join(",")}`,
        label: `P${side + 1}: ${order.map((i) => `L${i + 1}`).join("→")}`,
        payload: { kind: "rearrange", side, newOrder: order },
      });
    }
  }
  out.push({
    id: "rearrange:skip",
    label: "Skip rearrange",
    payload: { kind: "skip" },
  });
  return out;
}

// ---------- Draft pick ----------

export function enumerateDraftOptions(
  remainingPool: readonly ProtocolName[],
  pickCount: 1 | 2,
): Option[] {
  const out: Option[] = [];
  if (pickCount === 1) {
    for (const p of remainingPool) {
      out.push({
        id: `draft:${p}`,
        label: p,
        payload: { protocols: [p] },
      });
    }
    return out;
  }
  // pickCount === 2: every unordered pair.
  for (let i = 0; i < remainingPool.length; i++) {
    for (let j = i + 1; j < remainingPool.length; j++) {
      const a = remainingPool[i]!;
      const b = remainingPool[j]!;
      out.push({
        id: `draft:${a},${b}`,
        label: `${a} + ${b}`,
        payload: { protocols: [a, b] },
      });
    }
  }
  return out;
}

// ---------- Prompt → Options ----------

export function enumerateChooseCardOptions(
  state: GameState,
  prompt: ChooseCardPrompt,
): Option[] {
  const out: Option[] = [];
  // Field walk.
  for (let p = 0; p < 2; p++) {
    const side = p as PlayerIdx;
    for (const lineIdx of LINE_INDICES) {
      const stack = state.stacks[side][lineIdx].cards;
      for (let i = 0; i < stack.length; i++) {
        const card = stack[i]!;
        const covered = i !== stack.length - 1;
        if (
          matchesCardFilter(
            prompt.filter,
            prompt.forPlayerIdx,
            { kind: "field", side, lineIdx, covered },
            card,
          )
        ) {
          out.push({
            id: `card:${card.instanceId}`,
            label: card.cardId,
            payload: { instanceId: card.instanceId },
          });
        }
      }
    }
  }
  // Hand walk (matches only if filter pins instanceIds).
  for (let p = 0; p < 2; p++) {
    const ownerIdx = p as PlayerIdx;
    for (const card of state.players[ownerIdx].hand) {
      if (
        matchesCardFilter(
          prompt.filter,
          prompt.forPlayerIdx,
          { kind: "hand", ownerIdx },
          card,
        )
      ) {
        out.push({
          id: `card:${card.instanceId}`,
          label: card.cardId,
          payload: { instanceId: card.instanceId },
        });
      }
    }
  }
  if (prompt.optional) {
    out.push({
      id: "card:skip",
      label: "Skip",
      payload: { instanceId: null },
    });
  }
  return out;
}

export function enumeratePlayFromHandOptions(
  state: GameState,
  prompt: PlayFromHandPrompt,
): Option[] {
  const out: Option[] = [];
  const hand = state.players[prompt.forPlayerIdx].hand;
  for (const card of hand) {
    for (const lineIdx of prompt.allowedLines) {
      if (prompt.orientation !== "face-down") {
        try {
          validatePlayCard(state, prompt.forPlayerIdx, card.instanceId, lineIdx, false);
          out.push({
            id: `pfh:${card.instanceId}:${lineIdx}:up`,
            label: `Play ${card.cardId} face-up to L${lineIdx + 1}`,
            payload: { instanceId: card.instanceId, lineIdx, faceDown: false },
          });
        } catch { /* illegal — skip */ }
      }
      if (prompt.orientation !== "face-up") {
        try {
          validatePlayCard(state, prompt.forPlayerIdx, card.instanceId, lineIdx, true);
          out.push({
            id: `pfh:${card.instanceId}:${lineIdx}:down`,
            label: `Play ${card.cardId} face-down to L${lineIdx + 1}`,
            payload: { instanceId: card.instanceId, lineIdx, faceDown: true },
          });
        } catch { /* illegal — skip */ }
      }
    }
  }
  return out;
}

export function enumerateDiscardOptions(
  state: GameState,
  prompt: DiscardSelectionPrompt,
): Option[] {
  return state.players[prompt.forPlayerIdx].hand.map((card) => ({
    id: `discard:${card.instanceId}`,
    label: card.cardId,
    payload: { instanceId: card.instanceId },
  }));
}

export function enumerateShowHandAck(prompt: ShowHandPrompt): Option[] {
  return [
    {
      id: "ack",
      label: "OK",
      payload: {},
    },
  ];
}

export function enumeratePromptOptions(state: GameState, prompt: Prompt): Option[] {
  switch (prompt.kind) {
    case "choose-card":
      return enumerateChooseCardOptions(state, prompt);
    case "choose-line":
      return prompt.allowedLines.map((lineIdx) => ({
        id: `line:${lineIdx}`,
        label: `L${lineIdx + 1}`,
        payload: { lineIdx },
      }));
    case "choose-option":
      return prompt.options.map((o) => ({
        id: `opt:${o.id}`,
        label: o.label,
        payload: { optionId: o.id },
      }));
    case "discard-selection":
      return enumerateDiscardOptions(state, prompt);
    case "play-from-hand":
      return enumeratePlayFromHandOptions(state, prompt);
    case "show-hand":
      return enumerateShowHandAck(prompt);
  }
}
