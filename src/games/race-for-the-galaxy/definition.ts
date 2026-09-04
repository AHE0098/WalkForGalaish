import type {
  ActionResult, GameDefinition, GameState, Playable, PlayerId, Rng,
} from '../../core/types.js';
import { ZONE, cardsIn, moveCard } from '../../core/zones.js';
import {
  buildInstances, dealToHand, draw, reshuffleDiscard, shuffleSupply, supplyIsLow,
} from '../../core/deck.js';
import { submitHiddenChoice } from '../../core/phases.js';
import { RACE_DEFINITIONS, BASIC_START_WORLDS, card } from './cards.js';
import {
  ACTION_CARDS, HAND_LIMIT, PHASE_ORDER, RESHUFFLE_AT, TABLEAU_END_SIZE, TRADE_PRICES,
  VP_PER_PLAYER,
} from './types.js';
import type { RaceCard } from './types.js';
import {
  canDevelop, canSettle, chose, developCost, exploreDraw, exploreKeep, goodsOn, handSize,
  militaryStrength, playerGoods, priceOf, settleCost, tableauCards, tableauInstances,
  vpChips, vpPool, calculateScore, scoreBreakdown,
} from './rules.js';

const currentPhase = (s: GameState) => s.phasesThisRound[s.phaseIndex] ?? null;

/**
 * Who has already taken their one action in the current step. Keyed by phaseId,
 * so it is impossible for a stale entry to leak into the next phase, and equally
 * impossible to play twice in one phase.
 */
function actedIn(state: GameState): string[] {
  const ledger = (state.gameData.acted as Record<string, string[]>) ?? {};
  return ledger[state.phaseId] ?? [];
}
function hasActed(state: GameState, playerId: PlayerId): boolean {
  return actedIn(state).includes(playerId);
}
function markActed(state: GameState, playerId: PlayerId): GameState {
  const ledger = { ...((state.gameData.acted as Record<string, string[]>) ?? {}) };
  const here = ledger[state.phaseId] ?? [];
  if (here.includes(playerId)) return state;
  // Only the current phase is retained; older entries cannot accumulate.
  return { ...state, gameData: { ...state.gameData,
    acted: { [state.phaseId]: [...here, playerId] } } };
}

function grantVp(state: GameState, pid: PlayerId, amount: number): GameState {
  const pool = vpPool(state);
  const given = Math.max(0, Math.min(amount, pool));
  if (given === 0) return state;
  const chips = { ...((state.gameData.vpChips as Record<string, number>) ?? {}) };
  chips[pid] = (chips[pid] ?? 0) + given;
  return { ...state, gameData: { ...state.gameData, vpChips: chips, vpPool: pool - given } };
}

function placeGood(state: GameState, pid: PlayerId, worldInstanceId: string, rng: Rng): GameState {
  const r = draw(state, 1, rng);
  let next = r.state;
  for (const id of r.drawn)
    next = moveCard(next, id, ZONE.goods,
      { owner: pid, attachedTo: worldInstanceId, faceDown: true });
  return next;
}

function drawToHand(state: GameState, pid: PlayerId, n: number, rng: Rng): GameState {
  return n > 0 ? dealToHand(state, pid, n, rng).state : state;
}

