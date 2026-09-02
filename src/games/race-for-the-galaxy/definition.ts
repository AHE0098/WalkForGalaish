import type {
  ActionResult, GameDefinition, GameState, Playable, PlayerId, Rng,
} from '../../core/types.js';
import { ZONE, cardsIn, moveCard } from '../../core/zones.js';
import { buildInstances, dealToHand, draw, shuffleSupply } from '../../core/deck.js';
import { submitHiddenChoice } from '../../core/phases.js';
import { RACE_DEFINITIONS, BASIC_START_WORLDS, card } from './cards.js';
import {
  ACTION_CARDS, HAND_LIMIT, PHASE_ORDER, TABLEAU_END_SIZE, TRADE_PRICES, VP_PER_PLAYER,
} from './types.js';
import type { RaceCard } from './types.js';
import {
  canDevelop, canSettle, chose, developCost, exploreDraw, exploreKeep, goodsOn, handSize,
  playerGoods, priceOf, settleCost, tableauCards, tableauInstances, vpChips, vpPool,
  calculateScore, scoreBreakdown,
} from './rules.js';

const currentPhase = (s: GameState) => s.phasesThisRound[s.phaseIndex] ?? null;

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
    return PHASE_ORDER.filter(p => chosen.has(p));
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

    if (phase === 'produce') {
      for (const p of next.players) {
        for (const inst of tableauInstances(next, p.id)) {
          const c = card(inst.defId);
          if (c.world?.productionMode !== 'production') continue;
          if (goodsOn(next, inst.instanceId).length) continue;
          next = placeGood(next, p.id, inst.instanceId, rng);
          for (const pow of c.powers)
            if (pow.phase === 'produce' && pow.effectType === 'drawOnProducedGoodHere')
              next = drawToHand(next, p.id, pow.cardsDrawn ?? 1, rng);
        }
        // Produce action bonus: a good on one empty windfall world.
        if (chose(next, p.id, 'produce')) {
          const empty = tableauInstances(next, p.id).find(i =>
            card(i.defId).world?.productionMode === 'windfall' && !goodsOn(next, i.instanceId).length);
          if (empty) next = placeGood(next, p.id, empty.instanceId, rng);
        }
      }
      return { ...next, log: [...next.log, 'Produce: goods placed.'] };
    }
    return next;
  },

  legalActions(state, playerId) {
    if (state.status !== 'playing') return [];
    if (state.gameData.openingDiscard) return ['DISCARD_CARDS'];
    const phase = currentPhase(state);
    if (phase === null) return ['SELECT_ACTION_CARD'];
    if (phase === 'explore') return ['KEEP_CARDS'];
    if (phase === 'develop' || phase === 'settle') return ['PLAY_CARD', 'PASS'];
    return ['READY'];
  },

  playability(state, playerId): Record<string, Playable> {
    const phase = currentPhase(state);
    const out: Record<string, Playable> = {};
    if (state.status !== 'playing') return out;
    for (const inst of cardsIn(state, ZONE.hand, playerId)) {
      if (state.gameData.openingDiscard) { out[inst.instanceId] = { ok: true, cost: 0 }; continue; }
      if (phase !== 'develop' && phase !== 'settle') { out[inst.instanceId] = { ok: false }; continue; }
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
        return { ok: true, state: { ...next, version: next.version + 1,
          log: [...next.log, `${name(next, playerId)} kept ${keep.length} card(s).`] } };
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

        return { ok: true, state: { ...next, version: next.version + 1,
          log: [...next.log, `${name(next, playerId)} played ${c.name}.`] } };
      }

      case 'PASS':
        return { ok: true, state: { ...state, version: state.version + 1,
          log: [...state.log, `${name(state, playerId)} passed.`] } };

      default:
        return { ok: false, error: `Unhandled action ${action.type}.` };
    }
  },

  onPhaseComplete(state, phase, rng) {
    let next = state;
    if (phase === PHASE_ORDER[PHASE_ORDER.length - 1] || isLastPhase(next, phase)) {
      for (const p of next.players) {
        let over = handSize(next, p.id) - HAND_LIMIT;
        for (const c of cardsIn(next, ZONE.hand, p.id)) {
          if (over-- <= 0) break;
          next = moveCard(next, c.instanceId, ZONE.discard, { owner: null, faceDown: true });
        }
      }
    }
    return next;
  },

  calculateScore(state, playerId) { return calculateScore(state, playerId); },

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

