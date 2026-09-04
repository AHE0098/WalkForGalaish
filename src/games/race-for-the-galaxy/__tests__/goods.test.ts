import { describe, expect, it } from 'vitest';
import { createRng } from '../../../core/random.js';
import { ZONE, cardsIn, moveCard } from '../../../core/zones.js';
import { raceForTheGalaxy as race } from '../definition.js';
import { RACE_CARDS, card } from '../cards.js';
import {
  canSettle, goodsOn, hasFreeSettle, militaryStrength, playerGoods, settleCost,
  tableauInstances, vpChips, vpPool,
} from '../rules.js';
import { emptyState } from '../../../server/gameHost.js';
import type { PlayerOption } from '../../../core/types.js';
import { serializeForPlayer } from '../../../core/serialize.js';
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
    const view = serializeForPlayer(withIt, race, 'p2');   // an opponent's view
    const entry = view.players.find(p => p.id === 'p1')!.tableau
      .find(t => t.instanceId === inst)!.goods[0]!;
    expect(entry.kind).toBe('genes');
    expect(good.faceDown).toBe(true);
    // The kind is public; the card sitting under it is not.
    expect(JSON.stringify(view)).not.toContain(good.instanceId);
  });
});

describe('produce', () => {
  it('fills production worlds, leaves windfall worlds, and counts every kind', () => {
    let s = base();
    const prod = RACE_CARDS.find(c => c.world?.productionMode === 'production')!;
    const wind = RACE_CARDS.find(c => c.world?.productionMode === 'windfall')!;
    const [a, prodInst] = inTableau(s, 'p1', prod.cardId);
    const [b, windInst] = inTableau(a, 'p1', wind.cardId);
    const after = produce(inPhase(b, 'produce'), 'p1');
    expect(goodsOn(after, prodInst)).toHaveLength(1);
    expect(goodsOn(after, windInst)).toHaveLength(0);
    expect(playerGoods(after, 'p1')[0]!.kind).toBe(prod.world!.resourceType);
  });

  it('never doubles up a good on an occupied world', () => {
    const prod = RACE_CARDS.find(c => c.world?.productionMode === 'production')!;
    const [s, inst] = inTableau(base(), 'p1', prod.cardId);
    const filled = withGood(s, 'p1', inst);
    const after = produce(inPhase(filled, 'produce'), 'p1');
    expect(goodsOn(after, inst)).toHaveLength(1);
  });

  it('gives the Produce chooser a windfall good as their bonus', () => {
    const wind = RACE_CARDS.find(c => c.world?.productionMode === 'windfall')!;
    const [s, inst] = inTableau(base(), 'p1', wind.cardId);
    const after = produce(inPhase(withActions(s, { p1: 'produce' }), 'produce'), 'p1');
    expect(goodsOn(after, inst)).toHaveLength(1);
  });
});

/** Put a named card into a player's hand. */
function giveCard(s: GameState, pid: string, defId: string): [GameState, string] {
  const inst = Object.values(s.cards).find(c => c.defId === defId && c.zone === ZONE.supply)
    ?? Object.values(s.cards).find(c => c.defId === defId && c.zone !== ZONE.tableau);
  if (!inst) throw new Error(`no copy of ${defId}`);
  let next = moveCard(s, inst.instanceId, ZONE.hand, { owner: pid, faceDown: false });
  next = { ...next, gameData: { ...next.gameData,
    supplyOrder: (next.gameData.supplyOrder as string[]).filter(i => i !== inst.instanceId) } };
  return [next, inst.instanceId];
}

/** Confirm the compulsory Produce step for a player. */
function produce(s: GameState, pid: string): GameState {
  const r = race.resolveAction(s, pid,
    { type: 'CHOOSE_OPTION', phaseId: s.phaseId, payload: { optionId: '@produce' } },
    createRng(4));
  if (!r.ok) throw new Error(r.error);
  return r.state!;
}