export const raceForTheGalaxy: GameDefinition = {
  id: 'race-for-the-galaxy',
  name: 'Race for the Galaxy',
  minPlayers: 2,
  maxPlayers: 4,
  cardDatabase: RACE_DEFINITIONS,
  phases: [
    { id: 'explore', label: 'I Explore', mode: 'simultaneous' },
    { id: 'develop', label: 'II Develop', mode: 'simultaneous' },
    { id: 'settle',  label: 'III Settle', mode: 'simultaneous' },
    { id: 'consume', label: 'IV Consume', mode: 'simultaneous' },
    { id: 'produce', label: 'V Produce',  mode: 'simultaneous' },
    { id: 'reshuffle', label: 'Reshuffle', mode: 'simultaneous' },
  ],

  setupGame(state, rng) {
    let next: GameState = { ...state, cards: buildInstances(RACE_DEFINITIONS) };
    next = shuffleSupply(next, rng);

    const starts = rng.shuffle(BASIC_START_WORLDS);
    const chips: Record<string, number> = {};
    next.players.forEach((p, i) => {
      const defId = starts[i] as string;
      const inst = Object.values(next.cards).find(c => c.defId === defId && c.zone === ZONE.supply);
      if (inst) {
        next = moveCard(next, inst.instanceId, ZONE.tableau, { owner: p.id, faceDown: false });
        next = { ...next, gameData: { ...next.gameData,
          supplyOrder: (next.gameData.supplyOrder as string[]).filter(id => id !== inst.instanceId) } };
        if (card(defId).startWorld?.startingWindfallGood)
          next = placeGood(next, p.id, inst.instanceId, rng);
      }
      chips[p.id] = 0;
      next = dealToHand(next, p.id, 6, rng).state; // deal 6, discard 2 in the opening step
    });

    return {
      ...next, status: 'playing', round: 1, phasesThisRound: [], phaseIndex: -1,
      gameData: { ...next.gameData, vpChips: chips, vpPool: VP_PER_PLAYER * next.players.length,
                  openingDiscard: true },
      log: [...next.log, `Game started. Discard 2 cards to begin.`],
    };
  },

  selectPhasesForRound(state) {
    const chosen = new Set<string>();
    for (const choice of Object.values(state.revealedChoices ?? {})) {
      const ac = ACTION_CARDS.find(a => a.id === choice);
      if (ac) chosen.add(ac.phase);
    }
    const phases: string[] = PHASE_ORDER.filter(p => chosen.has(p));
    // The table pauses together to rebuild the supply from the discard pile.
    if (state.gameData.reshuffleNeeded) phases.push('reshuffle');
    return phases;
  },

  /** Deal explore cards, and auto-resolve the phases that need no decisions. */
  onPhaseEnter(state, phase, rng) {
    let next = state;
    if (phase === 'explore') {
      for (const p of next.players) {
        const r = draw(next, exploreDraw(next, p.id), rng);
        next = r.state;
        for (const id of r.drawn)
          next = moveCard(next, id, ZONE.selection, { owner: p.id, faceDown: false });
      }
      const keepCounts: Record<string, number> = {};
      for (const p of next.players) keepCounts[p.id] = exploreKeep(next, p.id);
      return { ...next, gameData: { ...next.gameData, keepCounts },
               log: [...next.log, 'Explore: choose which cards to keep.'] };
    }

    if (phase === 'consume') {
      for (const p of next.players) next = resolveConsume(next, p.id, rng);
      return next;
    }

    if (phase === 'produce') return resolveProduce(next, rng);
    return next;
  },

  legalActions(state, playerId) {
    if (state.status !== 'playing') return [];
    if (state.gameData.openingDiscard) {
      const done = (state.gameData.openingDone as Record<string, boolean>) ?? {};
      return done[playerId] ? [] : ['DISCARD_CARDS'];
    }
    const phase = currentPhase(state);
    if (phase === null)
      return state.hiddenChoices[playerId] === undefined ? ['SELECT_ACTION_CARD'] : [];
    // One action per player per phase, full stop.
    if (hasActed(state, playerId)) return [];
    if (phase === 'reshuffle') return ['READY'];
    if (phase === 'explore') return ['KEEP_CARDS'];
    if (phase === 'develop' || phase === 'settle') return ['PLAY_CARD', 'PASS'];
    return ['READY'];
  },

  playability(state, playerId): Record<string, Playable> {
    const phase = currentPhase(state);
    const out: Record<string, Playable> = {};
    if (state.status !== 'playing') return out;
    const spent = hasActed(state, playerId);
    for (const inst of cardsIn(state, ZONE.hand, playerId)) {
      if (state.gameData.openingDiscard) { out[inst.instanceId] = { ok: true, cost: 0 }; continue; }
      if (phase !== 'develop' && phase !== 'settle') { out[inst.instanceId] = { ok: false }; continue; }
      if (spent) {
        out[inst.instanceId] = { ok: false, reason: `You have already acted this ${phase} phase.` };
        continue;
      }
      const reason = phase === 'develop'
        ? canDevelop(state, playerId, inst.defId)
        : canSettle(state, playerId, inst.defId);
      out[inst.instanceId] = reason
        ? { ok: false, reason }
        : { ok: true, cost: priceOf(state, playerId, inst.defId, phase) ?? 0 };
    }
    return out;
  },

  resolveAction(state, playerId, action, rng): ActionResult {
    if (state.status !== 'playing') return { ok: false, error: 'The game is not in progress.' };
    if (action.phaseId !== state.phaseId) return { ok: false, error: 'That action is out of date.' };
    const phase = currentPhase(state);
    if (!this.legalActions(state, playerId).includes(action.type))
      return { ok: false, error: `${action.type} is not available now.` };

    const ids = (key: string) => Array.isArray(action.payload?.[key])
      ? (action.payload![key] as string[]) : [];
    const ownedInHand = (id: string) => {
      const c = state.cards[id];
      return c && c.owner === playerId && c.zone === ZONE.hand;
    };

    switch (action.type) {
      case 'DISCARD_CARDS': {
        const chosen = ids('instanceIds');
        if (chosen.length !== 2) return { ok: false, error: 'Discard exactly 2 cards.' };
        let next = state;
        for (const id of chosen) {
          if (!ownedInHand(id)) return { ok: false, error: 'That card is not in your hand.' };
          next = moveCard(next, id, ZONE.discard, { owner: null, faceDown: true });
        }
        const done = { ...((next.gameData.openingDone as Record<string, boolean>) ?? {}) };
        done[playerId] = true;
        const everyone = next.players.every(p => done[p.id]);
        return { ok: true, state: { ...next, version: next.version + 1,
          gameData: { ...next.gameData, openingDone: done, openingDiscard: !everyone },
          log: [...next.log, `${name(next, playerId)} discarded 2 cards.`] } };
      }

      case 'SELECT_ACTION_CARD': {
        const choice = String(action.payload?.actionCard ?? '');
        if (!ACTION_CARDS.some(a => a.id === choice))
          return { ok: false, error: 'Unknown action card.' };
        return { ok: true, state: submitHiddenChoice(state, playerId, choice) };
      }

      case 'KEEP_CARDS': {
        const keep = ids('instanceIds');
        const allowed = exploreKeep(state, playerId);
        const pool = cardsIn(state, ZONE.selection, playerId);
        if (keep.length !== Math.min(allowed, pool.length))
          return { ok: false, error: `Keep exactly ${Math.min(allowed, pool.length)} card(s).` };
        let next = state;
        for (const c of pool) {
          const keeping = keep.includes(c.instanceId);
          next = moveCard(next, c.instanceId, keeping ? ZONE.hand : ZONE.discard,
            { owner: keeping ? playerId : null, faceDown: !keeping });
        }
        return { ok: true, state: markActed({ ...next, version: next.version + 1,
          log: [...next.log, `${name(next, playerId)} kept ${keep.length} card(s).`] }, playerId) };
      }

      case 'PLAY_CARD': {
        const instanceId = String(action.payload?.instanceId ?? '');
        if (!ownedInHand(instanceId)) return { ok: false, error: 'That card is not in your hand.' };
        const c = card(state.cards[instanceId]!.defId);
        const reason = phase === 'develop'
          ? canDevelop(state, playerId, c.cardId) : canSettle(state, playerId, c.cardId);
        if (reason) return { ok: false, error: reason };

        const payment = ids('payment');
        const cost = priceOf(state, playerId, c.cardId, phase!) ?? 0;
        if (payment.length !== cost)
          return { ok: false, error: `That costs ${cost} card(s); you offered ${payment.length}.` };

        let next = state;
        for (const pid of payment) {
          if (pid === instanceId) return { ok: false, error: 'A card cannot pay for itself.' };
          if (!ownedInHand(pid)) return { ok: false, error: 'Invalid payment card.' };
          next = moveCard(next, pid, ZONE.discard, { owner: null, faceDown: true });
        }
        next = moveCard(next, instanceId, ZONE.tableau,
          { owner: playerId, faceDown: false, expectFromZone: ZONE.hand, expectOwner: playerId });

        if (phase === 'settle' && c.world?.productionMode === 'windfall')
          next = placeGood(next, playerId, instanceId, rng);

        // "Draw after placing" powers already in the tableau, plus the action bonus.
        for (const pow of tableauCards(next, playerId).flatMap(t => t.powers)) {
          if (phase === 'develop' && pow.effectType === 'drawAfterDevelopment')
            next = drawToHand(next, playerId, pow.value ?? 1, rng);
          if (phase === 'settle' && pow.effectType === 'drawAfterSettling')
            next = drawToHand(next, playerId, pow.value ?? 1, rng);
        }
        if (phase === 'settle' && chose(next, playerId, 'settle'))
          next = drawToHand(next, playerId, 1, rng);

        return { ok: true, state: markActed({ ...next, version: next.version + 1,
          log: [...next.log, `${name(next, playerId)} played ${c.name}.`] }, playerId) };
      }

      case 'PASS':
        return { ok: true, state: markActed({ ...state, version: state.version + 1,
          log: [...state.log, `${name(state, playerId)} passed.`] }, playerId) };

      default:
        return { ok: false, error: `Unhandled action ${action.type}.` };
    }
  },

  onPhaseComplete(state, phase, rng) {
    let next = state;

    if (phase === 'reshuffle') {
      next = reshuffleDiscard(next, rng);
      return { ...next, gameData: { ...next.gameData, reshuffleNeeded: false } };
    }

    if (isLastGamePhase(next, phase)) {
      for (const p of next.players) {
        let over = handSize(next, p.id) - HAND_LIMIT;
        for (const c of cardsIn(next, ZONE.hand, p.id)) {
          if (over-- <= 0) break;
          next = moveCard(next, c.instanceId, ZONE.discard, { owner: null, faceDown: true });
        }
      }
      // Decide now, so the reshuffle step can be scheduled into the next round.
      const need = RESHUFFLE_AT + next.players.length * 2;
      if (supplyIsLow(next, need))
        next = { ...next, gameData: { ...next.gameData, reshuffleNeeded: true },
                 log: [...next.log, 'The supply is running low — reshuffle next round.'] };
    }
    return next;
  },

  calculateScore(state, playerId) { return calculateScore(state, playerId); },

  // No clock: players take as long as they like. Only players who have actually
  // dropped their connection are ever played for (see GameHost.tick).
  phaseTimeoutSeconds: 0,

  tokenKind(state, hostInstanceId) {
    const inst = state.cards[hostInstanceId];
    return inst ? card(inst.defId).world?.resourceType ?? null : null;
  },

  playerStats(state, playerId) {
    const goods = playerGoods(state, playerId);
    const byKind = (k: string) => goods.filter(g => g.kind === k).length;
    return {
      military: militaryStrength(state, playerId),
      goods: goods.length,
      novelty: byKind('novelty'), rare: byKind('rare'),
      genes: byKind('genes'), alien: byKind('alien'),
      tableau: tableauCards(state, playerId).length,
      hand: handSize(state, playerId),
    };
  },

  /** Used when a player is absent or the phase clock runs out. */
  autoAction(state, playerId) {
    const phaseId = state.phaseId;
    if (state.phaseIndex >= 0 && hasActed(state, playerId)) return null;
    if (state.gameData.openingDiscard) {
      const two = cardsIn(state, ZONE.hand, playerId).slice(0, 2).map(c => c.instanceId);
      return two.length === 2 ? { type: 'DISCARD_CARDS', phaseId, payload: { instanceIds: two } } : null;
    }
    const phase = currentPhase(state);
    if (phase === null)
      return { type: 'SELECT_ACTION_CARD', phaseId, payload: { actionCard: 'explore-1-1' } };
    if (phase === 'explore') {
      const pool = cardsIn(state, ZONE.selection, playerId);
      const keep = Math.min(exploreKeep(state, playerId), pool.length);
      return { type: 'KEEP_CARDS', phaseId,
               payload: { instanceIds: pool.slice(0, keep).map(c => c.instanceId) } };
    }
    if (phase === 'develop' || phase === 'settle') return { type: 'PASS', phaseId };
    return null; // everything else just needs readiness
  },

  scoreParts(state, playerId) {
    const b = scoreBreakdown(state, playerId);
    return { 'card VP': b.cards, 'VP chips': b.chips, 'end-game bonuses': b.bonus };
  },

  determineGameEnd(state) {
    if (vpPool(state) <= 0) return true;
    return state.players.some(p => tableauCards(state, p.id).length >= TABLEAU_END_SIZE);
  },

  display: {
    primaryStats: ['cost', 'victoryPoints'],
    badges: ['cardType', 'resourceType'],
    sortKeys: [
      { id: 'name', label: 'Name', path: 'name' },
      { id: 'type', label: 'Type', path: 'cardType' },
      { id: 'cost', label: 'Cost', path: 'cost' },
      { id: 'defense', label: 'Defense', path: 'world.defense' },
      { id: 'settle', label: 'Settle cost', path: 'world.settleCost' },
      { id: 'vp', label: 'VP', path: 'victoryPoints', direction: 'desc' },
      { id: 'good', label: 'Good', path: 'world.resourceType' },
      { id: 'mode', label: 'Production', path: 'world.productionMode' },
    ],
    symbolTokens: {
      novelty: 'resource-novelty', rare: 'resource-rare',
      genes: 'resource-genes', alien: 'resource-alien',
      world: 'type-world', development: 'type-development',
    },
    symbolFallbacks: {
      'resource-novelty': 'N', 'resource-rare': 'R', 'resource-genes': 'G', 'resource-alien': 'A',
      'type-world': 'W', 'type-development': 'D',
    },
  },
};

