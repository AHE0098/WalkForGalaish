import type { GameState, PlayerId } from '../../core/types.js';
import { ZONE, cardsIn } from '../../core/zones.js';
import { card } from './cards.js';
import type { RaceCard, RacePower } from './types.js';

export type ActionId = string;

export function roundActions(state: GameState): Record<PlayerId, ActionId> {
  return (state.gameData.roundActions as Record<PlayerId, ActionId>) ?? {};
}
export function chose(state: GameState, pid: PlayerId, action: ActionId): boolean {
  return roundActions(state)[pid] === action;
}

export function tableauInstances(state: GameState, pid: PlayerId) {
  return cardsIn(state, ZONE.tableau, pid);
}
export function tableauCards(state: GameState, pid: PlayerId): RaceCard[] {
  return tableauInstances(state, pid).map(c => card(c.defId));
}
export function handSize(state: GameState, pid: PlayerId): number {
  return cardsIn(state, ZONE.hand, pid).length;
}
export function vpChips(state: GameState, pid: PlayerId): number {
  return ((state.gameData.vpChips as Record<string, number>) ?? {})[pid] ?? 0;
}
export function vpPool(state: GameState): number {
  return (state.gameData.vpPool as number) ?? 0;
}

/**
 * Effects that last only for the current Settle phase. Keyed by phaseId so they
 * cannot leak into a later phase, exactly like the action ledger.
 */
function phaseFlag<T>(state: GameState, bag: string, pid: PlayerId, fallback: T): T {
  const all = (state.gameData[bag] as Record<string, Record<string, T>>) ?? {};
  return all[state.phaseId]?.[pid] ?? fallback;
}
export function setPhaseFlag<T>(
  state: GameState, bag: string, pid: PlayerId, value: T,
): GameState {
  const here = { ...(((state.gameData[bag] as Record<string, Record<string, T>>) ?? {})[state.phaseId] ?? {}) };
  here[pid] = value;
  return { ...state, gameData: { ...state.gameData, [bag]: { [state.phaseId]: here } } };
}

/** Military granted this phase by discarding a card, e.g. New Military Tactics. */
export function temporaryMilitary(state: GameState, pid: PlayerId): number {
  return phaseFlag<number>(state, 'tempMilitary', pid, 0);
}
/** A Colony Ship has been spent: the next non-military world costs nothing. */
export function hasFreeSettle(state: GameState, pid: PlayerId): boolean {
  return phaseFlag<boolean>(state, 'freeSettle', pid, false);
}

/** Every power in a player's tableau, in one flat list. */
function powers(state: GameState, pid: PlayerId, phase: RacePower['phase']): RacePower[] {
  return tableauCards(state, pid).flatMap(c => c.powers.filter(p => p.phase === phase));
}

export function goodsOn(state: GameState, worldInstanceId: string) {
  return Object.values(state.cards)
    .filter(c => c.zone === ZONE.goods && c.attachedTo === worldInstanceId);
}

/** Goods a player holds, with the kind taken from the world they sit on. */
export function playerGoods(state: GameState, pid: PlayerId) {
  return tableauInstances(state, pid).flatMap(w => {
    const kind = card(w.defId).world?.resourceType ?? null;
    return goodsOn(state, w.instanceId).map(g => ({ good: g, kind, world: w.instanceId }));
  });
}

// ---------------------------------------------------------------- explore

export function exploreDraw(state: GameState, pid: PlayerId): number {
  let n = 2;
  if (chose(state, pid, 'explore-5')) n += 5;
  if (chose(state, pid, 'explore-1-1')) n += 1;
  for (const p of powers(state, pid, 'explore')) {
    if (p.effectType === 'exploreDrawBonus') n += p.value ?? 0;
    if (p.effectType === 'exploreDrawAndKeepBonus') n += p.drawBonus ?? p.value ?? 0;
  }
  return n;
}

export function exploreKeep(state: GameState, pid: PlayerId): number {
  let n = 1;
  if (chose(state, pid, 'explore-1-1')) n += 1;
  for (const p of powers(state, pid, 'explore')) {
    if (p.effectType === 'exploreKeepBonus') n += p.value ?? 0;
    if (p.effectType === 'exploreDrawAndKeepBonus') n += p.keepBonus ?? 1;
  }
  return n;
}

// ---------------------------------------------------------------- develop

export function developCost(state: GameState, pid: PlayerId, c: RaceCard): number {
  let cost = c.cost ?? 0;
  for (const p of powers(state, pid, 'develop'))
    if (p.effectType === 'developmentCostReduction') cost -= p.value ?? 0;
  if (chose(state, pid, 'develop')) cost -= 1;                 // Develop action bonus
  return Math.max(0, cost);
}

export function canDevelop(state: GameState, pid: PlayerId, defId: string): string | null {
  const c = card(defId);
  if (c.cardType !== 'development') return 'Not a development.';
  if (tableauCards(state, pid).some(t => t.cardId === defId))
    return 'Already in your tableau.';
  const cost = developCost(state, pid, c);
  if (handSize(state, pid) - 1 < cost) return `Costs ${cost}; not enough cards to pay.`;
  return null;
}

// ---------------------------------------------------------------- settle