/** Take a named option, or the first one offered. */
function choose(s: GameState, pid: string, match?: (o: PlayerOption) => boolean): GameState {
  const opts = race.playerOptions!(s, pid);
  const pick = match ? opts.find(match) : opts[0];
  if (!pick) throw new Error(`no option matching; had: ${opts.map(o => o.id).join(', ')}`);
  const r = race.resolveAction(s, pid,
    { type: 'CHOOSE_OPTION', phaseId: s.phaseId, payload: { optionId: pick.id } }, createRng(1));
  if (!r.ok) throw new Error(r.error);
  return r.state!;
}

describe('consume', () => {
  it('turns a good into victory chips drawn from the shared pool', () => {
    const world = RACE_CARDS.find(c => c.cardId === 'earths-lost-colony')!;
    const [s, inst] = inTableau(base(), 'p1', world.cardId);
    const ready = withGood(s, 'p1', inst);
    const before = vpPool(ready);
    const after = choose(inPhase(ready, 'consume'), 'p1');
    expect(vpChips(after, 'p1')).toBe(1);
    expect(vpPool(after)).toBe(before - 1);
    expect(playerGoods(after, 'p1')).toHaveLength(0);
  });

  it('doubles chips for the x2 bonus but not the goods spent', () => {
    const world = RACE_CARDS.find(c => c.cardId === 'earths-lost-colony')!;
    const [s, inst] = inTableau(base(), 'p1', world.cardId);
    const ready = withActions(withGood(s, 'p1', inst), { p1: 'consume-2x' });
    const after = choose(inPhase(ready, 'consume'), 'p1');
    expect(vpChips(after, 'p1')).toBe(2);
    expect(playerGoods(after, 'p1')).toHaveLength(0);
  });

  it('cannot consume at all without a consume power', () => {
    const plain = RACE_CARDS.find(c => c.world?.productionMode === 'production'
      && !c.powers.some(p => p.phase === 'consume'))!;
    const [s, inst] = inTableau(bareTableau(base(), 'p1'), 'p1', plain.cardId);
    const ready = inPhase(withGood(s, 'p1', inst), 'consume');
    expect(race.playerOptions!(ready, 'p1')).toEqual([]);
    expect(race.legalActions(ready, 'p1')).toEqual(['READY']);
    expect(vpChips(ready, 'p1')).toBe(0);
    expect(playerGoods(ready, 'p1')).toHaveLength(1);
  });

  it('sells a good for cards on the Trade bonus, priced by kind', () => {
    const world = RACE_CARDS.find(c => c.world?.resourceType === 'alien'
      && c.world.productionMode !== 'none')!;
    const [s, inst] = inTableau(base(), 'p1', world.cardId);
    const ready = withActions(withGood(s, 'p1', inst), { p1: 'consume-trade' });
    const handBefore = cardsIn(ready, ZONE.hand, 'p1').length;
    const after = choose(inPhase(ready, 'consume'), 'p1', o => o.id.startsWith('trade:'));
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
    const ready = inPhase(withOne, 'consume');
    expect(race.playerOptions!(ready, 'p1')).toEqual([]);   // one good cannot satisfy it
    expect(vpChips(ready, 'p1')).toBe(0);
    expect(playerGoods(ready, 'p1')).toHaveLength(1);
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
    const after = choose(inPhase(ready, 'consume'), 'p1');
    expect(vpChips(after, 'p1')).toBeGreaterThan(0);
    expect(playerGoods(after, 'p1')).toHaveLength(0);
  });

  it('never hands out more chips than the pool holds', () => {
    const world = RACE_CARDS.find(c => c.cardId === 'earths-lost-colony')!;
    const [s, inst] = inTableau(base(), 'p1', world.cardId);
    let ready = withGood(s, 'p1', inst);
    ready = { ...ready, gameData: { ...ready.gameData, vpPool: 0 } };
    const after = choose(inPhase(ready, 'consume'), 'p1');
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
    const after = choose(inPhase(ready, 'consume'), 'p1');
    expect(cardsIn(after, ZONE.discard).length).toBe(discardBefore + 1);
    expect(Object.keys(after.cards)).toHaveLength(114);
  });
});

