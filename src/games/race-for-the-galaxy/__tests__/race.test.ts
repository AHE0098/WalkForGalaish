import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRng } from '../../../core/random.js';
import { ZONE, cardsIn, moveCard } from '../../../core/zones.js';
import { raceForTheGalaxy as race } from '../definition.js';
import { RACE_CARDS, card } from '../cards.js';
import {
  calculateScore, canDevelop, canSettle, developCost, exploreDraw, exploreKeep, goodsOn,
  militaryStrength, vpChips, vpPool,
} from '../rules.js';
import { emptyState } from '../../../server/gameHost.js';
import type { GameState, Player } from '../../../core/types.js';

const players: Player[] = [
  { id: 'p1', name: 'One', seat: 0, connected: true, ready: false },
  { id: 'p2', name: 'Two', seat: 1, connected: true, ready: false },
];
const rawSetup = (seed = 7): GameState =>
  race.setupGame(emptyState(players.map(p => ({ ...p }))), createRng(seed));
/** Setup with the opening 6-choose-4 discard already completed. */
const setup = (seed = 7): GameState => {
  const s = rawSetup(seed);
  return { ...s, gameData: { ...s.gameData, openingDiscard: false } };
};
/** Put the state into a named phase so phase-gated actions are legal. */
const inPhase = (s: GameState, phase: string): GameState =>
  ({ ...s, phasesThisRound: [phase], phaseIndex: 0 });

/** Put a specific card into a player's hand, for deterministic rule tests. */
function giveCard(state: GameState, pid: string, defId: string): [GameState, string] {
  const inst = Object.values(state.cards).find(c => c.defId === defId && c.zone === ZONE.supply)
    ?? Object.values(state.cards).find(c => c.defId === defId && c.zone !== ZONE.tableau);
  if (!inst) throw new Error(`no free copy of ${defId}`);
  const next = moveCard(state, inst.instanceId, ZONE.hand, { owner: pid, faceDown: false });
  return [{ ...next, gameData: { ...next.gameData,
    supplyOrder: (next.gameData.supplyOrder as string[]).filter(i => i !== inst.instanceId) } },
    inst.instanceId];
}

describe('card database', () => {
  it('passes the structural validator', () => {
    const out = execFileSync('node', ['scripts/validate-rftg-cards.cjs',
      'src/games/race-for-the-galaxy/cards/race_for_the_galaxy_base_cards.json'],
      { encoding: 'utf8' });
    expect(out).toContain('PASS: 0 error(s)');
  });

  it('has 95 definitions and 114 physical cards', () => {
    expect(RACE_CARDS).toHaveLength(95);
    expect(RACE_CARDS.reduce((n, c) => n + c.quantity, 0)).toBe(114);
  });
});

describe('setup', () => {
  it('gives every player a start world and six cards', () => {
    const s = rawSetup();
    for (const p of players) {
      const tableau = cardsIn(s, ZONE.tableau, p.id);
      expect(tableau).toHaveLength(1);
      expect(card(tableau[0]!.defId).isStartWorld).toBe(true);
      expect(cardsIn(s, ZONE.hand, p.id)).toHaveLength(6);
    }
  });

  it('leaves the unused start worlds in the supply', () => {
    const s = setup();
    const inSupply = cardsIn(s, ZONE.supply).filter(c => card(c.defId).isStartWorld);
    expect(inSupply.length).toBeGreaterThan(0);
  });

  it('is reproducible under a seed', () => {
    expect(cardsIn(setup(11), ZONE.tableau, 'p1')[0]!.defId)
      .toBe(cardsIn(setup(11), ZONE.tableau, 'p1')[0]!.defId);
  });
});

