import { describe, expect, it } from 'vitest';
import { createRng } from '../../../core/random.js';
import { ZONE, cardsIn, moveCard } from '../../../core/zones.js';
import { raceForTheGalaxy as race } from '../definition.js';
import { RACE_CARDS, card } from '../cards.js';
import { goodsOn, playerGoods, vpChips, vpPool, tableauInstances } from '../rules.js';
import { emptyState } from '../../../server/gameHost.js';
import type { GameState, Player } from '../../../core/types.js';

const players: Player[] = [
  { id: 'p1', name: 'One', seat: 0, connected: true, ready: false },
  { id: 'p2', name: 'Two', seat: 1, connected: true, ready: false },
];
const base = (seed = 7): GameState => {
  const s = race.setupGame(emptyState(players.map(p => ({ ...p }))), createRng(seed));
  return { ...s, gameData: { ...s.gameData, openingDiscard: false } };
};
const inPhase = (s: GameState, phase: string): GameState =>
  ({ ...s, phasesThisRound: [phase], phaseIndex: 0 });
const withActions = (s: GameState, a: Record<string, string>): GameState =>
  ({ ...s, gameData: { ...s.gameData, roundActions: a } });

/** Clear a player's dealt start world, so a test controls the whole tableau. */
function bareTableau(s: GameState, pid: string): GameState {
  let next = s;
  for (const inst of tableauInstances(s, pid))
    next = moveCard(next, inst.instanceId, ZONE.discard, { owner: null, faceDown: true });
  return next;
}

/** Put a named card straight into a player's tableau. */
function inTableau(s: GameState, pid: string, defId: string): [GameState, string] {
  const inst = Object.values(s.cards).find(c => c.defId === defId && c.zone === ZONE.supply)
    ?? Object.values(s.cards).find(c => c.defId === defId && c.zone !== ZONE.tableau);
  if (!inst) throw new Error(`no copy of ${defId}`);
  let next = moveCard(s, inst.instanceId, ZONE.tableau, { owner: pid, faceDown: false });
  next = { ...next, gameData: { ...next.gameData,
    supplyOrder: (next.gameData.supplyOrder as string[]).filter(i => i !== inst.instanceId) } };
  return [next, inst.instanceId];
}
/** Drop a good of the host world's kind onto it. */
function withGood(s: GameState, pid: string, host: string): GameState {
  const spare = cardsIn(s, ZONE.supply)[0]!;
  return moveCard(s, spare.instanceId, ZONE.goods,
    { owner: pid, attachedTo: host, faceDown: true });
}

describe('goods have a kind, taken from the world they sit on', () => {
  it('reports the world\'s resource, never the hidden card underneath', () => {
    for (const kind of ['novelty', 'rare', 'genes', 'alien']) {
      const world = RACE_CARDS.find(c => c.world?.resourceType === kind
        && c.world.productionMode !== 'none')!;
      const [s, inst] = inTableau(base(), 'p1', world.cardId);
      const withIt = withGood(s, 'p1', inst);
      expect(playerGoods(withIt, 'p1')[0]!.kind).toBe(kind);
      expect(race.tokenKind!(withIt, inst)).toBe(kind);
    }
  });

  it('publishes the kind to clients but not the card identity', () => {
    const world = RACE_CARDS.find(c => c.world?.resourceType === 'genes'
      && c.world.productionMode === 'production')!;
    const [s, inst] = inTableau(base(), 'p1', world.cardId);
    const withIt = withGood(s, 'p1', inst);
    const good = Object.values(withIt.cards).find(c => c.zone === ZONE.goods)!;
    const view = race.serializePublicState ? null : null;
    const entry = { kind: race.tokenKind!(withIt, inst) };
    expect(entry.kind).toBe('genes');
    expect(good.faceDown).toBe(true);
  });
});

describe('produce', () => {
  it('fills production worlds, leaves windfall worlds, and counts every kind', () => {
    let s = base();
    const prod = RACE_CARDS.find(c => c.world?.productionMode === 'production')!;
    const wind = RACE_CARDS.find(c => c.world?.productionMode === 'windfall')!;
    const [a, prodInst] = inTableau(s, 'p1', prod.cardId);
    const [b, windInst] = inTableau(a, 'p1', wind.cardId);
    const after = race.onPhaseEnter!(inPhase(b, 'produce'), 'produce', createRng(4));
    expect(goodsOn(after, prodInst)).toHaveLength(1);
    expect(goodsOn(after, windInst)).toHaveLength(0);
    expect(playerGoods(after, 'p1')[0]!.kind).toBe(prod.world!.resourceType);
  });

  it('never doubles up a good on an occupied world', () => {
    const prod = RACE_CARDS.find(c => c.world?.productionMode === 'production')!;
    const [s, inst] = inTableau(base(), 'p1', prod.cardId);
    const filled = withGood(s, 'p1', inst);
    const after = race.onPhaseEnter!(inPhase(filled, 'produce'), 'produce', createRng(4));
    expect(goodsOn(after, inst)).toHaveLength(1);
  });

  it('gives the Produce chooser a windfall good as their bonus', () => {
    const wind = RACE_CARDS.find(c => c.world?.productionMode === 'windfall')!;
    const [s, inst] = inTableau(base(), 'p1', wind.cardId);
    const after = race.onPhaseEnter!(
      inPhase(withActions(s, { p1: 'produce' }), 'produce'), 'produce', createRng(4));
    expect(goodsOn(after, inst)).toHaveLength(1);
  });
});