export function militaryStrength(state: GameState, pid: PlayerId, target?: RaceCard): number {
  let total = temporaryMilitary(state, pid);
  for (const p of powers(state, pid, 'settle')) {
    if (p.effectType !== 'militaryStrength' && p.effectType !== 'militaryStrengthVsTrait') continue;
    const cond = p.conditions ?? {};
    if (cond.targetTrait && !target?.traits.includes(String(cond.targetTrait))) continue;
    if (cond.resourceType && target?.world?.resourceType !== cond.resourceType) continue;
    total += p.value ?? 0;
  }
  return total;
}

/** A Colony Ship cannot place an Alien production or windfall world. */
export function colonyShipAllows(c: RaceCard): boolean {
  const w = c.world;
  if (!w) return false;
  return !(w.resourceType === 'alien' && w.productionMode !== 'none');
}

export function settleCost(state: GameState, pid: PlayerId, c: RaceCard): number {
  if (c.world?.settlementMode !== 'payment') return 0;
  if (hasFreeSettle(state, pid) && colonyShipAllows(c)) return 0;
  let cost = c.world.settleCost ?? 0;
  for (const p of powers(state, pid, 'settle')) {
    if (p.effectType !== 'settleCostReduction') continue;
    const cond = p.conditions ?? {};
    if (cond.resourceType && c.world.resourceType !== cond.resourceType) continue;
    cost -= p.value ?? 0;
  }
  return Math.max(0, cost);
}

/** Does this player hold a "pay for military" power, and may it target this world? */
export function payForMilitaryCost(
  state: GameState, pid: PlayerId, c: RaceCard,
): number | null {
  const w = c.world;
  if (!w || w.settlementMode !== 'military') return null;
  // Never allowed against an Alien production or windfall world.
  if (w.resourceType === 'alien' && w.productionMode !== 'none') return null;
  const has = tableauCards(state, pid).some(t =>
    t.powers.some(p => p.phase === 'settle' && p.effectType === 'payForMilitary'));
  if (!has) return null;
  let cost = (w.defense ?? 0) - 1;
  // Cost discounts combine with it; Military never does.
  for (const p of tableauCards(state, pid).flatMap(t => t.powers)) {
    if (p.phase !== 'settle' || p.effectType !== 'settleCostReduction') continue;
    if (p.conditions?.resourceType && p.conditions.resourceType !== w.resourceType) continue;
    cost -= p.value ?? 0;
  }
  if (hasFreeSettle(state, pid) && colonyShipAllows(c)) cost = 0;
  return Math.max(0, cost);
}

export function canSettle(state: GameState, pid: PlayerId, defId: string): string | null {
  const c = card(defId);
  if (c.cardType !== 'world' || !c.world) return 'Not a world.';
  if (c.world.settlementMode === 'military') {
    const mil = militaryStrength(state, pid, c);
    const need = c.world.defense ?? 0;
    if (mil >= need) return null;
    const pay = payForMilitaryCost(state, pid, c);
    if (pay !== null && handSize(state, pid) - 1 >= pay) return null;
    return `Needs ${need} military; you have ${mil}.`;
  }
  const cost = settleCost(state, pid, c);
  if (handSize(state, pid) - 1 < cost) return `Costs ${cost}; not enough cards to pay.`;
  return null;
}

/** What it costs to put this card down right now, or null if it cannot be played. */
export function priceOf(state: GameState, pid: PlayerId, defId: string, phase: string): number | null {
  const c = card(defId);
  if (phase === 'develop') return c.cardType === 'development' ? developCost(state, pid, c) : null;
  if (phase === 'settle') {
    if (c.cardType !== 'world') return null;
    if (c.world?.settlementMode !== 'military') return settleCost(state, pid, c);
    // Conquest is free; paying is only relevant when military is short.
    if (militaryStrength(state, pid, c) >= (c.world.defense ?? 0)) return 0;
    return payForMilitaryCost(state, pid, c) ?? 0;
  }
  return null;
}

// ---------------------------------------------------------------- scoring

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
    // Rulebook: for one 6-cost development, each card scores in only one category.
    const counted = new Set<string>();
    for (const p of scorer.powers) {
      if (p.phase !== 'endGame') continue;
      if (p.effectType === 'specialScoring') {
        total += specialScoring(state, pid, p.specialEffectId ?? '', p.value ?? 0);
        continue;
      }
      for (const c of tableau) {
        if (counted.has(c.cardId)) continue;
        if (matches(c, p.target ?? {})) { counted.add(c.cardId); total += p.value ?? 0; }
      }
    }
  }
  return total;
}

export function specialScoring(state: GameState, pid: PlayerId, id: string, value: number): number {
  switch (id) {
    case 'score-total-military':      return value * Math.max(0, militaryStrength(state, pid));
    case 'score-per-three-vp-chips':  return value * Math.floor(vpChips(state, pid) / 3);
    default: return 0;
  }
}

export function calculateScore(state: GameState, pid: PlayerId): number {
  let vp = 0;
  for (const c of tableauCards(state, pid)) vp += c.victoryPoints ?? 0;
  return vp + vpChips(state, pid) + endGameBonus(state, pid);
}

/** Breakdown for the results screen, so a player can see where points came from. */
export function scoreBreakdown(state: GameState, pid: PlayerId) {
  const cards = tableauCards(state, pid).reduce((n, c) => n + (c.victoryPoints ?? 0), 0);
  const chips = vpChips(state, pid);
  const bonus = endGameBonus(state, pid);
  return { cards, chips, bonus, total: cards + chips + bonus };
}