describe('action selection', () => {
  it('produces the union of chosen phases in canonical order', () => {
    const s = { ...setup(), revealedChoices: { p1: 'produce', p2: 'develop' } };
    expect(race.selectPhasesForRound(s)).toEqual(['develop', 'produce']);
  });

  it('runs a phase once when both players choose it', () => {
    const s = { ...setup(), revealedChoices: { p1: 'settle', p2: 'settle' } };
    expect(race.selectPhasesForRound(s)).toEqual(['settle']);
  });

  it('skips every phase nobody chose', () => {
    const s = { ...setup(), revealedChoices: { p1: 'explore-5', p2: 'explore-1-1' } };
    expect(race.selectPhasesForRound(s)).toEqual(['explore']);
  });
});

describe('develop', () => {
  it('rejects a second copy of a development already in the tableau', () => {
    let s = setup();
    const [withCard, inst] = giveCard(s, 'p1', 'contact-specialist');
    s = moveCard(withCard, inst, ZONE.tableau, { owner: 'p1', faceDown: false });
    const [s2] = giveCard(s, 'p1', 'contact-specialist');
    expect(canDevelop(s2, 'p1', 'contact-specialist')).toMatch(/Already in your tableau/);
  });

  it('rejects payment of the wrong size', () => {
    let [s, inst] = giveCard(setup(), 'p1', 'new-galactic-order'); // cost 6
    const hand = cardsIn(s, ZONE.hand, 'p1').filter(c => c.instanceId !== inst);
    const r = race.resolveAction(inPhase(s, 'develop'), 'p1',
      { type: 'PLAY_CARD', phaseId: s.phaseId,
        payload: { instanceId: inst, payment: hand.slice(0, 2).map(c => c.instanceId) } },
      createRng(1));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/costs 5|costs 6|not enough cards/);
  });
});

describe('settle', () => {
  it('allows a military world only when military is sufficient', () => {
    const military = RACE_CARDS.find(c => c.world?.settlementMode === 'military'
      && (c.world.defense ?? 0) >= 5 && !c.isStartWorld)!;
    const [s] = giveCard(setup(), 'p1', military.cardId);
    expect(militaryStrength(s, 'p1')).toBeLessThan(military.world!.defense!);
    expect(canSettle(s, 'p1', military.cardId)).toMatch(/Needs \d+ military/);
  });

  it('places a good on a windfall world when it is settled', () => {
    const windfall = RACE_CARDS.find(c => c.world?.productionMode === 'windfall'
      && c.world.settlementMode === 'payment' && (c.world.settleCost ?? 9) <= 2)!;
    let [s, inst] = giveCard(setup(), 'p1', windfall.cardId);
    s = inPhase(s, 'settle');
    const pay = cardsIn(s, ZONE.hand, 'p1').filter(c => c.instanceId !== inst)
      .slice(0, windfall.world!.settleCost ?? 0).map(c => c.instanceId);
    const r = race.resolveAction(s, 'p1',
      { type: 'PLAY_CARD', phaseId: s.phaseId, payload: { instanceId: inst, payment: pay } },
      createRng(3));
    expect(r.ok).toBe(true);
    const goods = Object.values(r.state!.cards).filter(c => c.zone === ZONE.goods && c.attachedTo === inst);
    expect(goods).toHaveLength(1);
    expect(goods[0]!.faceDown).toBe(true);
  });

  it('rejects a card that is not in your hand', () => {
    const s = inPhase(setup(), 'settle');
    const opp = cardsIn(s, ZONE.hand, 'p2')[0]!;
    const r = race.resolveAction(s, 'p1',
      { type: 'PLAY_CARD', phaseId: s.phaseId, payload: { instanceId: opp.instanceId, payment: [] } },
      createRng(1));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not in your hand/);
  });
});

describe('stale actions', () => {
  it('rejects an action carrying an old phaseId', () => {
    const s = inPhase(setup(), 'develop');
    const r = race.resolveAction(s, 'p1',
      { type: 'PLAY_CARD', phaseId: 'stale-phase', payload: {} }, createRng(1));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/out of date/);
  });
});

