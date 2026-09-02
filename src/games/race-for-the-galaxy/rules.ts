import type { GameState, PlayerId } from '../../core/types.js';
import { ZONE, cardsIn } from '../../core/zones.js';
import { card } from './cards.js';
import type { RaceCard } from './types.js';

export function tableauCards(state: GameState, pid: PlayerId): RaceCard[] {
  return cardsIn(state, ZONE.tableau, pid).map(c => card(c.defId));
}

export function handSize(state: GameState, pid: PlayerId): number {
  return cardsIn(state, ZONE.hand, pid).length;
}

export function vpChips(state: GameState, pid: PlayerId): number {
  const chips = (state.gameData.vpChips as Record<string, number>) ?? {};
  return chips[pid] ?? 0;
}

/** Total military available this settle phase, including negative contributions. */
export function militaryStrength(state: GameState, pid: PlayerId): number {
  let total = 0;
  for (const c of tableauCards(state, pid))
    for (const p of c.powers)
      if (p.phase === 'settle' && p.effectType === 'militaryStrength' && !p.conditions)
        total += p.value ?? 0;
  return total;
}

export function developmentCostReduction(state: GameState, pid: PlayerId): number {
  let r = 0;
  for (const c of tableauCards(state, pid))
    for (const p of c.powers)
      if (p.phase === 'develop' && p.effectType === 'developmentCostReduction') r += p.value ?? 0;
  return r;
}

export function canDevelop(state: GameState, pid: PlayerId, defId: string): string | null {
  const c = card(defId);
  if (c.cardType !== 'development') return 'That card is not a development.';
  if (tableauCards(state, pid).some(t => t.cardId === defId))
    return 'You already have that development in your tableau.';
  const cost = Math.max(0, (c.cost ?? 0) - developmentCostReduction(state, pid));
  if (handSize(state, pid) - 1 < cost) return 'Not enough cards in hand to pay for that.';
  return null;
}

export function canSettle(state: GameState, pid: PlayerId, defId: string): string | null {
  const c = card(defId);
  if (c.cardType !== 'world' || !c.world) return 'That card is not a world.';
  if (c.world.settlementMode === 'military') {
    if (militaryStrength(state, pid) < (c.world.defense ?? 0))
      return 'Your military is not strong enough to conquer that world.';
    return null;
  }
  if (handSize(state, pid) - 1 < (c.world.settleCost ?? 0))
    return 'Not enough cards in hand to pay for that world.';
  return null;
}

/** Single authoritative score. Never stored, always derived. */
export function calculateScore(state: GameState, pid: PlayerId): number {
  let vp = 0;
  for (const c of tableauCards(state, pid)) vp += c.victoryPoints ?? 0;
  vp += vpChips(state, pid);
  vp += endGameBonus(state, pid);
  return vp;
}

/** Generic predicate match for endGameVpPerCard targets. */
function matches(c: RaceCard, target: Record<string, unknown>): boolean {
  if (target.cardId && c.cardId !== target.cardId) return false;
  if (target.cardType && c.cardType !== target.cardType) return false;
  if (target.isSixCostDevelopment && !c.isSixCostDevelopment) return false;
  if (target.settlementMode && c.world?.settlementMode !== target.settlementMode) return false;
  if (target.productionMode && c.world?.productionMode !== target.productionMode) return false;
  if (target.resourceType && c.world?.resourceType !== target.resourceType) return false;
  if (target.hasPowerInPhase && !c.powers.some(p => p.phase === target.hasPowerInPhase)) return false;
  if (target.hasTradePower && !c.powers.some(p => p.effectType === 'tradeBonus')) return false;
  const traits = target.traits as string[] | undefined;
  if (traits && !traits.every(t => c.traits.includes(t))) return false;
  return true;
}

export function endGameBonus(state: GameState, pid: PlayerId): number {
  const tableau = tableauCards(state, pid);
  let total = 0;
  for (const scorer of tableau) {
    for (const p of scorer.powers) {
      if (p.phase !== 'endGame') continue;
      if (p.effectType === 'specialScoring') {
        total += resolveSpecialScoring(state, pid, p.specialEffectId ?? '', p.value ?? 0);
        continue;
      }
      const target = p.target ?? {};
      // Rulebook: a card scores in only one category per 6-cost development.
      const counted = new Set<string>();
      for (const c of tableau) {
        if (counted.has(c.cardId)) continue;
        if (matches(c, target)) { counted.add(c.cardId); total += p.value ?? 0; }
      }
    }
  }
  return total;
}

export function resolveSpecialScoring(
  state: GameState, pid: PlayerId, id: string, value: number,
): number {
  switch (id) {
    case 'score-total-military':
      // Counts negative military; excludes specialized/temporary military.
      return value * Math.max(0, militaryStrength(state, pid));
    case 'score-per-three-vp-chips':
      return value * Math.floor(vpChips(state, pid) / 3);
    default:
      return 0;
  }
}
