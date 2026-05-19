import { clearRegistry, registerCard, type CardDef } from "../../src/cards/api.js";

export function resetCardRegistry(): void {
  clearRegistry();
}

/**
 * Register a synthetic CardDef under any cardId of the form "<protocol>-<value>".
 * Tests use this to plug in deterministic mock effects/passives.
 */
export function registerMockCard(def: CardDef): void {
  registerCard(def);
}