describe('the player decides, not the engine', () => {
  it('offers one option per good kind for the Trade bonus, and spends only that one', () => {
    // Two goods of different kinds: the player must be able to pick which to sell.
    let s = bareTableau(base(), 'p1');
    const genes = RACE_CARDS.find(c => c.world?.resourceType === 'genes'
      && c.world.productionMode !== 'none')!;
    const alien = RACE_CARDS.find(c => c.world?.resourceType === 'alien'
      && c.world.productionMode !== 'none')!;
    const [a, gInst] = inTableau(s, 'p1', genes.cardId);
    const [b, aInst] = inTableau(a, 'p1', alien.cardId);
    let ready = withGood(withGood(b, 'p1', gInst), 'p1', aInst);
    ready = inPhase(withActions(ready, { p1: 'consume-trade' }), 'consume');

    const opts = race.playerOptions!(ready, 'p1').filter(o => o.id.startsWith('trade:'));
    expect(opts.map(o => o.id).sort()).toEqual(['trade:alien', 'trade:genes']);

    const after = choose(ready, 'p1', o => o.id === 'trade:genes');
    const left = playerGoods(after, 'p1');
    expect(left).toHaveLength(1);
    expect(left[0]!.kind).toBe('alien');          // the other good is untouched
  });

  it('does not sell a second good once the Trade bonus is used', () => {
    let s = bareTableau(base(), 'p1');
    const genes = RACE_CARDS.find(c => c.world?.resourceType === 'genes'
      && c.world.productionMode !== 'none')!;
    const [a, inst] = inTableau(s, 'p1', genes.cardId);
    let ready = inPhase(withActions(withGood(withGood(a, 'p1', inst), 'p1', inst),
      { p1: 'consume-trade' }), 'consume');
    const after = choose(ready, 'p1', o => o.id.startsWith('trade:'));
    expect(race.playerOptions!(after, 'p1').some(o => o.id.startsWith('trade:'))).toBe(false);
  });

  it('will not let the table move on while a consume power can still be used', () => {
    const world = RACE_CARDS.find(c => c.cardId === 'earths-lost-colony')!;
    const [s, inst] = inTableau(bareTableau(base(), 'p1'), 'p1', world.cardId);
    const ready = inPhase(withGood(s, 'p1', inst), 'consume');
    expect(race.legalActions(ready, 'p1')).toEqual(['CHOOSE_OPTION', 'AUTO_RESOLVE']);
    const after = choose(ready, 'p1');
    expect(race.legalActions(after, 'p1')).toEqual(['READY']);
  });

  it('uses each consume power at most once per phase', () => {
    const world = RACE_CARDS.find(c => c.cardId === 'earths-lost-colony')!;
    const [s, inst] = inTableau(bareTableau(base(), 'p1'), 'p1', world.cardId);
    const two = withGood(withGood(s, 'p1', inst), 'p1', inst);
    const after = choose(inPhase(two, 'consume'), 'p1');
    expect(race.playerOptions!(after, 'p1')).toEqual([]);
    expect(playerGoods(after, 'p1')).toHaveLength(1);   // second good survives
  });

  it('resolves everything when the player asks it to, and only then', () => {
    const world = RACE_CARDS.find(c => c.cardId === 'earths-lost-colony')!;
    const [s, inst] = inTableau(bareTableau(base(), 'p1'), 'p1', world.cardId);
    const ready = inPhase(withGood(s, 'p1', inst), 'consume');
    expect(vpChips(ready, 'p1')).toBe(0);              // nothing happened on entry
    const r = race.resolveAction(ready, 'p1',
      { type: 'AUTO_RESOLVE', phaseId: ready.phaseId }, createRng(1));
    expect(r.ok).toBe(true);
    expect(vpChips(r.state!, 'p1')).toBe(1);
  });
});

