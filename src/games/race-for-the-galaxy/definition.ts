import type {
  ActionResult, GameAction, GameDefinition, GameState, PlayerId, Rng,
} from '../../core/types.js';
import { ZONE, cardsIn, moveCard } from '../../core/zones.js';
import { buildInstances, dealToHand, draw, shuffleSupply } from '../../core/deck.js';
import { submitHiddenChoice } from '../../core/phases.js';
import { RACE_DEFINITIONS, BASIC_START_WORLDS, card } from './cards.js';
import {
  ACTION_CARDS, HAND_LIMIT, PHASE_ORDER, TABLEAU_END_SIZE, VP_PER_PLAYER,
} from './types.js';
import { calculateScore, canDevelop, canSettle, developmentCostReduction, handSize, tableauCards } from './rules.js';

function vpChipsMap(state: GameState): Record<string, number> {
  return { ...((state.gameData.vpChips as Record<string, number>) ?? {}) };
}

export const raceForTheGalaxy: GameDefinition = {
  id: 'race-for-the-galaxy',
  name: 'Race for the Galaxy',
  minPlayers: 2,
  maxPlayers: 4,
  cardDatabase: RACE_DEFINITIONS,
  phases: [
    { id: 'action', label: 'Choose action', mode: 'hidden-simultaneous' },
    { id: 'explore', label: 'I Explore', mode: 'simultaneous' },
    { id: 'develop', label: 'II Develop', mode: 'simultaneous' },
    { id: 'settle',  label: 'III Settle', mode: 'simultaneous' },
    { id: 'consume', label: 'IV Consume', mode: 'simultaneous' },
    { id: 'produce', label: 'V Produce',  mode: 'simultaneous' },
  ],

  setupGame(state, rng) {
    let next: GameState = { ...state, cards: buildInstances(RACE_DEFINITIONS) };
    next = shuffleSupply(next, rng);

    // One basic start world each; the rest are shuffled back into the supply.
    const starts = rng.shuffle(BASIC_START_WORLDS);
    const chips = vpChipsMap(next);
    next.players.forEach((p, i) => {
      const defId = starts[i] as string;
      const inst = Object.values(next.cards).find(c => c.defId === defId && c.zone === ZONE.supply);
      if (inst) {
        next = moveCard(next, inst.instanceId, ZONE.tableau, { owner: p.id, faceDown: false });
        next = {
          ...next,
          gameData: {
            ...next.gameData,
            supplyOrder: (next.gameData.supplyOrder as string[]).filter(id => id !== inst.instanceId),
          },
        };
        // Alpha Centauri and friends: a windfall good placed at setup.
        if (card(defId).startWorld?.startingWindfallGood) {
          const g = draw(next, 1, rng);
          next = g.state;
          for (const id of g.drawn)
            next = moveCard(next, id, ZONE.goods, { owner: p.id, attachedTo: inst.instanceId, faceDown: true });
        }
      }
      chips[p.id] = 0;
      const dealt = dealToHand(next, p.id, 6, rng); // deal 6, discard 2 in the first action phase
      next = dealt.state;
    });

    return {
      ...next,
      status: 'playing',
      round: 1,
      phasesThisRound: [],
      phaseIndex: -1,
      gameData: {
        ...next.gameData,
        vpChips: chips,
        vpPool: VP_PER_PLAYER * next.players.length,
        setupDiscardPending: true,
      },
      log: [...next.log, `game started with ${next.players.length} players`],
    };
  },

  /** Union of the phases chosen this round, always in canonical order. */
  selectPhasesForRound(state) {
    const chosen = new Set<string>();
    for (const choice of Object.values(state.revealedChoices ?? {})) {
      const ac = ACTION_CARDS.find(a => a.id === choice);
      if (ac) chosen.add(ac.phase);
    }
    return PHASE_ORDER.filter(p => chosen.has(p));
  },

  legalActions(state, playerId) {
    if (state.status !== 'playing') return [];
    const phase = state.phasesThisRound[state.phaseIndex] ?? 'action';
    if (phase === 'action') return ['SELECT_ACTION_CARD'];
    if (phase === 'develop') {
      const playable = cardsIn(state, ZONE.hand, playerId)
        .filter(c => canDevelop(state, playerId, c.defId) === null);
      return playable.length ? ['PLAY_CARD', 'PASS', 'READY'] : ['PASS', 'READY'];
    }
    if (phase === 'settle') {
      const playable = cardsIn(state, ZONE.hand, playerId)
        .filter(c => canSettle(state, playerId, c.defId) === null);
      return playable.length ? ['PLAY_CARD', 'PASS', 'READY'] : ['PASS', 'READY'];
    }
    if (phase === 'explore') return ['SELECT_CARD', 'READY'];
    return ['READY'];
  },

  resolveAction(state, playerId, action, rng): ActionResult {
    if (state.status !== 'playing') return { ok: false, error: 'The game is not in progress.' };
    if (action.phaseId !== state.phaseId) return { ok: false, error: 'That action is out of date.' };

    const phase = state.phasesThisRound[state.phaseIndex] ?? 'action';
    const allowed = this.legalActions(state, playerId);
    if (!allowed.includes(action.type))
      return { ok: false, error: `${action.type} is not legal during ${phase}.` };

    switch (action.type) {
      case 'SELECT_ACTION_CARD': {
        const choice = String(action.payload?.actionCard ?? '');
        if (!ACTION_CARDS.some(a => a.id === choice))
          return { ok: false, error: 'Unknown action card.' };
        return { ok: true, state: submitHiddenChoice(state, playerId, choice) };
      }

      case 'PLAY_CARD': {
        const instanceId = String(action.payload?.instanceId ?? '');
        const inst = state.cards[instanceId];
        if (!inst) return { ok: false, error: 'Unknown card.' };
        if (inst.owner !== playerId || inst.zone !== ZONE.hand)
          return { ok: false, error: 'That card is not in your hand.' };

        const c = card(inst.defId);
        const reason = phase === 'develop'
          ? canDevelop(state, playerId, inst.defId)
          : canSettle(state, playerId, inst.defId);
        if (reason) return { ok: false, error: reason };

        const payment = Array.isArray(action.payload?.payment)
          ? (action.payload!.payment as string[]) : [];
        const cost = phase === 'develop'
          ? Math.max(0, (c.cost ?? 0) - developmentCostReduction(state, playerId))
          : (c.world?.settlementMode === 'payment' ? c.world.settleCost ?? 0 : 0);
        if (payment.length !== cost)
          return { ok: false, error: `That costs ${cost} card(s); you offered ${payment.length}.` };

        let next = state;
        for (const pid of payment) {
          const p = next.cards[pid];
          if (!p || p.owner !== playerId || p.zone !== ZONE.hand)
            return { ok: false, error: 'Invalid payment card.' };
          if (pid === instanceId) return { ok: false, error: 'A card cannot pay for itself.' };
          next = moveCard(next, pid, ZONE.discard, { owner: null, faceDown: true });
        }
        next = moveCard(next, instanceId, ZONE.tableau, {
          owner: playerId, faceDown: false, expectFromZone: ZONE.hand, expectOwner: playerId,
        });

        // Windfall worlds receive a good the moment they are placed.
        if (phase === 'settle' && c.world?.productionMode === 'windfall') {
          const g = draw(next, 1, rng);
          next = g.state;
          for (const id of g.drawn)
            next = moveCard(next, id, ZONE.goods,
              { owner: playerId, attachedTo: instanceId, faceDown: true });
        }
        return { ok: true, state: { ...next, version: next.version + 1,
          log: [...next.log, `${playerId} placed ${c.name}`] } };
      }

      case 'PASS':
        return { ok: true, state: { ...state, version: state.version + 1 } };

      default:
        return { ok: false, error: `Unhandled action ${action.type}.` };
    }
  },

  onPhaseComplete(state, phase, rng) {
    let next = state;
    if (phase === 'produce') {
      for (const p of next.players) {
        for (const inst of cardsIn(next, ZONE.tableau, p.id)) {
          const c = card(inst.defId);
          if (c.world?.productionMode !== 'production') continue;
          const hasGood = Object.values(next.cards)
            .some(g => g.zone === ZONE.goods && g.attachedTo === inst.instanceId);
          if (hasGood) continue;
          const g = draw(next, 1, rng);
          next = g.state;
          for (const id of g.drawn)
            next = moveCard(next, id, ZONE.goods,
              { owner: p.id, attachedTo: inst.instanceId, faceDown: true });
        }
      }
      // End of round: discard down to the hand limit (oldest cards first).
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

  determineGameEnd(state) {
    const pool = (state.gameData.vpPool as number) ?? 0;
    if (pool <= 0) return true;
    return state.players.some(p => tableauCards(state, p.id).length >= TABLEAU_END_SIZE);
  },

  display: {
    primaryStats: ['cost', 'victoryPoints'],
    badges: ['cardType', 'resourceType'],
    symbolTokens: {
      novelty: 'resource-novelty', rare: 'resource-rare',
      genes: 'resource-genes', alien: 'resource-alien',
      world: 'type-world', development: 'type-development',
      explore: 'phase-explore', develop: 'phase-develop', settle: 'phase-settle',
      consume: 'phase-consume', produce: 'phase-produce',
    },
    symbolFallbacks: {
      'resource-novelty': 'N', 'resource-rare': 'R', 'resource-genes': 'G', 'resource-alien': 'A',
      'type-world': 'W', 'type-development': 'D',
      'phase-explore': 'I', 'phase-develop': 'II', 'phase-settle': 'III',
      'phase-consume': 'IV', 'phase-produce': 'V',
    },
  },
};