describe('scoring', () => {
  it('sums printed victory points from the tableau', () => {
    let s = setup();
    const before = calculateScore(s, 'p1');
    const [withCard, inst] = giveCard(s, 'p1', 'new-vinland'); // a plain VP world
    s = moveCard(withCard, inst, ZONE.tableau, { owner: 'p1', faceDown: false });
    expect(calculateScore(s, 'p1')).toBe(before + (card('new-vinland').victoryPoints ?? 0));
  });

  it('scores a six-cost development against the tableau', () => {
    let s = setup();
    for (const id of ['alien-tech-institute', 'deserted-alien-outpost']) {
      const [withCard, inst] = giveCard(s, 'p1', id);
      s = moveCard(withCard, inst, ZONE.tableau, { owner: 'p1', faceDown: false });
    }
    // Alien Tech Institute scores per alien card; the score must exceed printed VP alone.
    const printed = cardsIn(s, ZONE.tableau, 'p1')
      .reduce((n, c) => n + (card(c.defId).victoryPoints ?? 0), 0);
    expect(calculateScore(s, 'p1')).toBeGreaterThan(printed);
  });
});

describe('game end', () => {
  it('ends when a player reaches twelve tableau cards', () => {
    let s = setup();
    expect(race.determineGameEnd(s)).toBe(false);
    const spare = cardsIn(s, ZONE.supply).slice(0, 11);
    for (const c of spare) s = moveCard(s, c.instanceId, ZONE.tableau, { owner: 'p1', faceDown: false });
    expect(race.determineGameEnd(s)).toBe(true);
  });

  it('ends when the victory point pool is exhausted', () => {
    const s = setup();
    expect(race.determineGameEnd({ ...s, gameData: { ...s.gameData, vpPool: 0 } })).toBe(true);
  });
});

// ---------------------------------------------------------------- new mechanics

describe('opening discard', () => {
  it('requires exactly two cards and then unlocks the round', () => {
    let s = rawSetup();
    expect(race.legalActions(s, 'p1')).toEqual(['DISCARD_CARDS']);
    const hand = cardsIn(s, ZONE.hand, 'p1');
    const one = race.resolveAction(s, 'p1',
      { type: 'DISCARD_CARDS', phaseId: s.phaseId, payload: { instanceIds: [hand[0]!.instanceId] } },
      createRng(1));
    expect(one.ok).toBe(false);
    for (const pid of ['p1', 'p2']) {
      const two = cardsIn(s, ZONE.hand, pid).slice(0, 2).map(c => c.instanceId);
      const r = race.resolveAction(s, pid,
        { type: 'DISCARD_CARDS', phaseId: s.phaseId, payload: { instanceIds: two } }, createRng(1));
      expect(r.ok).toBe(true);
      s = r.state!;
    }
    expect(s.gameData.openingDiscard).toBe(false);
    expect(cardsIn(s, ZONE.hand, 'p1')).toHaveLength(4);
  });
});