/** The last scoring phase of the round, ignoring the reshuffle step appended after it. */
function isLastGamePhase(state: GameState, phase: string): boolean {
  const real = state.phasesThisRound.filter(p => p !== 'reshuffle');
  return real[real.length - 1] === phase;
}

function name(state: GameState, pid: PlayerId): string {
  return state.players.find(p => p.id === pid)?.name ?? pid;
}

/** Goods a player holds of one kind, or of any kind. */
function goodsOfKind(state: GameState, pid: PlayerId, kind?: string) {
  return playerGoods(state, pid).filter(g => !kind || g.kind === kind);
}

function spendGood(state: GameState, good: { good: { instanceId: string } }): GameState {
  return moveCard(state, good.good.instanceId, ZONE.discard, { owner: null, faceDown: true });
}

/** Extra cards drawn when selling a good, from Trade powers in the tableau. */
function tradeBonusFor(state: GameState, pid: PlayerId, kind: string | null,
                       worldInstanceId: string): number {
  let extra = 0;
  for (const inst of tableauInstances(state, pid)) {
    for (const p of card(inst.defId).powers) {
      if (p.phase !== 'consume' || p.effectType !== 'tradeBonus') continue;
      const cond = p.conditions ?? {};
      if (cond.source === 'thisWorld' && inst.instanceId !== worldInstanceId) continue;
      if (cond.resourceType && cond.resourceType !== kind) continue;
      extra += p.cardsDrawn ?? p.value ?? 0;
    }
  }
  return extra;
}

