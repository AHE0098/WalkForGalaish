import { useEffect, useState } from 'react';

export interface CardFace {
  cardId: string; name: string; cardType: 'world' | 'development';
  isStartWorld: boolean; isSixCostDevelopment: boolean;
  cost: number | null; victoryPoints: number | null;
  world: null | {
    settlementMode: 'military' | 'payment';
    defense: number | null; settleCost: number | null;
    productionMode: 'production' | 'windfall' | 'none';
    resourceType: 'novelty' | 'rare' | 'genes' | 'alien' | null;
    isRebel: boolean; isAlien: boolean;
  };
  traits: string[];
  powers: Array<{ phase: string; effectType: string; value?: number; vpGained?: number;
                  cardsDrawn?: number; goodsConsumed?: number; times?: number;
                  conditions?: Record<string, unknown> }>;
}

let cache: Record<string, CardFace> | null = null;

export function useCardDb(gameId = 'race-for-the-galaxy') {
  const [db, setDb] = useState<Record<string, CardFace> | null>(cache);
  useEffect(() => {
    if (cache) return;
    fetch(`/api/games/${gameId}/cards`).then(r => r.json()).then(d => {
      cache = Object.fromEntries((d.cards as CardFace[]).map(c => [c.cardId, c]));
      setDb(cache);
    }).catch(() => setDb({}));
  }, [gameId]);
  return db;
}

const PHASE_NUM: Record<string, string> = {
  explore: 'I', develop: 'II', settle: 'III', consume: 'IV', produce: 'V', endGame: '★',
};

/** Turn a structured power into a short readable line. No card text is reproduced. */
export function powerLine(p: CardFace['powers'][number]): string {
  const n = p.value ?? p.cardsDrawn ?? p.vpGained ?? 0;
  const kind = (p.conditions?.resourceType as string) ?? '';
  const vs = (p.conditions?.targetTrait as string) ?? '';
  const map: Record<string, string> = {
    exploreDrawBonus: `draw +${n}`,
    exploreKeepBonus: `keep +${n}`,
    exploreDrawAndKeepBonus: `draw +${n}, keep +1`,
    drawAtDevelopStart: `draw ${n}`,
    developmentCostReduction: `developments cost −${n}`,
    drawAfterDevelopment: `draw ${n} after developing`,
    militaryStrength: `${n >= 0 ? '+' : ''}${n} military${vs ? ` vs ${vs}` : ''}${kind ? ` (${kind})` : ''}`,
    settleCostReduction: `worlds cost −${n}${kind ? ` (${kind})` : ''}`,
    settleCostToZeroByDiscardingThisCard: 'discard this: a world costs 0',
    temporaryMilitaryByDiscardingThisCard: `discard this: +${n} military`,
    payForMilitary: 'may pay for a military world',
    drawAfterSettling: `draw ${n} after settling`,
    consumeGoods: `consume ${p.goodsConsumed ?? 1}${kind ? ` ${kind}` : ''} → ${p.vpGained ?? 0} VP${p.cardsDrawn ? ` + ${p.cardsDrawn} card` : ''}`,
    consumeAllGoods: 'consume all goods → VP',
    consumeGoodForTradePrice: 'consume a good for cards',
    discardHandForVp: `discard up to ${p.times ?? 1} cards → 1 VP each`,
    tradeBonus: `+${n} cards when selling${kind ? ` ${kind}` : ''}`,
    drawIfLucky: 'name a number, keep a match',
    drawCards: `draw ${n}`,
    produceGoodOnThisWorld: 'produces a good',
    produceWindfallGood: `produce on a windfall world${kind ? ` (${kind})` : ''}`,
    drawOnProducedGoodHere: `draw ${n} when this produces`,
    drawPerGoodOfKindProduced: `draw per ${kind} produced`,
    drawPerDifferentKindProduced: 'draw per different kind produced',
    drawIfMostRareProduced: 'draw if you produced the most rare',
    drawPerWorldOfKind: `draw per ${kind} world`,
    endGameVpPerCard: `${n} VP per matching card`,
    endGameVpPerNamedCard: `${n} VP for a named card`,
    specialScoring: 'special end-game scoring',
  };
  return `${PHASE_NUM[p.phase] ?? ''} ${map[p.effectType] ?? p.effectType}`.trim();
}

/**
 * The printed number and how the game draws it:
 * developments use a diamond, worlds a circle, military worlds a red circle.
 * Production worlds fill the circle with the good's colour; windfall worlds
 * put that colour in a halo around it.
 */
export interface CostFace {
  value: number | string;
  shape: 'diamond' | 'circle';
  military: boolean;
  fill: string | null;   // solid colour = production world
  halo: string | null;   // ring colour = windfall world
}

export function costFace(c: CardFace): CostFace {
  if (c.cardType === 'development')
    return { value: c.cost ?? '–', shape: 'diamond', military: false, fill: null, halo: null };
  const w = c.world!;
  const res = w.resourceType;
  return {
    value: (w.settlementMode === 'military' ? w.defense : w.settleCost) ?? '–',
    shape: 'circle',
    military: w.settlementMode === 'military',
    fill: w.productionMode === 'production' ? res : null,
    halo: w.productionMode === 'windfall' ? res : null,
  };
}

export const PHASE_ROWS = ['explore', 'develop', 'settle', 'consume', 'produce'] as const;
export const PHASE_NUMERAL: Record<string, string> = {
  explore: 'I', develop: 'II', settle: 'III', consume: 'IV', produce: 'V', endGame: '★',
};

/** Group powers into the fixed I–V rows the printed cards use, plus end-game. */
export function powersByPhase(c: CardFace) {
  const rows = PHASE_ROWS.map(phase => ({
    phase,
    numeral: PHASE_NUMERAL[phase]!,
    lines: c.powers.filter(p => p.phase === phase).map(powerLine),
  }));
  const endGame = c.powers.filter(p => p.phase === 'endGame').map(powerLine);
  return { rows, endGame };
}