describe('explore', () => {
  const withAction = (s: GameState, a: Record<string, string>): GameState =>
    ({ ...s, gameData: { ...s.gameData, roundActions: a } });

  it('scales draw and keep with the chosen action card', () => {
    const s = setup();
    expect(exploreDraw(s, 'p1')).toBe(2);
    expect(exploreKeep(s, 'p1')).toBe(1);
    const five = withAction(s, { p1: 'explore-5' });
    expect(exploreDraw(five, 'p1')).toBe(7);
    expect(exploreKeep(five, 'p1')).toBe(1);
    const oneOne = withAction(s, { p1: 'explore-1-1' });
    expect(exploreDraw(oneOne, 'p1')).toBe(3);
    expect(exploreKeep(oneOne, 'p1')).toBe(2);
  });

  it('deals into the selection zone and keeps exactly the chosen cards', () => {
    let s = inPhase(withAction(setup(), { p1: 'explore-1-1', p2: 'develop' }), 'explore');
    s = race.onPhaseEnter!(s, 'explore', createRng(5));
    expect(cardsIn(s, ZONE.selection, 'p1')).toHaveLength(3);
    expect(cardsIn(s, ZONE.selection, 'p2')).toHaveLength(2);

    const pool = cardsIn(s, ZONE.selection, 'p1').map(c => c.instanceId);
    const tooFew = race.resolveAction(s, 'p1',
      { type: 'KEEP_CARDS', phaseId: s.phaseId, payload: { instanceIds: [pool[0]!] } }, createRng(1));
    expect(tooFew.ok).toBe(false);

    const handBefore = cardsIn(s, ZONE.hand, 'p1').length;
    const r = race.resolveAction(s, 'p1',
      { type: 'KEEP_CARDS', phaseId: s.phaseId, payload: { instanceIds: pool.slice(0, 2) } },
      createRng(1));
    expect(r.ok).toBe(true);
    expect(cardsIn(r.state!, ZONE.hand, 'p1')).toHaveLength(handBefore + 2);
    expect(cardsIn(r.state!, ZONE.selection, 'p1')).toHaveLength(0);
    expect(cardsIn(r.state!, ZONE.discard)).toHaveLength(1);
  });
});

describe('action bonuses', () => {
  it('makes a development cost one less for the player who chose Develop', () => {
    const s = setup();
    const dev = RACE_CARDS.find(c => c.cardType === 'development' && c.cost === 4)!;
    const plain = developCost(s, 'p1', dev);
    const bonus = developCost({ ...s, gameData: { ...s.gameData, roundActions: { p1: 'develop' } } },
                              'p1', dev);
    expect(plain).toBe(4);
    expect(bonus).toBe(3);
  });

  it('never reduces a cost below zero', () => {
    const s = { ...setup(), gameData: { ...setup().gameData, roundActions: { p1: 'develop' } } };
    const cheap = RACE_CARDS.find(c => c.cardType === 'development' && c.cost === 1)!;
    expect(developCost(s, 'p1', cheap)).toBe(0);
  });
});

describe('produce', () => {
  it('fills empty production worlds but leaves windfall worlds alone', () => {
    let s = setup();
    const prod = RACE_CARDS.find(c => c.world?.productionMode === 'production')!;
    const wind = RACE_CARDS.find(c => c.world?.productionMode === 'windfall')!;
    for (const id of [prod.cardId, wind.cardId]) {
      const [withCard, inst] = giveCard(s, 'p1', id);
      s = moveCard(withCard, inst, ZONE.tableau, { owner: 'p1', faceDown: false });
    }
    const after = race.onPhaseEnter!(inPhase(s, 'produce'), 'produce', createRng(9));
    const prodInst = cardsIn(after, ZONE.tableau, 'p1').find(c => c.defId === prod.cardId)!;
    const windInst = cardsIn(after, ZONE.tableau, 'p1').find(c => c.defId === wind.cardId)!;
    expect(goodsOn(after, prodInst.instanceId)).toHaveLength(1);
    expect(goodsOn(after, windInst.instanceId)).toHaveLength(0);
  });

  it('gives the Produce chooser one windfall good as a bonus', () => {
    let s = setup();
    const wind = RACE_CARDS.find(c => c.world?.productionMode === 'windfall')!;
    const [withCard, inst] = giveCard(s, 'p1', wind.cardId);
    s = moveCard(withCard, inst, ZONE.tableau, { owner: 'p1', faceDown: false });
    s = { ...s, gameData: { ...s.gameData, roundActions: { p1: 'produce' } } };
    const after = race.onPhaseEnter!(inPhase(s, 'produce'), 'produce', createRng(9));
    expect(goodsOn(after, inst)).toHaveLength(1);
  });
});

