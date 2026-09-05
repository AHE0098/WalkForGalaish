import { useEffect, useState } from 'react';
import type { Segment } from './glyphs.js';

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
let displayCache: any = null;

export function useCardDb(gameId = 'race-for-the-galaxy') {
  const [db, setDb] = useState<Record<string, CardFace> | null>(cache);
  useEffect(() => {
    if (cache) return;
    fetch(`/api/games/${gameId}/cards`).then(r => r.json()).then(d => {
      cache = Object.fromEntries((d.cards as CardFace[]).map(c => [c.cardId, c]));
      displayCache = d.display ?? null;
      setDb(cache);
    }).catch(() => setDb({}));
  }, [gameId]);
  return db;
}

/** The active game's display configuration, including its sort keys. */
export function useDisplay() {
  const db = useCardDb();
  return db ? displayCache : null;
}

const PHASE_NUM: Record<string, string> = {
  explore: 'I', develop: 'II', settle: 'III', consume: 'IV', produce: 'V', endGame: '★',
};

/**
 * Turn a structured power into drawable segments. Symbols replace words wherever
 * the printed card uses one: goods as coloured tokens, military as the same red
 * circle used for a world's defense.
 */
export function powerSegments(p: CardFace['powers'][number]): Segment[] {
  const n = p.value ?? p.cardsDrawn ?? p.vpGained ?? 0;
  const kind = (p.conditions?.resourceType as string) ?? '';
  const vs = (p.conditions?.targetTrait as string) ?? '';
  const txt = (v: string): Segment => ({ t: 'text', v });
  const good = (k: string): Segment => ({ t: 'good', kind: k });

  switch (p.effectType) {
    case 'militaryStrength':
    case 'militaryStrengthVsTrait':
      return [{ t: 'military', v: n }, ...(vs ? [txt(` vs ${vs}`)] : []),
              ...(kind ? [txt(' '), good(kind)] : [])];
    case 'temporaryMilitaryByDiscardingThisCard':
      return [txt('discard this: '), { t: 'military', v: n }];
    case 'exploreDrawBonus':      return [txt('draw '), { t: 'card', v: n }, txt(' extra')];
    case 'exploreKeepBonus':      return [txt('keep '), { t: 'card', v: n }, txt(' extra')];
    case 'exploreDrawAndKeepBonus':
      return [txt('draw '), { t: 'card', v: n }, txt(', keep '), { t: 'card', v: 1 }];
    case 'drawAtDevelopStart':    return [txt('draw '), { t: 'card', v: n }];
    case 'developmentCostReduction': return [txt('developments −'), { t: 'card', v: n }];
    case 'drawAfterDevelopment':  return [txt('draw '), { t: 'card', v: n }, txt(' after developing')];
    case 'settleCostReduction':
      return [txt('worlds −'), { t: 'card', v: n }, ...(kind ? [txt(' '), good(kind)] : [])];
    case 'settleCostToZeroByDiscardingThisCard':
      return [txt('discard this: a world costs nothing')];
    case 'payForMilitary':        return [txt('may pay for a military world')];
    case 'drawAfterSettling':     return [txt('draw '), { t: 'card', v: n }, txt(' after settling')];
    case 'consumeGoods': {
      const out: Segment[] = [txt('spend ')];
      for (let i = 0; i < (p.goodsConsumed ?? 1); i++) out.push(good(kind || 'any'));
      out.push(txt(' → '));
      if (p.vpGained) out.push({ t: 'vp', v: p.vpGained });
      if (p.cardsDrawn) { if (p.vpGained) out.push(txt(' + ')); out.push({ t: 'card', v: p.cardsDrawn }); }
      if (!p.vpGained && !p.cardsDrawn) out.push(txt('—'));
      return out;
    }
    case 'consumeAllGoods':       return [txt('spend all goods → '), { t: 'vp', v: 1 }, txt(' per extra')];
    case 'consumeGoodForTradePrice': return [txt('trade a good for '), { t: 'card', v: 0 }, txt('its price')];
    case 'discardHandForVp':
      return [txt('discard up to '), { t: 'card', v: p.times ?? 1 }, txt(' → '), { t: 'vp', v: 1 }, txt(' each')];
    case 'tradeBonus':
      return [txt('selling'), ...(kind ? [txt(' '), good(kind)] : []), txt(': +'), { t: 'card', v: n }];
    case 'drawIfLucky':           return [txt('name a number, keep a match')];
    case 'drawCards':             return [txt('draw '), { t: 'card', v: n }];
    case 'produceGoodOnThisWorld':
      return [txt('produces '), good(kind || 'any')];
    case 'produceWindfallGood':
      return [txt('produce on a windfall'), ...(kind ? [txt(' '), good(kind)] : [])];
    case 'drawOnProducedGoodHere':
      return [txt('draw '), { t: 'card', v: n }, txt(' when this produces')];
    case 'drawPerGoodOfKindProduced':
      return [txt('draw '), { t: 'card', v: n }, txt(' per '), good(kind)];
    case 'drawPerDifferentKindProduced':
      return [txt('draw '), { t: 'card', v: n }, txt(' per different good')];
    case 'drawIfMostRareProduced':
      return [txt('draw '), { t: 'card', v: n }, txt(' for most '), good('rare')];
    case 'drawPerWorldOfKind':
      return [txt('draw '), { t: 'card', v: n }, txt(' per '), good(kind), txt(' world')];
    case 'endGameVpPerCard':      return [{ t: 'vp', v: n }, txt(' per matching card')];
    case 'endGameVpPerNamedCard': return [{ t: 'vp', v: n }, txt(' for a named card')];
    case 'specialScoring':        return [txt('special end-game scoring')];
    default:                      return [txt(p.effectType)];
  }
}

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

/**
 * Shared images for a class of card, most specific first. Used only when no
 * individual artwork exists. Because the keys degrade — a genes windfall world
 * falls back to any windfall world, then to any world — a handful of broad
 * images already covers the whole set, and narrower ones can be added later
 * without moving anything.
 */
export function templateKeys(c: CardFace): string[] {
  if (c.cardType === 'development')
    return c.isSixCostDevelopment
      ? ['development-six', 'development']
      : ['development'];

  const w = c.world!;
  const base = w.settlementMode === 'military' ? 'military' : 'world';
  const mode = w.productionMode !== 'none' ? w.productionMode : null;
  const good = w.resourceType;

  const keys: string[] = [];
  if (mode && good) keys.push(`${base}-${mode}-${good}`, `world-${mode}-${good}`);
  if (good) keys.push(`good-${good}`);
  if (mode) keys.push(`${base}-${mode}`, `world-${mode}`);
  keys.push(base, 'world');
  return [...new Set(keys)];
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
    lines: c.powers.filter(p => p.phase === phase).map(powerSegments),
  }));
  const endGame = c.powers.filter(p => p.phase === 'endGame').map(powerSegments);
  return { rows, endGame };
}