function isLastPhase(state: GameState, phase: string): boolean {
  return state.phasesThisRound[state.phasesThisRound.length - 1] === phase;
}

function name(state: GameState, pid: PlayerId): string {
  return state.players.find(p => p.id === pid)?.name ?? pid;
}

/**
 * Consume is mandatory, so v1 resolves it automatically: sell first if the player
 * took the Trade bonus, then apply each consume power greedily.
 */
function resolveConsume(state: GameState, pid: PlayerId, rng: Rng): GameState {
  let next = state;
  const notes: string[] = [];

  if (chose(next, pid, 'consume-trade')) {
    const goods = playerGoods(next, pid);
    const best = goods.slice().sort((a, b) =>
      (TRADE_PRICES[b.kind as keyof typeof TRADE_PRICES] ?? 0) -
      (TRADE_PRICES[a.kind as keyof typeof TRADE_PRICES] ?? 0))[0];
    if (best) {
      const price = TRADE_PRICES[best.kind as keyof typeof TRADE_PRICES] ?? 0;
      next = moveCard(next, best.good.instanceId, ZONE.discard, { owner: null, faceDown: true });
      next = drawToHand(next, pid, price, rng);
      notes.push(`sold a ${best.kind} good for ${price} cards`);
    }
  }

  const doubled = chose(next, pid, 'consume-2x');
  for (const c of tableauCards(next, pid)) {
    for (const pow of c.powers) {
      if (pow.phase !== 'consume') continue;
      if (pow.effectType === 'discardHandForVp') {
        const n = Math.min(pow.times ?? 1, handSize(next, pid));
        for (const h of cardsIn(next, ZONE.hand, pid).slice(0, n))
          next = moveCard(next, h.instanceId, ZONE.discard, { owner: null, faceDown: true });
        if (n > 0) { next = grantVp(next, pid, n * (pow.vpGained ?? 1)); notes.push(`${n} cards for VP`); }
        continue;
      }
      if (pow.effectType !== 'consumeGoods' && pow.effectType !== 'consumeAllGoods') continue;

      const kind = pow.conditions?.resourceType as string | undefined;
      const available = playerGoods(next, pid).filter(g => !kind || g.kind === kind);
      if (!available.length) continue;

      const want = pow.effectType === 'consumeAllGoods'
        ? available.length
        : Math.min((pow.goodsConsumed ?? 1) * (pow.times ?? 1), available.length);
      const spend = available.slice(0, want);
      if (pow.effectType !== 'consumeAllGoods' && spend.length < (pow.goodsConsumed ?? 1)) continue;

      for (const g of spend)
        next = moveCard(next, g.good.instanceId, ZONE.discard, { owner: null, faceDown: true });

      const vp = pow.effectType === 'consumeAllGoods'
        ? Math.max(0, spend.length - 1)
        : (pow.vpGained ?? 0) * (spend.length / Math.max(1, pow.goodsConsumed ?? 1));
      if (vp > 0) next = grantVp(next, pid, Math.floor(vp * (doubled ? 2 : 1)));
      const cards = (pow.cardsDrawn ?? 0) * (spend.length / Math.max(1, pow.goodsConsumed ?? 1));
      if (cards > 0) next = drawToHand(next, pid, Math.floor(cards), rng);
      notes.push(`consumed ${spend.length} good(s)`);
    }
  }

  return notes.length
    ? { ...next, log: [...next.log, `${name(next, pid)}: ${notes.join(', ')}.`] }
    : next;
}
