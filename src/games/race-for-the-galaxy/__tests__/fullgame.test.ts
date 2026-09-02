import { describe, expect, it } from 'vitest';
import { GameHost, emptyState } from '../../../server/gameHost.js';
import { ZONE, cardsIn } from '../../../core/zones.js';
import { scoreBreakdown } from '../rules.js';
import type { Player } from '../../../core/types.js';

const players: Player[] = [
  { id: 'p1', name: 'One', seat: 0, connected: true, ready: false },
  { id: 'p2', name: 'Two', seat: 1, connected: true, ready: false },
];
const ACTIONS = ['explore-5', 'explore-1-1', 'develop', 'settle', 'consume-trade',
                 'consume-2x', 'produce'];

/** Plays a whole game with a simple bot: always act if legal, otherwise continue. */
function playGame(seed: number, maxRounds = 60) {
  const host = new GameHost(emptyState(players.map(p => ({ ...p }))), 'race-for-the-galaxy', seed);
  host.start();
  let guard = 0;

  while (host.state.status === 'playing' && host.state.round <= maxRounds && guard++ < 4000) {
    for (const p of host.state.players) {
      if (host.state.status !== 'playing') break;
      const legal = host.state.gameData.openingDiscard
        ? ['DISCARD_CARDS'] : host.view(p.id).legalActions;
      const phaseId = host.state.phaseId;

      if (legal.includes('DISCARD_CARDS')) {
        const two = cardsIn(host.state, ZONE.hand, p.id).slice(0, 2).map(c => c.instanceId);
        host.submit(p.id, { type: 'DISCARD_CARDS', phaseId, payload: { instanceIds: two } });
      } else if (legal.includes('SELECT_ACTION_CARD')) {
        if (host.state.hiddenChoices[p.id] === undefined)
          host.submit(p.id, { type: 'SELECT_ACTION_CARD', phaseId,
            payload: { actionCard: ACTIONS[(guard + p.seat) % ACTIONS.length] } });
      } else if (legal.includes('KEEP_CARDS')) {
        const view = host.view(p.id);
        const keep = Math.min((view.info.keepCount as number) ?? 1, view.selection.length);
        host.submit(p.id, { type: 'KEEP_CARDS', phaseId,
          payload: { instanceIds: view.selection.slice(0, keep).map(c => c.instanceId) } });
      } else if (legal.includes('PLAY_CARD')) {
        const view = host.view(p.id);
        const pick = Object.entries(view.playable).find(([, v]) => v.ok);
        if (pick) {
          const [instanceId, info] = pick;
          const payment = view.hand.filter(c => c.instanceId !== instanceId)
            .slice(0, info.cost ?? 0).map(c => c.instanceId);
          const r = host.submit(p.id, { type: 'PLAY_CARD', phaseId,
            payload: { instanceId, payment } });
          if (!r.ok) host.submit(p.id, { type: 'PASS', phaseId });
        } else host.submit(p.id, { type: 'PASS', phaseId });
      } else {
        host.ready(p.id, phaseId, true);
      }
    }
  }
  return host;
}

describe('a complete game', () => {
  it('reaches an end condition and produces final scores', () => {
    const host = playGame(2024);
    expect(host.state.status).toBe('finished');

    for (const p of host.state.players) {
      const b = scoreBreakdown(host.state, p.id);
      expect(b.total).toBe(b.cards + b.chips + b.bonus);
      expect(b.total).toBeGreaterThan(0);
    }
    const ended = host.state.players.some(p =>
      cardsIn(host.state, ZONE.tableau, p.id).length >= 12)
      || (host.state.gameData.vpPool as number) <= 0;
    expect(ended).toBe(true);
  });

  it('never lets a player hold more than the hand limit at a round boundary', () => {
    const host = playGame(77);
    for (const p of host.state.players)
      expect(cardsIn(host.state, ZONE.hand, p.id).length).toBeLessThanOrEqual(10);
  });

  it('conserves every card: nothing is created or lost', () => {
    const host = playGame(31);
    const zones = [ZONE.supply, ZONE.hand, ZONE.discard, ZONE.tableau, ZONE.goods, ZONE.selection];
    const counted = Object.values(host.state.cards).filter(c => zones.includes(c.zone as never));
    expect(counted).toHaveLength(114);
  });

  it('finishes from several different seeds', () => {
    for (const seed of [1, 99, 4242]) expect(playGame(seed).state.status).toBe('finished');
  });
});