describe('forced moves are still confirmed', () => {
  it('marks Produce as forced and does nothing until it is confirmed', () => {
    const prod = RACE_CARDS.find(c => c.world?.productionMode === 'production')!;
    const [s, inst] = inTableau(bareTableau(base(), 'p1'), 'p1', prod.cardId);
    const ready = inPhase(s, 'produce');
    const opts = race.playerOptions!(ready, 'p1');
    expect(opts).toHaveLength(1);
    expect(opts[0]!.forced).toBe(true);
    expect(opts[0]!.detail).toBe('compulsory');
    expect(goodsOn(ready, inst)).toHaveLength(0);      // nothing happened yet
    expect(race.legalActions(ready, 'p1')).toEqual(['CHOOSE_OPTION']);

    const after = produce(ready, 'p1');
    expect(goodsOn(after, inst)).toHaveLength(1);
    expect(race.legalActions(after, 'p1')).toEqual(['READY']);
  });

  it('cannot produce twice in one phase', () => {
    const prod = RACE_CARDS.find(c => c.world?.productionMode === 'production')!;
    const [s] = inTableau(bareTableau(base(), 'p1'), 'p1', prod.cardId);
    const after = produce(inPhase(s, 'produce'), 'p1');
    expect(race.playerOptions!(after, 'p1')).toEqual([]);
  });
});

describe('discarding for victory points', () => {
  it('asks which cards to give up rather than taking the first ones', () => {
    const [s] = inTableau(bareTableau(base(), 'p1'), 'p1', 'deficit-spending');
    const ready = inPhase(s, 'consume');
    const opt = race.playerOptions!(ready, 'p1')
      .find(o => o.label.includes('Deficit Spending'))!;
    expect(opt).toBeTruthy();

    const chosen = choose(ready, 'p1', o => o.id === opt.id);
    const pending = (chosen.gameData.pending as Record<string, { count: number }>)?.p1;
    expect(pending?.count).toBe(2);
    expect(race.legalActions(chosen, 'p1')).toEqual(['SUBMIT_SELECTION']);
    // Nothing has been discarded yet: the player still has to pick.
    expect(cardsIn(chosen, ZONE.hand, 'p1')).toHaveLength(cardsIn(ready, ZONE.hand, 'p1').length);

    const hand = cardsIn(chosen, ZONE.hand, 'p1');
    const give = hand.slice(-2).map(c => c.instanceId);
    const done = race.resolveAction(chosen, 'p1',
      { type: 'SUBMIT_SELECTION', phaseId: chosen.phaseId, payload: { instanceIds: give } },
      createRng(1));
    expect(done.ok).toBe(true);
    expect(vpChips(done.state!, 'p1')).toBe(2);
    expect(cardsIn(done.state!, ZONE.hand, 'p1').map(c => c.instanceId))
      .not.toContain(give[0]);
  });

  it('rejects a selection of the wrong size', () => {
    const [s] = inTableau(bareTableau(base(), 'p1'), 'p1', 'deficit-spending');
    const chosen = choose(inPhase(s, 'consume'), 'p1',
      o => o.label.includes('Deficit Spending'));
    const one = cardsIn(chosen, ZONE.hand, 'p1').slice(0, 1).map(c => c.instanceId);
    const r = race.resolveAction(chosen, 'p1',
      { type: 'SUBMIT_SELECTION', phaseId: chosen.phaseId, payload: { instanceIds: one } },
      createRng(1));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/exactly 2/);
  });
});

