import type { CardDef } from "./api.js";
import type { CardValue, ProtocolName } from "../shared/protocols.js";
import { cardId } from "../shared/protocols.js";

const cards = new Map<string, CardDef>();

export function registerCard(def: CardDef): void {
  const id = cardId(def.protocol, def.value);
  if (cards.has(id)) {
    throw new Error(`Card already registered: ${id}`);
  }
  cards.set(id, def);
}

export function getCard(id: string): CardDef | undefined {
  return cards.get(id);
}

export function requireCard(id: string): CardDef {
  const def = cards.get(id);
  if (!def) throw new Error(`Card not found in registry: ${id}`);
  return def;
}

export function hasCard(protocol: ProtocolName, value: CardValue): boolean {
  return cards.has(cardId(protocol, value));
}

export function listCards(): readonly CardDef[] {
  return [...cards.values()];
}

export function clearRegistry(): void {
  cards.clear();
}