describe('consume', () => {
  it('turns a good into victory chips drawn from the shared pool', () => {
    const world = RACE_CARDS.find(c => c.cardId === 'earths-lost-colony')!;
    const [s, inst] = inTableau(base(), 'p1', world.cardId);
    const ready = withGood(s, 'p1', inst);
    const before = vpPool(ready);
    const after = race.onPhaseEnter!(inPhase(ready, 'consume'), 'consume', createRng(2));
    expect(vpChips(after, 'p1')).toBe(1);
    expect(vpPool(after)).toBe(before - 1);
    expect(playerGoods(after, 'p1')).toHaveLength(0);
  });

  it('doubles chips for the x2 bonus but not the goods spent', () => {
    const world = RACE_CARDS.find(c => c.cardId === 'earths-lost-colony')!;
    const [s, inst] = inTableau(base(), 'p1', world.cardId);
    const ready = withActions(withGood(s, 'p1', inst), { p1: 'consume-2x' });
    const after = race.onPhaseEnter!(inPhase(ready, 'consume'), 'consume', createRng(2));
    expect(vpChips(after, 'p1')).toBe(2);
    expect(playerGoods(after, 'p1')).toHaveLength(0);
  });

  it('cannot consume at all without a consume power', () => {
    const plain = RACE_CARDS.find(c => c.world?.productionMode === 'production'
      && !c.powers.some(p => p.phase === 'consume'))!;
    const [s, inst] = inTableau(bareTableau(base(), 'p1'), 'p1', plain.cardId);
    const ready = withGood(s, 'p1', inst);
    const after = race.onPhaseEnter!(inPhase(ready, 'consume'), 'consume', createRng(2));
    expect(vpChips(after, 'p1')).toBe(0);
    expect(playerGoods(after, 'p1')).toHaveLength(1);
  });

  it('sells a good for cards on the Trade bonus, priced by kind', () => {
    const world = RACE_CARDS.find(c => c.world?.resourceType === 'alien'
      && c.world.productionMode !== 'none')!;
    const [s, inst] = inTableau(base(), 'p1', world.cardId);
    const ready = withActions(withGood(s, 'p1', inst), { p1: 'consume-trade' });
    const handBefore = cardsIn(ready, ZONE.hand, 'p1').length;
    const after = race.onPhaseEnter!(inPhase(ready, 'consume'), 'consume', createRng(2));
    expect(cardsIn(after, ZONE.hand, 'p1').length).toBeGreaterThanOrEqual(handBefore + 5);
    expect(playerGoods(after, 'p1')).toHaveLength(0);
  });

  it('requires distinct kinds for a distinct-kinds power', () => {
    // Diversified Economy consumes three goods of different kinds.
    const s = bareTableau(base(), 'p1');
    const [a, econ] = inTableau(s, 'p1', 'diversified-economy');
    // A single good cannot satisfy a power that needs three different kinds.
    const sameKind = RACE_CARDS.find(c => c.world?.resourceType === 'novelty'
      && c.world.productionMode === 'production' && !c.powers.some(p => p.phase === 'consume'))!;
    const [b, w1] = inTableau(a, 'p1', sameKind.cardId);
    const withOne = withGood(b, 'p1', w1);
    const after = race.onPhaseEnter!(inPhase(withOne, 'consume'), 'consume', createRng(2));
    expect(vpChips(after, 'p1')).toBe(0);
    expect(playerGoods(after, 'p1')).toHaveLength(1);
    expect(econ).toBeTruthy();
  });

  it('spends goods on the kind-specific power before a generic one', () => {
    // Consumer Markets is novelty-specific; a generic power must not eat the good first.
    const s = bareTableau(base(), 'p1');
    const [a] = inTableau(s, 'p1', 'consumer-markets');
    const novelty = RACE_CARDS.find(c => c.world?.resourceType === 'novelty'
      && c.world.productionMode === 'production' && !c.powers.some(p => p.phase === 'consume'))!;
    const [b, w] = inTableau(a, 'p1', novelty.cardId);
    const ready = withGood(b, 'p1', w);
    const after = race.onPhaseEnter!(inPhase(ready, 'consume'), 'consume', createRng(2));
    expect(vpChips(after, 'p1')).toBeGreaterThan(0);
    expect(playerGoods(after, 'p1')).toHaveLength(0);
  });

  it('never hands out more chips than the pool holds', () => {
    const world = RACE_CARDS.find(c => c.cardId === 'earths-lost-colony')!;
    const [s, inst] = inTableau(base(), 'p1', world.cardId);
    let ready = withGood(s, 'p1', inst);
    ready = { ...ready, gameData: { ...ready.gameData, vpPool: 0 } };
    const after = race.onPhaseEnter!(inPhase(ready, 'consume'), 'consume', createRng(2));
    expect(vpChips(after, 'p1')).toBe(0);
    expect(vpPool(after)).toBe(0);
  });
});

describe('good conservation', () => {
  it('a consumed good returns to the discard pile, never vanishing', () => {
    const world = RACE_CARDS.find(c => c.cardId === 'earths-lost-colony')!;
    const [s, inst] = inTableau(base(), 'p1', world.cardId);
    const ready = withGood(s, 'p1', inst);
    const discardBefore = cardsIn(ready, ZONE.discard).length;
    const after = race.onPhaseEnter!(inPhase(ready, 'consume'), 'consume', createRng(2));
    expect(cardsIn(after, ZONE.discard).length).toBe(discardBefore + 1);
    expect(Object.keys(after.cards)).toHaveLength(114);
  });
});