describe('discard-this-card powers (Settle)', () => {
  const bigMilitary = () => RACE_CARDS.find(c => c.world?.settlementMode === 'military'
    && (c.world.defense ?? 0) === 3 && c.world.resourceType !== 'alien')!;

  it('New Military Tactics grants temporary military and is spent doing so', () => {
    const target = bigMilitary();
    let s = bareTableau(base(), 'p1');
    const [a, tacticsInst] = inTableau(s, 'p1', 'new-military-tactics');
    s = inPhase(a, 'settle');
    expect(militaryStrength(s, 'p1')).toBe(0);
    expect(canSettle(s, 'p1', target.cardId)).toMatch(/Needs 3 military/);

    const opts = race.playerOptions!(s, 'p1');
    expect(opts.some(o => o.label.includes('New Military Tactics'))).toBe(true);

    const after = choose(s, 'p1', o => o.label.includes('New Military Tactics'));
    expect(militaryStrength(after, 'p1')).toBe(3);
    expect(canSettle(after, 'p1', target.cardId)).toBeNull();
    // The card itself is gone, and cannot be discarded twice.
    expect(cardsIn(after, ZONE.tableau, 'p1').map(c => c.instanceId)).not.toContain(tacticsInst);
    expect(race.playerOptions!(after, 'p1')
      .some(o => o.label.includes('New Military Tactics'))).toBe(false);
  });

  it('the military boost does not survive into another phase', () => {
    const [a] = inTableau(bareTableau(base(), 'p1'), 'p1', 'new-military-tactics');
    const after = choose(inPhase(a, 'settle'), 'p1');
    expect(militaryStrength(after, 'p1')).toBe(3);
    const nextPhase = { ...after, phaseId: 'a-later-phase' };
    expect(militaryStrength(nextPhase, 'p1')).toBe(0);
  });

  it('Colony Ship makes the next non-military world free', () => {
    const world = RACE_CARDS.find(c => c.world?.settlementMode === 'payment'
      && (c.world.settleCost ?? 0) >= 3 && c.world.resourceType !== 'alien')!;
    const [a] = inTableau(bareTableau(base(), 'p1'), 'p1', 'colony-ship');
    const [b, worldInst] = giveCard(a, 'p1', world.cardId);
    const s = inPhase(b, 'settle');
    expect(settleCost(s, 'p1', world)).toBe(world.world!.settleCost);

    const after = choose(s, 'p1', o => o.label.includes('Colony Ship'));
    expect(settleCost(after, 'p1', world)).toBe(0);
    expect(race.playability!(after, 'p1')[worldInst]!.cost).toBe(0);

    const played = race.resolveAction(after, 'p1',
      { type: 'PLAY_CARD', phaseId: after.phaseId,
        payload: { instanceId: worldInst, payment: [] } }, createRng(1));
    expect(played.ok).toBe(true);
    // Spent by the world it paid for.
    expect(hasFreeSettle(played.state!, 'p1')).toBe(false);
  });

  it('Contact Specialist lets a military world be bought at defense minus one', () => {
    const target = bigMilitary();
    const [a] = inTableau(bareTableau(base(), 'p1'), 'p1', 'contact-specialist');
    const [b, worldInst] = giveCard(a, 'p1', target.cardId);
    const s = inPhase(b, 'settle');
    expect(canSettle(s, 'p1', target.cardId)).toBeNull();
    expect(race.playability!(s, 'p1')[worldInst]!.cost).toBe(2);   // defense 3 − 1

    const hand = cardsIn(s, ZONE.hand, 'p1').filter(c => c.instanceId !== worldInst);
    const r = race.resolveAction(s, 'p1', { type: 'PLAY_CARD', phaseId: s.phaseId,
      payload: { instanceId: worldInst, payment: hand.slice(0, 2).map(c => c.instanceId) } },
      createRng(1));
    expect(r.ok).toBe(true);
  });

  it('Contact Specialist may not buy an Alien production or windfall world', () => {
    const alien = RACE_CARDS.find(c => c.world?.settlementMode === 'military'
      && c.world.resourceType === 'alien' && c.world.productionMode !== 'none')!;
    const [a] = inTableau(bareTableau(base(), 'p1'), 'p1', 'contact-specialist');
    const [b] = giveCard(a, 'p1', alien.cardId);
    expect(canSettle(inPhase(b, 'settle'), 'p1', alien.cardId)).toMatch(/military/);
  });
});