describe('consume', () => {
  it('awards victory points from the pool and drains it', () => {
    let s = setup();
    // Earth's Lost Colony consumes a good for 1 VP; give it a good to spend.
    const [withCard, inst] = giveCard(s, 'p1', 'earths-lost-colony');
    s = moveCard(withCard, inst, ZONE.tableau, { owner: 'p1', faceDown: false });
    const good = cardsIn(s, ZONE.supply)[0]!;
    s = moveCard(s, good.instanceId, ZONE.goods,
      { owner: 'p1', attachedTo: inst, faceDown: true });

    const poolBefore = vpPool(s);
    const after = race.onPhaseEnter!(inPhase(s, 'consume'), 'consume', createRng(2));
    expect(vpChips(after, 'p1')).toBeGreaterThan(0);
    expect(vpPool(after)).toBeLessThan(poolBefore);
    expect(goodsOn(after, inst)).toHaveLength(0);
  });

  it('cannot consume without a consume power', () => {
    const s = setup();
    const after = race.onPhaseEnter!(inPhase(s, 'consume'), 'consume', createRng(2));
    expect(vpChips(after, 'p2')).toBe(0);
  });
});

describe('playability', () => {
  it('marks developments playable in Develop and blocks worlds, with a reason', () => {
    let s = setup();
    const [a, devInst] = giveCard(s, 'p1', 'contact-specialist');
    const [b, worldInst] = giveCard(a, 'p1', 'new-vinland');
    s = inPhase(b, 'develop');
    const p = race.playability!(s, 'p1');
    expect(p[devInst]!.ok).toBe(true);
    expect(p[devInst]!.cost).toBe(1);
    expect(p[worldInst]!.ok).toBe(false);
    expect(p[worldInst]!.reason).toBe('Not a development.');
  });
});

describe('hand limit', () => {
  it('discards down to ten at the end of the last phase of a round', () => {
    let s = setup();
    while (cardsIn(s, ZONE.hand, 'p1').length < 14) {
      const c = cardsIn(s, ZONE.supply)[0]!;
      s = moveCard(s, c.instanceId, ZONE.hand, { owner: 'p1', faceDown: false });
    }
    const after = race.onPhaseComplete(inPhase(s, 'produce'), 'produce', createRng(1));
    expect(cardsIn(after, ZONE.hand, 'p1')).toHaveLength(10);
  });
});

describe('reshuffle step', () => {
  it('is scheduled when the supply runs low, and rebuilds it from the graveyard', () => {
    let s = setup();
    // Drain the supply into the discard pile, then finish the round.
    const order = (s.gameData.supplyOrder as string[]).slice();
    for (const id of order.slice(0, order.length - 2))
      s = moveCard(s, id, ZONE.discard, { owner: null, faceDown: true });
    s = { ...s, gameData: { ...s.gameData, supplyOrder: order.slice(order.length - 2) } };

    const afterRound = race.onPhaseComplete(inPhase(s, 'produce'), 'produce', createRng(1));
    expect(afterRound.gameData.reshuffleNeeded).toBe(true);

    const phases = race.selectPhasesForRound({
      ...afterRound, revealedChoices: { p1: 'develop', p2: 'develop' } });
    expect(phases[phases.length - 1]).toBe('reshuffle');
    expect(race.legalActions({ ...afterRound, phasesThisRound: ['reshuffle'], phaseIndex: 0 }, 'p1'))
      .toEqual(['READY']);

    const graveyard = cardsIn(afterRound, ZONE.discard).length;
    expect(graveyard).toBeGreaterThan(0);
    const done = race.onPhaseComplete(
      { ...afterRound, phasesThisRound: ['reshuffle'], phaseIndex: 0 }, 'reshuffle', createRng(1));
    expect(done.gameData.reshuffleNeeded).toBe(false);
    expect(cardsIn(done, ZONE.discard)).toHaveLength(0);
    expect((done.gameData.supplyOrder as string[]).length).toBeGreaterThanOrEqual(graveyard);
  });

  it('does not schedule a reshuffle while the supply is healthy', () => {
    const after = race.onPhaseComplete(inPhase(setup(), 'produce'), 'produce', createRng(1));
    expect(after.gameData.reshuffleNeeded).toBeFalsy();
  });
});

