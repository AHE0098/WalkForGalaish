import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRng } from '../../../core/random.js';
import { ZONE, cardsIn, moveCard } from '../../../core/zones.js';
import { raceForTheGalaxy as race } from '../definition.js';
import { RACE_CARDS, card } from '../cards.js';
import { calculateScore, canDevelop, canSettle, militaryStrength } from '../rules.js';
import { emptyState } from '../../../server/gameHost.js';
import type { GameState, Player } from '../../../core/types.js';

const players: Player[] = [
  { id: 'p1', name: 'One', seat: 0, connected: true, ready: false },
  { id: 'p2', name: 'Two', seat: 1, connected: true, ready: false },
];
const setup = (seed = 7): GameState => race.setupGame(emptyState(players.map(p => ({ ...p }))), createRng(seed));

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
    const s = setup();
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
    expect(canDevelop(s2, 'p1', 'contact-specialist')).toMatch(/already have/);
  });

  it('rejects payment of the wrong size', () => {
    let [s, inst] = giveCard(setup(), 'p1', 'new-galactic-order'); // cost 6
    const hand = cardsIn(s, ZONE.hand, 'p1').filter(c => c.instanceId !== inst);
    const r = race.resolveAction(
      { ...s, phasesThisRound: ['develop'], phaseIndex: 0 }, 'p1',
      { type: 'PLAY_CARD', phaseId: s.phaseId,
        payload: { instanceId: inst, payment: hand.slice(0, 2).map(c => c.instanceId) } },
      createRng(1));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/costs 6/);
  });
});

describe('settle', () => {
  it('allows a military world only when military is sufficient', () => {
    const military = RACE_CARDS.find(c => c.world?.settlementMode === 'military'
      && (c.world.defense ?? 0) >= 5 && !c.isStartWorld)!;
    const [s] = giveCard(setup(), 'p1', military.cardId);
    expect(militaryStrength(s, 'p1')).toBeLessThan(military.world!.defense!);
    expect(canSettle(s, 'p1', military.cardId)).toMatch(/military is not strong enough/);
  });

  it('places a good on a windfall world when it is settled', () => {
    const windfall = RACE_CARDS.find(c => c.world?.productionMode === 'windfall'
      && c.world.settlementMode === 'payment' && (c.world.settleCost ?? 9) <= 2)!;
    let [s, inst] = giveCard(setup(), 'p1', windfall.cardId);
    s = { ...s, phasesThisRound: ['settle'], phaseIndex: 0 };
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
    const s = { ...setup(), phasesThisRound: ['settle'], phaseIndex: 0 };
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
    const s = { ...setup(), phasesThisRound: ['develop'], phaseIndex: 0 };
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
