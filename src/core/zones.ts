import type { CardInstance, CardInstanceId, GameState, PlayerId } from './types.js';

export const ZONE = {
  supply: 'supply', hand: 'hand', discard: 'discard',
  tableau: 'tableau', goods: 'goods', selection: 'selection',
} as const;

export function cardsIn(state: GameState, zone: string, owner?: PlayerId | null): CardInstance[] {
  return Object.values(state.cards).filter(
    c => c.zone === zone && (owner === undefined || c.owner === owner));
}

export function countIn(state: GameState, zone: string, owner?: PlayerId | null): number {
  return cardsIn(state, zone, owner).length;
}

export interface MoveOptions {
  owner?: PlayerId | null;
  attachedTo?: CardInstanceId;
  faceDown?: boolean;
  /** Guard: reject the move unless the card is currently here. */
  expectFromZone?: string;
  /** Guard: reject the move unless the card is currently owned by this player. */
  expectOwner?: PlayerId | null;
}

/** The only sanctioned way to change a card's location. Validates before mutating. */
export function moveCard(
  state: GameState, instanceId: CardInstanceId, toZone: string, opts: MoveOptions = {},
): GameState {
  const card = state.cards[instanceId];
  if (!card) throw new Error(`unknown card instance: ${instanceId}`);
  if (opts.expectFromZone !== undefined && card.zone !== opts.expectFromZone)
    throw new Error(`${instanceId} is in "${card.zone}", expected "${opts.expectFromZone}"`);
  if (opts.expectOwner !== undefined && card.owner !== opts.expectOwner)
    throw new Error(`${instanceId} is owned by ${card.owner}, expected ${opts.expectOwner}`);

  const moved: CardInstance = {
    ...card,
    zone: toZone,
    owner: opts.owner !== undefined ? opts.owner : card.owner,
    faceDown: opts.faceDown !== undefined ? opts.faceDown : card.faceDown,
  };
  if (opts.attachedTo !== undefined) moved.attachedTo = opts.attachedTo;
  else delete moved.attachedTo;

  return { ...state, cards: { ...state.cards, [instanceId]: moved } };
}
