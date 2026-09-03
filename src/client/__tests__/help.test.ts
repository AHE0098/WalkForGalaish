import { describe, expect, it } from 'vitest';
import { cardHelp } from '../cardHelp.js';
import type { CardFace } from '../cardDb.js';
import data from '../../games/race-for-the-galaxy/cards/race_for_the_galaxy_base_cards.json'
  with { type: 'json' };

const cards = (data as unknown as { cards: CardFace[] }).cards;
const find = (p: (c: CardFace) => boolean) => cards.find(p)!;

describe('card help', () => {
  it('tells a military world it must be conquered, not bought', () => {
    const h = cardHelp(find(c => c.world?.settlementMode === 'military'));
    expect(h.headline).toMatch(/conquered/i);
    expect(h.callouts[0]!.title).toMatch(/Defense/);
    expect(h.callouts[0]!.text).toMatch(/military must be at least/);
  });

  it('tells a payment world that military does not help', () => {
    const h = cardHelp(find(c => c.world?.settlementMode === 'payment'));
    expect(h.callouts[0]!.title).toMatch(/Cost/);
    expect(h.callouts[0]!.text).toMatch(/Military does not help/);
  });

  it('explains windfall and production differently', () => {
    const wind = cardHelp(find(c => c.world?.productionMode === 'windfall'));
    const prod = cardHelp(find(c => c.world?.productionMode === 'production'));
    expect(wind.headline).toMatch(/arrives holding a good/);
    expect(prod.headline).toMatch(/produces a good/);
    expect(wind.callouts.some(c => /halo/i.test(c.title))).toBe(true);
    expect(prod.callouts.some(c => /filled circle/i.test(c.title))).toBe(true);
  });

  it('describes six-cost developments as end-game scorers', () => {
    const h = cardHelp(find(c => c.isSixCostDevelopment));
    expect(h.headline).toMatch(/end-game/i);
    expect(h.callouts.some(c => c.title.includes('?'))).toBe(true);
    expect(h.callouts.some(c => c.title.includes('★'))).toBe(true);
  });

  it('flags rebel, alien and start worlds when relevant', () => {
    expect(cardHelp(find(c => !!c.world?.isRebel)).callouts.some(c => /Rebel/.test(c.title))).toBe(true);
    expect(cardHelp(find(c => !!c.world?.isAlien)).callouts.some(c => /Alien/.test(c.title))).toBe(true);
    expect(cardHelp(find(c => c.isStartWorld)).callouts.some(c => /Start/.test(c.title))).toBe(true);
  });

  it('gives every card a headline, unique callout numbers, and no empty text', () => {
    for (const c of cards) {
      const h = cardHelp(c);
      expect(h.headline.length).toBeGreaterThan(4);
      expect(h.callouts.length).toBeGreaterThanOrEqual(2);
      expect(new Set(h.callouts.map(x => x.n)).size).toBe(h.callouts.length);
      for (const co of h.callouts) expect(co.text.length).toBeGreaterThan(10);
    }
  });
});
