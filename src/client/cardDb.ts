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

/** The number printed in the card's circle, and what it means. */
export function costFace(c: CardFace): { value: number | string; kind: 'dev' | 'mil' | 'pay' } {
  if (c.cardType === 'development') return { value: c.cost ?? '–', kind: 'dev' };
  if (c.world?.settlementMode === 'military') return { value: c.world.defense ?? '–', kind: 'mil' };
  return { value: c.world?.settleCost ?? '–', kind: 'pay' };
}