// ---------------------------------------------------------------- regressions

describe('one action per phase (regression)', () => {
  it('refuses a second card in the same Settle phase, free or paid', () => {
    let s = setup();
    // A military world costs nothing, so this is the case that slipped through.
    const mil = RACE_CARDS.find(c => c.world?.settlementMode === 'military'
      && (c.world.defense ?? 9) <= 2 && !c.isStartWorld)!;
    const cheap = RACE_CARDS.find(c => c.world?.settlementMode === 'payment'
      && (c.world.settleCost ?? 9) === 0)!;
    const [a, milInst] = giveCard(s, 'p1', mil.cardId);
    const [b, freeInst] = giveCard(a, 'p1', cheap.cardId);
    // Give p1 enough military to conquer.
    const booster = RACE_CARDS.find(c => c.powers.some(p =>
      p.effectType === 'militaryStrength' && (p.value ?? 0) >= 2 && !p.conditions))!;
    const [c2, boostInst] = giveCard(b, 'p1', booster.cardId);
    s = inPhase(moveCard(c2, boostInst, ZONE.tableau, { owner: 'p1', faceDown: false }), 'settle');

    const first = race.resolveAction(s, 'p1',
      { type: 'PLAY_CARD', phaseId: s.phaseId, payload: { instanceId: milInst, payment: [] } },
      createRng(3));
    expect(first.ok).toBe(true);

    const second = race.resolveAction(first.state!, 'p1',
      { type: 'PLAY_CARD', phaseId: first.state!.phaseId,
        payload: { instanceId: freeInst, payment: [] } }, createRng(3));
    expect(second.ok).toBe(false);
    expect(race.legalActions(first.state!, 'p1')).toEqual([]);
    expect(cardsIn(first.state!, ZONE.tableau, 'p1').filter(x => x.instanceId === freeInst))
      .toHaveLength(0);
  });

  it('refuses a pass after a card has been played', () => {
    let s = setup();
    const dev = RACE_CARDS.find(c => c.cardType === 'development' && c.cost === 1)!;
    const [a, inst] = giveCard(s, 'p1', dev.cardId);
    s = inPhase(a, 'develop');
    const pay = cardsIn(s, ZONE.hand, 'p1').filter(c => c.instanceId !== inst)
      .slice(0, 1).map(c => c.instanceId);
    const r = race.resolveAction(s, 'p1',
      { type: 'PLAY_CARD', phaseId: s.phaseId, payload: { instanceId: inst, payment: pay } },
      createRng(1));
    expect(r.ok).toBe(true);
    expect(race.resolveAction(r.state!, 'p1',
      { type: 'PASS', phaseId: r.state!.phaseId }, createRng(1)).ok).toBe(false);
  });

  it('marks every hand card unplayable with a reason once you have acted', () => {
    let s = setup();
    s = inPhase(s, 'develop');
    const after = race.resolveAction(s, 'p1', { type: 'PASS', phaseId: s.phaseId }, createRng(1));
    const p = race.playability!(after.state!, 'p1');
    for (const v of Object.values(p)) {
      expect(v.ok).toBe(false);
      expect(v.reason).toMatch(/already acted/);
    }
  });

  it('lets the player act again once the phase changes', () => {
    let s = inPhase(setup(), 'develop');
    const after = race.resolveAction(s, 'p1', { type: 'PASS', phaseId: s.phaseId }, createRng(1));
    expect(race.legalActions(after.state!, 'p1')).toEqual([]);
    const nextPhase = { ...after.state!, phaseId: 'a-brand-new-phase' };
    expect(race.legalActions(nextPhase, 'p1')).toEqual(['PLAY_CARD', 'PASS']);
  });
});
