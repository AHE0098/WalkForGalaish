/** Race-specific shape of CardDefinition.payload. Core never reads these fields. */
export interface RaceWorld {
  settlementMode: 'military' | 'payment';
  defense: number | null;
  settleCost: number | null;
  productionMode: 'production' | 'windfall' | 'none';
  resourceType: 'novelty' | 'rare' | 'genes' | 'alien' | null;
  isRebel: boolean;
  isAlien: boolean;
}

export interface RacePower {
  phase: 'explore' | 'develop' | 'settle' | 'consume' | 'produce' | 'endGame';
  effectType: string;
  value?: number;
  vpGained?: number;
  cardsDrawn?: number;
  drawBonus?: number;
  keepBonus?: number;
  vpFormula?: string;
  appliesTradePowers?: boolean;
  goodsConsumed?: number;
  times?: number;
  optional?: boolean;
  conditions?: Record<string, unknown>;
  target?: Record<string, unknown>;
  specialEffectId?: string;
}

export interface RaceCard {
  cardId: string;
  name: string;
  quantity: number;
  cardType: 'world' | 'development';
  isStartWorld: boolean;
  isSixCostDevelopment: boolean;
  cost: number | null;
  victoryPoints: number | null;
  world: RaceWorld | null;
  startWorld: { startingWindfallGood: boolean } | null;
  traits: string[];
  powers: RacePower[];
  specialEffectIds: string[];
}

export const ACTION_CARDS = [
  { id: 'explore-5',    phase: 'explore', label: 'Explore: +5' },
  { id: 'explore-1-1',  phase: 'explore', label: 'Explore: +1,+1' },
  { id: 'develop',      phase: 'develop', label: 'Develop' },
  { id: 'settle',       phase: 'settle',  label: 'Settle' },
  { id: 'consume-trade',phase: 'consume', label: 'Consume: Trade' },
  { id: 'consume-2x',   phase: 'consume', label: 'Consume: 2x VP' },
  { id: 'produce',      phase: 'produce', label: 'Produce' },
] as const;

export const PHASE_ORDER = ['explore', 'develop', 'settle', 'consume', 'produce'] as const;
export const TRADE_PRICES = { novelty: 2, rare: 3, genes: 4, alien: 5 } as const;
export const HAND_LIMIT = 10;
export const VP_PER_PLAYER = 12;
export const TABLEAU_END_SIZE = 12;
