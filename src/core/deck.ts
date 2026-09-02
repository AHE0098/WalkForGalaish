import type { CardDefinition, CardInstance, GameState, Rng } from './types.js';
import { ZONE, cardsIn, moveCard } from './zones.js';

/** Expand definitions x quantity into uniquely identified physical instances. */
export function buildInstances(defs: CardDefinition[]): Record<string, CardInstance> {
  const out: Record<string, CardInstance> = {};
  for (const def of defs) {
    if (!Number.isInteger(def.quantity) || def.quantity < 1)
      throw new Error(`${def.id}: quantity must be an integer >= 1`);
    for (let i = 1; i <= def.quantity; i++) {
      const instanceId = `${def.id}#${String(i).padStart(3, '0')}`;
      if (out[instanceId]) throw new Error(`duplicate instance id: ${instanceId}`);
      out[instanceId] = { instanceId, defId: def.id, zone: ZONE.supply, owner: null, faceDown: true };
    }
  }
  return out;
}

/** Supply order is an explicit list so draws are deterministic under a seed. */
export function shuffleSupply(state: GameState, rng: Rng): GameState {
  const order = rng.shuffle(cardsIn(state, ZONE.supply).map(c => c.instanceId));
  return { ...state, gameData: { ...state.gameData, supplyOrder: order } };
}

function supplyOrder(state: GameState): string[] {
  return (state.gameData.supplyOrder as string[] | undefined) ?? [];
}

/** Reshuffle the discard pile into the supply. Goods on worlds are not touched. */
export function reshuffleDiscard(state: GameState, rng: Rng): GameState {
  let next = state;
  for (const c of cardsIn(state, ZONE.discard))
    next = moveCard(next, c.instanceId, ZONE.supply, { owner: null, faceDown: true });
  const order = rng.shuffle(cardsIn(next, ZONE.supply).map(c => c.instanceId));
  return { ...next, gameData: { ...next.gameData, supplyOrder: order }, log: [...next.log, 'reshuffled discard into supply'] };
}

export interface DrawResult { state: GameState; drawn: string[]; }

/** Draw n from the supply, reshuffling the discard if the supply runs dry. */
export function draw(state: GameState, n: number, rng: Rng): DrawResult {
  let next = state;
  const drawn: string[] = [];
  for (let i = 0; i < n; i++) {
    let order = supplyOrder(next);
    if (order.length === 0) {
      if (cardsIn(next, ZONE.discard).length === 0) break; // deck and discard both empty
      next = reshuffleDiscard(next, rng);
      order = supplyOrder(next);
      if (order.length === 0) break;
    }
    const [id, ...rest] = order;
    next = { ...next, gameData: { ...next.gameData, supplyOrder: rest } };
    drawn.push(id as string);
  }
  return { state: next, drawn };
}

/** Draw straight into a player's hand. */
export function dealToHand(state: GameState, playerId: string, n: number, rng: Rng): DrawResult {
  const r = draw(state, n, rng);
  let next = r.state;
  for (const id of r.drawn)
    next = moveCard(next, id, ZONE.hand, { owner: playerId, faceDown: false });
  return { state: next, drawn: r.drawn };
}

export function supplyCount(state: GameState): number { return supplyOrder(state).length; }
export function discardCount(state: GameState): number { return cardsIn(state, ZONE.discard).length; }
