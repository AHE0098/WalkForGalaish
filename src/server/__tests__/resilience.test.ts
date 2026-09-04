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

  it('never forces a connected player, however long they think', () => {
    const h = openingDone(host());
    const before = h.state.version;
    // Far beyond any plausible clock.
    expect(h.tick(Date.now() + 60 * 60_000)).toBe(false);
    expect(h.state.version).toBe(before);
  });
});

describe('round bookkeeping', () => {
  it('does not carry chosen actions into the next round', () => {
    const h = openingDone(host());
    for (const p of h.state.players)
      h.submit(p.id, { type: 'SELECT_ACTION_CARD', phaseId: h.state.phaseId,
        payload: { actionCard: 'develop' } });
    expect(h.view('p1').roundActions.p1).toBe('develop');

    // Drive the round to its end: both pass, then continue through every phase.
    let guard = 0;
    while (h.state.phaseIndex >= 0 && guard++ < 40) {
      for (const p of h.state.players) {
        const legal = h.view(p.id).legalActions;
        if (legal.includes('PASS')) h.submit(p.id, { type: 'PASS', phaseId: h.state.phaseId });
        else if (legal.includes('KEEP_CARDS')) {
          const v = h.view(p.id);
          const k = Math.min((v.info.keepCount as number) ?? 1, v.selection.length);
          h.submit(p.id, { type: 'KEEP_CARDS', phaseId: h.state.phaseId,
            payload: { instanceIds: v.selection.slice(0, k).map(c => c.instanceId) } });
        } else h.ready(p.id, h.state.phaseId, true);
      }
    }

    // A new round: nobody has chosen, and the client is offered the choice again.
    const v = h.view('p1');
    expect(v.currentPhase).toBeNull();
    expect(v.yourChoiceSubmitted).toBe(false);
    expect(v.roundActions).toEqual({});
    expect(v.legalActions).toEqual(['SELECT_ACTION_CARD']);
    expect(v.waitingOn.length).toBe(2);
  });

  it('reports who the table is waiting on', () => {
    const h = openingDone(host());
    expect(h.view('p1').waitingOn.sort()).toEqual(['One', 'Two']);
    h.submit('p1', { type: 'SELECT_ACTION_CARD', phaseId: h.state.phaseId,
      payload: { actionCard: 'settle' } });
    expect(h.view('p1').waitingOn).toEqual(['Two']);
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
