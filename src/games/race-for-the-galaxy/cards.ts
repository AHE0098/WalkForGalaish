import type { CardDefinition } from '../../core/types.js';
import type { RaceCard } from './types.js';
import data from './cards/race_for_the_galaxy_base_cards.json' with { type: 'json' };

const raw = data as unknown as { cards: RaceCard[]; enums: Record<string, string[]> };

export const RACE_CARDS: RaceCard[] = raw.cards;
export const RACE_ENUMS = raw.enums;

const byId = new Map(RACE_CARDS.map(c => [c.cardId, c]));
export function card(defId: string): RaceCard {
  const c = byId.get(defId);
  if (!c) throw new Error(`unknown Race card: ${defId}`);
  return c;
}

/** Wrap the game's own card records in the generic definition envelope. */
export const RACE_DEFINITIONS: CardDefinition[] = RACE_CARDS.map(c => ({
  id: c.cardId, name: c.name, quantity: c.quantity,
  payload: c as unknown as Record<string, unknown>,
}));

export const BASIC_START_WORLDS = RACE_CARDS.filter(c => c.isStartWorld).map(c => c.cardId);

export function printedVp(c: RaceCard): number { return c.victoryPoints ?? 0; }

export function settleCostOf(c: RaceCard): number | null {
  return c.world?.settlementMode === 'payment' ? c.world.settleCost : null;
}
export function defenseOf(c: RaceCard): number | null {
  return c.world?.settlementMode === 'military' ? c.world.defense : null;
}