function tradePrice(kind: string | null): number {
  return TRADE_PRICES[kind as keyof typeof TRADE_PRICES] ?? 0;
}

/** Sell one good for cards. Used by the Trade bonus and by trade-price powers. */
function sellGood(state: GameState, pid: PlayerId, rng: Rng,
                  opts: { applyTradePowers: boolean; kind?: string }): [GameState, string | null] {
  const goods = goodsOfKind(state, pid, opts.kind);
  if (!goods.length) return [state, null];
  // Sell the most valuable good available.
  const best = goods.slice().sort((a, b) => tradePrice(b.kind) - tradePrice(a.kind))[0]!;
  const cards = tradePrice(best.kind)
    + (opts.applyTradePowers ? tradeBonusFor(state, pid, best.kind, best.world) : 0);
  let next = spendGood(state, best);
  next = drawToHand(next, pid, cards, rng);
  return [next, `sold a ${best.kind} good for ${cards} cards`];
}

interface ConsumePower {
  power: ReturnType<typeof card>['powers'][number];
  /** VP per good, used to spend goods on the most valuable power first. */
  rank: number;
  specific: boolean;
}

/**
 * Consume is mandatory, so the engine resolves it. Powers are applied in a
 * sensible order rather than tableau order: kind-specific powers first, so a
 * generic power does not eat the good a specific one needed, then by how much
 * each pays per good.
 */
