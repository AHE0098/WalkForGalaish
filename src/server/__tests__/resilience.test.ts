import { describe, expect, it } from 'vitest';
import { GameHost, emptyState } from '../gameHost.js';
import { ZONE, cardsIn } from '../../core/zones.js';
import type { Player } from '../../core/types.js';

const players: Player[] = [
  { id: 'p1', name: 'One', seat: 0, connected: true, ready: false },
  { id: 'p2', name: 'Two', seat: 1, connected: true, ready: false },
];
const host = (seed = 5) => {
  const h = new GameHost(emptyState(players.map(p => ({ ...p }))), 'race-for-the-galaxy', seed);
  h.start();
  return h;
};
/** Push both players through the opening 6-choose-4 discard. */
function openingDone(h: GameHost) {
  for (const p of h.state.players) {
    const two = cardsIn(h.state, ZONE.hand, p.id).slice(0, 2).map(c => c.instanceId);
    h.submit(p.id, { type: 'DISCARD_CARDS', phaseId: h.state.phaseId,
      payload: { instanceIds: two } });
  }
  return h;
}

describe('absent players', () => {
  it('are played for after the grace period, so the table is never stuck', () => {
    const h = openingDone(host());
    h.submit('p1', { type: 'SELECT_ACTION_CARD', phaseId: h.state.phaseId,
      payload: { actionCard: 'develop' } });
    expect(h.state.hiddenChoices.p2).toBeUndefined();

    h.setConnected('p2', false);
    expect(h.tick(Date.now())).toBe(false);            // still inside the grace period
    expect(h.tick(Date.now() + 10_000)).toBe(true);    // grace elapsed
    expect(h.state.log.some(l => l.includes('auto-played'))).toBe(true);
  });

  it('leaves connected players alone until the phase clock expires', () => {
    const h = openingDone(host());
    expect(h.tick(Date.now())).toBe(false);
    const before = h.state.version;
    h.tick(h.deadlineAt + 1000);
    expect(h.state.version).toBeGreaterThan(before);
  });

  it('keeps a live clock', () => {
    const h = openingDone(host());
    expect(h.secondsLeft()).toBeGreaterThan(0);
  });
});

describe('reconnecting', () => {
  it('keeps the seat and its hand across a disconnect', () => {
    const h = openingDone(host());
    const handBefore = h.view('p2').hand.map(c => c.instanceId);
    h.setConnected('p2', false);
    expect(h.state.players.find(p => p.id === 'p2')!.connected).toBe(false);
    h.setConnected('p2', true);
    expect(h.state.players.find(p => p.id === 'p2')!.connected).toBe(true);
    expect(h.view('p2').hand.map(c => c.instanceId)).toEqual(handBefore);
  });

  it('stops auto-playing once the player is back', () => {
    const h = openingDone(host());
    h.setConnected('p2', false);
    h.setConnected('p2', true);
    expect(h.tick(Date.now() + 10_000)).toBe(false);
  });
});

describe('player-facing view', () => {
  it('reports live military and goods for every player', () => {
    const v = openingDone(host()).view('p1');
    for (const p of v.players) {
      expect(typeof p.stats.military).toBe('number');
      expect(typeof p.stats.goods).toBe('number');
    }
  });

  it('still hides the opponent hand', () => {
    const h = openingDone(host());
    const other = h.view('p2').hand.map(c => c.instanceId);
    expect(JSON.stringify(h.view('p1'))).not.toContain(other[0]);
  });
});
