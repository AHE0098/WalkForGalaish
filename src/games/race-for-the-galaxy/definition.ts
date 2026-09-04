import type {
  ActionResult, GameDefinition, GameState, Playable, PlayerId, PlayerOption, Rng,
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
  hasFreeSettle, militaryStrength, playerGoods, priceOf, setPhaseFlag, settleCost,
  tableauCards, tableauInstances, temporaryMilitary, vpChips, vpPool,
  calculateScore, scoreBreakdown,
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
export interface Pending {
  purpose: 'handLimit' | 'discardForVp';
  count: number;
  label: string;
  /** Carries the power's payout for discardForVp. */
  vpEach?: number;
}

function pendingFor(state: GameState, pid: PlayerId): Pending | null {
  return ((state.gameData.pending as Record<string, Pending>) ?? {})[pid] ?? null;
}
function setPending(state: GameState, pid: PlayerId, p: Pending | null): GameState {
  const all = { ...((state.gameData.pending as Record<string, Pending>) ?? {}) };
  if (p) all[pid] = p; else delete all[pid];
  return { ...state, gameData: { ...state.gameData, pending: all } };
}

/** Consume powers already spent this phase, so each is used at most once. */
function usedPowers(state: GameState, pid: PlayerId): string[] {
  const all = (state.gameData.consumeUsed as Record<string, Record<string, string[]>>) ?? {};
  return all[state.phaseId]?.[pid] ?? [];
}
function markPowerUsed(state: GameState, pid: PlayerId, key: string): GameState {
  const here = { ...((state.gameData.consumeUsed as Record<string, Record<string, string[]>>) ?? {})[state.phaseId] ?? {} };
  here[pid] = [...(here[pid] ?? []), key];
  return { ...state, gameData: { ...state.gameData, consumeUsed: { [state.phaseId]: here } } };
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
    { id: 'discard', label: 'Discard', mode: 'simultaneous' },
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

    if (phase === 'consume')
      return { ...next, log: [...next.log, 'Consume: choose how to spend your goods.'] };

    if (phase === 'produce')
      return { ...next, log: [...next.log, 'Produce: confirm to place your goods.'] };

    return next;
  },

  /**
   * Consumption is mandatory, but *which* good and *which* power is the player's
   * call. Each option below is one concrete, legal move; the UI shows them as
   * buttons and the player keeps choosing until none are left.
   */
  playerOptions(state, playerId) {
    const used = usedPowers(state, playerId);
    if (state.status !== 'playing') return [];
    const here = currentPhase(state);
    if (hasActed(state, playerId)) return [];

    // Produce is automatic by the rules, but the player still confirms it, so the
    // table can see what happened rather than having goods appear silently.
    if (here === 'produce') {
      const empties = producibleCount(state, playerId);
      if (used.includes('@produce')) return [];
      return [{ id: '@produce', forced: true,
        label: empties ? `Produce ${empties} good${empties === 1 ? '' : 's'}`
                       : 'Nothing to produce',
        detail: 'compulsory' }];
    }
    // Settle: the "discard this card for an advantage" powers, offered explicitly.
    if (here === 'settle') {
      const out: PlayerOption[] = [];
      for (const inst of tableauInstances(state, playerId)) {
        const c = card(inst.defId);
        for (const [i, pow] of c.powers.entries()) {
          if (pow.phase !== 'settle') continue;
          const key = `${inst.instanceId}~${i}`;
          if (used.includes(key)) continue;
          if (pow.effectType === 'temporaryMilitaryByDiscardingThisCard')
            out.push({ id: key, label: `Discard ${c.name}`,
              detail: `+${pow.value ?? 3} military until the end of this phase` });
          if (pow.effectType === 'settleCostToZeroByDiscardingThisCard')
            out.push({ id: key, label: `Discard ${c.name}`,
              detail: 'your next non-military world costs nothing' });
        }
      }
      return out;
    }

    if (here !== 'consume') return [];

    const goods = playerGoods(state, playerId);
    const out: PlayerOption[] = [];

    // The Trade bonus: sell exactly one good, the player's choice of which.
    if (chose(state, playerId, 'consume-trade') && !used.includes('@trade')) {
      for (const kind of [...new Set(goods.map(g => g.kind))]) {
        const g = goods.find(x => x.kind === kind)!;
        const cards = tradePrice(kind) + tradeBonusFor(state, playerId, kind, g.world);
        out.push({ id: `trade:${kind}`, label: `Sell ${kind} good`,
          detail: `draw ${cards} card${cards === 1 ? '' : 's'}`,
          spends: [g.good.instanceId], kinds: [kind ?? ''] });
      }
    }

    const doubled = chose(state, playerId, 'consume-2x');
    for (const inst of tableauInstances(state, playerId)) {
      const c = card(inst.defId);
      for (const [i, pow] of c.powers.entries()) {
        if (pow.phase !== 'consume' || pow.effectType === 'tradeBonus') continue;
        const key = `${inst.instanceId}~${i}`;
        if (used.includes(key)) continue;

        if (pow.effectType === 'discardHandForVp') {
          const n = Math.min(pow.times ?? 1, handSize(state, playerId));
          if (n > 0) out.push({ id: key, label: `${c.name}: discard ${n} card(s)`,
            detail: `${n * (pow.vpGained ?? 1)} VP` });
          continue;
        }
        if (pow.effectType === 'consumeGoodForTradePrice') {
          for (const kind of [...new Set(goods.map(g => g.kind))]) {
            const g = goods.find(x => x.kind === kind)!;
            const cards = tradePrice(kind)
              + (pow.appliesTradePowers !== false ? tradeBonusFor(state, playerId, kind, g.world) : 0);
            out.push({ id: `${key}|${kind}`, label: `${c.name}: trade ${kind} good`,
              detail: `draw ${cards} cards`, spends: [g.good.instanceId], kinds: [kind ?? ''] });
          }
          continue;
        }
        if (pow.effectType === 'consumeAllGoods') {
          if (goods.length) out.push({ id: key, label: `${c.name}: consume all goods`,
            detail: `${Math.max(0, goods.length - 1) * (doubled ? 2 : 1)} VP`,
            spends: goods.map(g => g.good.instanceId),
            kinds: goods.map(g => g.kind ?? '') });
          continue;
        }
        if (pow.effectType !== 'consumeGoods') continue;

        const kind = pow.conditions?.resourceType as string | undefined;
        const per = Math.max(1, pow.goodsConsumed ?? 1);
        const vp = (pow.vpGained ?? 0) * (doubled ? 2 : 1);
        const cards = pow.cardsDrawn ?? 0;
        const reward = [vp ? `${vp} VP` : '', cards ? `${cards} card` : ''].filter(Boolean).join(' + ');

        if (pow.conditions?.distinctKinds) {
          const seen = new Set<string>();
          const pick = goods.filter(g => g.kind && !seen.has(g.kind) && seen.add(g.kind)).slice(0, per);
          if (pick.length === per) out.push({ id: key,
            label: `${c.name}: consume ${per} different kinds`, detail: reward,
            spends: pick.map(g => g.good.instanceId), kinds: pick.map(g => g.kind ?? '') });
          continue;
        }

        const pool = goods.filter(g => !kind || g.kind === kind);
        if (pool.length < per) continue;
        // One option per distinct kind combination the player could spend.
        const kinds = kind ? [kind] : [...new Set(pool.map(g => g.kind))];
        for (const k of kinds) {
          const pick = pool.filter(g => g.kind === k).slice(0, per);
          const chosen = pick.length === per ? pick : pool.slice(0, per);
          out.push({ id: `${key}|${k}`,
            label: `${c.name}: consume ${per} ${k ?? 'good'}${per > 1 ? 's' : ''}`,
            detail: reward, spends: chosen.map(g => g.good.instanceId),
            kinds: chosen.map(g => g.kind ?? '') });
        }
      }
    }
    return out;
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
    // Whenever the game is waiting on a card selection, that is the only move.
    if (pendingFor(state, playerId)) return ['SUBMIT_SELECTION'];
    // One action per player per phase, full stop.
    if (hasActed(state, playerId)) return [];
    if (phase === 'reshuffle') return ['READY'];
    if (phase === 'explore') return ['KEEP_CARDS'];
    if (phase === 'develop') return ['PLAY_CARD', 'PASS'];
    if (phase === 'settle') {
      const extras = (this.playerOptions?.(state, playerId) ?? []).length ? ['CHOOSE_OPTION'] : [];
      return [...extras, 'PLAY_CARD', 'PASS'];
    }
    if (phase === 'consume') {
      const opts = this.playerOptions?.(state, playerId) ?? [];
      // Consumption is compulsory: no "done" until nothing is left to do.
      return opts.length ? ['CHOOSE_OPTION', 'AUTO_RESOLVE'] : ['READY'];
    }
    if (phase === 'produce')
      return (this.playerOptions?.(state, playerId) ?? []).length ? ['CHOOSE_OPTION'] : ['READY'];
    return ['READY'];
  },

  playability(state, playerId): Record<string, Playable> {
    const phase = currentPhase(state);
    const out: Record<string, Playable> = {};
    if (state.status !== 'playing') return out;
    const spent = hasActed(state, playerId);
    const pending = pendingFor(state, playerId);
    for (const inst of cardsIn(state, ZONE.hand, playerId)) {
      if (pending) { out[inst.instanceId] = { ok: true, cost: 0 }; continue; }
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

        if (phase === 'settle' && hasFreeSettle(next, playerId))
          next = setPhaseFlag<boolean>(next, 'freeSettle', playerId, false);

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

      case 'SUBMIT_SELECTION': {
        const pending = pendingFor(state, playerId);
        if (!pending) return { ok: false, error: 'Nothing to select right now.' };
        const chosen = ids('instanceIds');
        if (chosen.length !== pending.count)
          return { ok: false, error: `Select exactly ${pending.count} card(s).` };
        let next = state;
        for (const id of chosen) {
          if (!ownedInHand(id)) return { ok: false, error: 'That card is not in your hand.' };
          next = moveCard(next, id, ZONE.discard, { owner: null, faceDown: true });
        }
        if (pending.purpose === 'discardForVp')
          next = grantVp(next, playerId, chosen.length * (pending.vpEach ?? 1));
        next = setPending(next, playerId, null);
        const why = pending.purpose === 'handLimit' ? 'to the hand limit' : 'for victory points';
        return { ok: true, state: { ...next, version: next.version + 1,
          log: [...next.log, `${name(next, playerId)} discarded ${chosen.length} card(s) ${why}.`] } };
      }

      case 'CHOOSE_OPTION': {
        const id = String(action.payload?.optionId ?? '');
        const option = (this.playerOptions?.(state, playerId) ?? []).find(o => o.id === id);
        if (!option) return { ok: false, error: 'That choice is no longer available.' };
        return { ok: true, state: applyConsumeOption(state, playerId, option, rng) };
      }

      case 'AUTO_RESOLVE':
        return { ok: true, state: autoConsume(state, playerId, rng, this) };

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

    if (phase === 'produce') next = settleProduceComparisons(next, rng);

    if (phase === 'discard') {
      // Anyone still over the limit at the end of the step loses the excess.
      for (const p of next.players) {
        let over = handSize(next, p.id) - HAND_LIMIT;
        for (const c of cardsIn(next, ZONE.hand, p.id)) {
          if (over-- <= 0) break;
          next = moveCard(next, c.instanceId, ZONE.discard, { owner: null, faceDown: true });
        }
        next = setPending(next, p.id, null);
      }
      return next;
    }

    if (isLastGamePhase(next, phase)) {
      // Over the hand limit? Insert a step so each player chooses what to lose.
      const over = next.players.filter(p => handSize(next, p.id) > HAND_LIMIT);
      if (over.length) {
        for (const p of over)
          next = setPending(next, p.id, { purpose: 'handLimit',
            count: handSize(next, p.id) - HAND_LIMIT,
            label: `Hand limit is ${HAND_LIMIT}` });
        next = { ...next, phasesThisRound: [...next.phasesThisRound, 'discard'] };
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
      tempMilitary: temporaryMilitary(state, playerId),
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
    const waiting = (state.gameData.pending as Record<string, { count: number }>)?.[playerId];
    if (waiting) {
      const pick = cardsIn(state, ZONE.hand, playerId).slice(0, waiting.count)
        .map(c => c.instanceId);
      return pick.length === waiting.count
        ? { type: 'SUBMIT_SELECTION', phaseId, payload: { instanceIds: pick } } : null;
    }
    if (phase === 'consume' && (this.playerOptions?.(state, playerId) ?? []).length)
      return { type: 'AUTO_RESOLVE', phaseId };
    if (phase === 'produce' && (this.playerOptions?.(state, playerId) ?? []).length)
      return { type: 'CHOOSE_OPTION', phaseId, payload: { optionId: '@produce' } };
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

/** The last scoring phase of the round, ignoring the housekeeping steps after it. */
function isLastGamePhase(state: GameState, phase: string): boolean {
  const real = state.phasesThisRound.filter(p => (PHASE_ORDER as readonly string[]).includes(p));
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

/**
 * Apply exactly one chosen option. Every branch spends only the goods the
 * player picked, so nothing is consumed behind their back.
 */
function applyConsumeOption(
  state: GameState, pid: PlayerId, option: PlayerOption, rng: Rng,
): GameState {
  let next = state;
  const spend = (ids: string[]) => {
    for (const id of ids) {
      const g = next.cards[id];
      if (g && g.zone === ZONE.goods && g.owner === pid)
        next = moveCard(next, id, ZONE.discard, { owner: null, faceDown: true });
    }
  };
  const doubled = chose(next, pid, 'consume-2x');
  const note = (t: string) => {
    next = { ...next, version: next.version + 1,
             log: [...next.log, `${name(next, pid)}: ${t}.`] };
  };

  // --- settle-phase powers that cost you the card itself --------------------
  {
    const [k] = option.id.split('|');
    const [instanceId, idxStr] = (k ?? '').split('~');
    const host = next.cards[instanceId ?? ''];
    const pow = host ? card(host.defId).powers[Number(idxStr)] : undefined;
    if (host && pow && pow.phase === 'settle') {
      if (pow.effectType === 'temporaryMilitaryByDiscardingThisCard') {
        const gain = pow.value ?? 3;
        next = moveCard(next, host.instanceId, ZONE.discard, { owner: null, faceDown: true });
        next = setPhaseFlag<number>(next, 'tempMilitary', pid,
          temporaryMilitary(next, pid) + gain);
        next = markPowerUsed(next, pid, k!);
        return { ...next, version: next.version + 1,
          log: [...next.log, `${name(next, pid)} discarded ${card(host.defId).name} for +${gain} military.`] };
      }
      if (pow.effectType === 'settleCostToZeroByDiscardingThisCard') {
        next = moveCard(next, host.instanceId, ZONE.discard, { owner: null, faceDown: true });
        next = setPhaseFlag<boolean>(next, 'freeSettle', pid, true);
        next = markPowerUsed(next, pid, k!);
        return { ...next, version: next.version + 1,
          log: [...next.log, `${name(next, pid)} discarded ${card(host.defId).name}: next world is free.`] };
      }
    }
  }

  if (option.id === '@produce') {
    next = markPowerUsed(next, pid, '@produce');
    return produceFor(next, pid, rng);
  }

  // --- the Trade bonus: sell the good the player picked ---------------------
  if (option.id.startsWith('trade:')) {
    const kind = option.id.slice(6);
    const g = playerGoods(next, pid).find(x => x.kind === kind);
    if (!g) return next;
    const cards = tradePrice(kind) + tradeBonusFor(next, pid, kind, g.world);
    spend([g.good.instanceId]);
    next = drawToHand(next, pid, cards, rng);
    next = markPowerUsed(next, pid, '@trade');
    note(`sold a ${kind} good for ${cards} cards`);
    return next;
  }

  const [key, kindPart] = option.id.split('|');
  const [instanceId, idxStr] = (key ?? '').split('~');
  const host = next.cards[instanceId ?? ''];
  if (!host) return next;
  const c = card(host.defId);
  const pow = c.powers[Number(idxStr)];
  if (!pow) return next;

  if (pow.effectType === 'discardHandForVp') {
    const n = Math.min(pow.times ?? 1, handSize(next, pid));
    if (!n) return next;
    // Which cards to give up is the player's decision, so ask.
    next = markPowerUsed(next, pid, key!);
    next = setPending(next, pid, { purpose: 'discardForVp', count: n,
      label: `${c.name}: choose ${n} card(s) to discard`,
      vpEach: pow.vpGained ?? 1 });   // never doubled by the x2 bonus
    return { ...next, version: next.version + 1 };
  }

  if (pow.effectType === 'consumeGoodForTradePrice') {
    const g = playerGoods(next, pid).find(x => x.kind === kindPart);
    if (!g) return next;
    const cards = tradePrice(g.kind)
      + (pow.appliesTradePowers !== false ? tradeBonusFor(next, pid, g.kind, g.world) : 0);
    spend([g.good.instanceId]);
    next = drawToHand(next, pid, cards, rng);
    next = markPowerUsed(next, pid, key!);
    note(`traded a ${g.kind} good for ${cards} cards`);
    return next;
  }

  const spends = option.spends ?? [];
  if (pow.effectType === 'consumeAllGoods') {
    spend(spends);
    const vp = Math.max(0, spends.length - 1) * (doubled ? 2 : 1);
    next = grantVp(next, pid, vp);
    next = markPowerUsed(next, pid, key!);
    note(`consumed all ${spends.length} goods for ${vp} VP`);
    return next;
  }

  // consumeGoods
  spend(spends);
  const vp = (pow.vpGained ?? 0) * (doubled ? 2 : 1);
  if (vp) next = grantVp(next, pid, vp);
  if (pow.cardsDrawn) next = drawToHand(next, pid, pow.cardsDrawn, rng);
  next = markPowerUsed(next, pid, key!);
  note(`consumed ${spends.length} good(s) for ${vp} VP`
    + (pow.cardsDrawn ? ` and ${pow.cardsDrawn} card(s)` : ''));
  return next;
}

/**
 * Opt-in convenience: take the remaining options in the order that pays best,
 * for a player who does not want to click through them. Never runs unasked.
 */
function autoConsume(state: GameState, pid: PlayerId, rng: Rng, def: GameDefinition): GameState {
  let next = state;
  for (let guard = 0; guard < 30; guard++) {
    const opts = def.playerOptions?.(next, pid) ?? [];
    if (!opts.length) break;
    const score = (o: PlayerOption) => {
      const vp = Number(/(\d+) VP/.exec(o.detail ?? '')?.[1] ?? 0);
      const cards = Number(/(\d+) card/.exec(o.detail ?? '')?.[1] ?? 0);
      return vp * 2 + cards;
    };
    const best = opts.slice().sort((a, b) => score(b) - score(a))[0]!;
    const before = next.version;
    next = applyConsumeOption(next, pid, best, rng);
    if (next.version === before) break;   // nothing changed: stop rather than spin
  }
  return next;
}

/** Empty worlds this player would fill if Produce ran now. */
function producibleCount(state: GameState, pid: PlayerId): number {
  const empty = (mode: 'production' | 'windfall', kind?: string) =>
    tableauInstances(state, pid).filter(i => {
      const w = card(i.defId).world;
      return w?.productionMode === mode && (!kind || w.resourceType === kind)
        && goodsOn(state, i.instanceId).length === 0;
    });
  let n = empty('production').length;
  for (const c of tableauCards(state, pid))
    for (const pow of c.powers)
      if (pow.phase === 'produce' && pow.effectType === 'produceWindfallGood') n += 1;
  if (chose(state, pid, 'produce')) n += 1;
  return Math.min(n, empty('production').length + empty('windfall').length);
}

/**
 * Produce for one player: fill every empty production world, apply any
 * windfall-producing powers, then the draw powers that depend on what came out.
 */
function produceFor(state: GameState, pid: PlayerId, rng: Rng): GameState {
  let next = state;
  const produced: string[] = [];

  const emptyWorlds = (mode: 'production' | 'windfall', kind?: string) =>
    tableauInstances(next, pid).filter(i => {
      const w = card(i.defId).world;
      return w?.productionMode === mode && (!kind || w.resourceType === kind)
        && goodsOn(next, i.instanceId).length === 0;
    });

  const putGood = (worldInstanceId: string): void => {
    const host = card(next.cards[worldInstanceId]!.defId);
    next = placeGood(next, pid, worldInstanceId, rng);
    if (host.world?.resourceType) produced.push(host.world.resourceType);
    for (const pow of host.powers)
      if (pow.phase === 'produce' && pow.effectType === 'drawOnProducedGoodHere')
        next = drawToHand(next, pid, pow.cardsDrawn ?? pow.value ?? 1, rng);
  };

  for (const inst of emptyWorlds('production')) putGood(inst.instanceId);

  for (const c of tableauCards(next, pid))
    for (const pow of c.powers) {
      if (pow.phase !== 'produce' || pow.effectType !== 'produceWindfallGood') continue;
      const target = emptyWorlds('windfall', pow.conditions?.resourceType as string | undefined)[0];
      if (target) putGood(target.instanceId);
    }

  if (chose(next, pid, 'produce')) {
    const target = emptyWorlds('windfall')[0];
    if (target) putGood(target.instanceId);
  }

  for (const c of tableauCards(next, pid))
    for (const pow of c.powers) {
      if (pow.phase !== 'produce') continue;
      const n = pow.cardsDrawn ?? pow.value ?? 1;
      switch (pow.effectType) {
        case 'drawCards':
          next = drawToHand(next, pid, n, rng); break;
        case 'drawPerGoodOfKindProduced':
          next = drawToHand(next, pid,
            n * produced.filter(k => k === pow.conditions?.resourceType).length, rng); break;
        case 'drawPerDifferentKindProduced':
          next = drawToHand(next, pid, n * new Set(produced).size, rng); break;
        case 'drawPerWorldOfKind': {
          const kind = pow.conditions?.resourceType as string | undefined;
          const worlds = tableauCards(next, pid).filter(x =>
            x.world?.resourceType === kind && x.world?.productionMode !== 'none').length;
          next = drawToHand(next, pid, n * worlds, rng); break;
        }
      }
    }

  const tally = { ...((next.gameData.producedThisPhase as Record<string, string[]>) ?? {}) };
  tally[pid] = produced;
  return { ...next, version: next.version + 1,
    gameData: { ...next.gameData, producedThisPhase: tally },
    log: [...next.log, `${name(next, pid)} produced ${produced.length} good(s).`] };
}

/** "Most rare elements produced" can only be judged once everyone has produced. */
function settleProduceComparisons(state: GameState, rng: Rng): GameState {
  let next = state;
  const tally = (next.gameData.producedThisPhase as Record<string, string[]>) ?? {};
  const rare = (pid: PlayerId) => (tally[pid] ?? []).filter(k => k === 'rare').length;
  for (const p of next.players)
    for (const c of tableauCards(next, p.id))
      for (const pow of c.powers) {
        if (pow.phase !== 'produce' || pow.effectType !== 'drawIfMostRareProduced') continue;
        const mine = rare(p.id);
        const beaten = next.players.some(o => o.id !== p.id && rare(o.id) >= mine);
        if (mine > 0 && !beaten)
          next = drawToHand(next, p.id, pow.cardsDrawn ?? pow.value ?? 1, rng);
      }
  const { producedThisPhase, ...rest } = next.gameData as Record<string, unknown>;
  return { ...next, gameData: rest };
}