function resolveConsume(state: GameState, pid: PlayerId, rng: Rng): GameState {
  let next = state;
  const notes: string[] = [];
  const doubled = chose(next, pid, 'consume-2x');

  // The Trade action bonus sells one good before any consume power runs.
  if (chose(next, pid, 'consume-trade')) {
    const [after, note] = sellGood(next, pid, rng, { applyTradePowers: true });
    next = after;
    if (note) notes.push(note);
  }

  const powers: ConsumePower[] = [];
  for (const c of tableauCards(next, pid))
    for (const power of c.powers) {
      if (power.phase !== 'consume') continue;
      if (power.effectType === 'tradeBonus') continue;   // handled during a sale
      const perGood = (power.vpGained ?? 0) / Math.max(1, power.goodsConsumed ?? 1);
      powers.push({ power, rank: perGood, specific: !!power.conditions?.resourceType });
    }
  powers.sort((a, b) => Number(b.specific) - Number(a.specific) || b.rank - a.rank);

  for (const { power: pow } of powers) {
    if (pow.effectType === 'discardHandForVp') {
      const n = Math.min(pow.times ?? 1, handSize(next, pid));
      if (!n) continue;
      for (const h of cardsIn(next, ZONE.hand, pid).slice(0, n))
        next = moveCard(next, h.instanceId, ZONE.discard, { owner: null, faceDown: true });
      // Explicitly not doubled by the x2 bonus.
      next = grantVp(next, pid, n * (pow.vpGained ?? 1));
      notes.push(`discarded ${n} card(s) for VP`);
      continue;
    }

    if (pow.effectType === 'consumeGoodForTradePrice') {
      const [after, note] = sellGood(next, pid, rng,
        { applyTradePowers: pow.appliesTradePowers !== false });
      next = after;
      if (note) notes.push(note.replace('sold', 'traded'));
      continue;
    }

    if (pow.effectType === 'consumeAllGoods') {
      const all = playerGoods(next, pid);
      if (!all.length) continue;
      for (const g of all) next = spendGood(next, g);
      const vp = Math.max(0, all.length - 1);
      next = grantVp(next, pid, vp * (doubled ? 2 : 1));
      notes.push(`consumed all ${all.length} goods for ${vp} VP`);
      continue;
    }

    if (pow.effectType !== 'consumeGoods') continue;

    const kind = pow.conditions?.resourceType as string | undefined;
    const distinct = !!pow.conditions?.distinctKinds;
    const per = Math.max(1, pow.goodsConsumed ?? 1);
    const uses = Math.max(1, pow.times ?? 1);

    let spent = 0;
    for (let use = 0; use < uses; use++) {
      const available = goodsOfKind(next, pid, kind);
      let take: typeof available;
      if (distinct) {
        // One good of each of `per` different kinds, or the power cannot be used.
        const seen = new Set<string>();
        take = available.filter(g => g.kind && !seen.has(g.kind) && seen.add(g.kind));
        if (take.length < per) break;
        take = take.slice(0, per);
      } else {
        if (available.length < per) break;
        take = available.slice(0, per);
      }
      for (const g of take) next = spendGood(next, g);
      spent += take.length;
      const vp = (pow.vpGained ?? 0) * (doubled ? 2 : 1);
      if (vp) next = grantVp(next, pid, vp);
      if (pow.cardsDrawn) next = drawToHand(next, pid, pow.cardsDrawn, rng);
    }
    if (spent) notes.push(`consumed ${spent} good(s)`);
  }

  return notes.length
    ? { ...next, log: [...next.log, `${name(next, pid)}: ${notes.join(', ')}.`] }
    : next;
}

/**
 * Produce fills every empty production world, then applies windfall-producing
 * powers, then the draw powers that depend on what was actually produced.
 */
function resolveProduce(state: GameState, rng: Rng): GameState {
  let next = state;
  const producedKinds: Record<string, string[]> = {};

  const putGood = (pid: PlayerId, worldInstanceId: string): void => {
    const kind = card(next.cards[worldInstanceId]!.defId).world?.resourceType ?? null;
    next = placeGood(next, pid, worldInstanceId, rng);
    if (kind) (producedKinds[pid] ??= []).push(kind);
    for (const pow of card(next.cards[worldInstanceId]!.defId).powers)
      if (pow.phase === 'produce' && pow.effectType === 'drawOnProducedGoodHere')
        next = drawToHand(next, pid, pow.cardsDrawn ?? pow.value ?? 1, rng);
  };

  const emptyWorlds = (pid: PlayerId, mode: 'production' | 'windfall', kind?: string) =>
    tableauInstances(next, pid).filter(i => {
      const w = card(i.defId).world;
      return w?.productionMode === mode && (!kind || w.resourceType === kind)
        && goodsOn(next, i.instanceId).length === 0;
    });

  for (const p of next.players) {
    for (const inst of emptyWorlds(p.id, 'production')) putGood(p.id, inst.instanceId);

    // Powers that place a good on a windfall world.
    for (const c of tableauCards(next, p.id))
      for (const pow of c.powers) {
        if (pow.phase !== 'produce' || pow.effectType !== 'produceWindfallGood') continue;
        const kind = pow.conditions?.resourceType as string | undefined;
        const target = emptyWorlds(p.id, 'windfall', kind)[0];
        if (target) putGood(p.id, target.instanceId);
      }

    // The Produce action bonus: one more windfall good.
    if (chose(next, p.id, 'produce')) {
      const target = emptyWorlds(p.id, 'windfall')[0];
      if (target) putGood(p.id, target.instanceId);
    }
  }

  // Draw powers that depend on what was produced this phase.
  const rareCount = (pid: PlayerId) => (producedKinds[pid] ?? []).filter(k => k === 'rare').length;
  for (const p of next.players) {
    const mine = producedKinds[p.id] ?? [];
    for (const c of tableauCards(next, p.id))
      for (const pow of c.powers) {
        if (pow.phase !== 'produce') continue;
        const n = pow.cardsDrawn ?? pow.value ?? 1;
        switch (pow.effectType) {
          case 'drawCards':
            next = drawToHand(next, p.id, n, rng); break;
          case 'drawPerGoodOfKindProduced': {
            const kind = pow.conditions?.resourceType as string | undefined;
            next = drawToHand(next, p.id, n * mine.filter(k => k === kind).length, rng); break;
          }
          case 'drawPerDifferentKindProduced':
            next = drawToHand(next, p.id, n * new Set(mine).size, rng); break;
          case 'drawPerWorldOfKind': {
            const kind = pow.conditions?.resourceType as string | undefined;
            const worlds = tableauCards(next, p.id).filter(x =>
              x.world?.resourceType === kind && x.world?.productionMode !== 'none').length;
            next = drawToHand(next, p.id, n * worlds, rng); break;
          }
          case 'drawIfMostRareProduced': {
            const mineRare = rareCount(p.id);
            const beaten = next.players.some(o => o.id !== p.id && rareCount(o.id) >= mineRare);
            if (mineRare > 0 && !beaten) next = drawToHand(next, p.id, n, rng);
            break;
          }
        }
      }
  }

  const total = Object.values(producedKinds).reduce((a, b) => a + b.length, 0);
  return { ...next, log: [...next.log, `Produce: ${total} good(s) placed.`] };
}
