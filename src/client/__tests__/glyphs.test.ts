import { describe, expect, it } from 'vitest';
import { powerSegments } from '../cardDb.js';
import { segmentsToText } from '../glyphs.js';
import type { CardFace } from '../cardDb.js';
import data from '../../games/race-for-the-galaxy/cards/race_for_the_galaxy_base_cards.json';

const cards = (data as unknown as { cards: CardFace[] }).cards;
const all = cards.flatMap(c => c.powers);
const first = (t: string) => all.find(p => p.effectType === t)!;

describe('rule text uses symbols, not words', () => {
  it('draws military as a symbol rather than the word', () => {
    const segs = powerSegments(first('militaryStrength'));
    expect(segs.some(s => s.t === 'military')).toBe(true);
    expect(segs.filter(s => s.t === 'text').map(s => (s as any).v).join(''))
      .not.toMatch(/military/i);
  });

  it('draws goods as tokens, one per good consumed', () => {
    const power = all.find(p => p.effectType === 'consumeGoods'
      && (p.goodsConsumed ?? 1) === 2)!;
    const segs = powerSegments(power);
    expect(segs.filter(s => s.t === 'good')).toHaveLength(2);
  });

  it('carries the resource kind onto the token', () => {
    const power = all.find(p => p.effectType === 'consumeGoods'
      && p.conditions?.resourceType === 'genes')!;
    const segs = powerSegments(power);
    expect(segs.some(s => s.t === 'good' && (s as any).kind === 'genes')).toBe(true);
  });

  it('renders victory points and cards as their own glyphs', () => {
    expect(powerSegments(first('endGameVpPerCard')).some(s => s.t === 'vp')).toBe(true);
    expect(powerSegments(first('drawAfterSettling')).some(s => s.t === 'card')).toBe(true);
  });

  it('produces readable text for every power in the set, with nothing left raw', () => {
    for (const p of all) {
      const segs = powerSegments(p);
      expect(segs.length).toBeGreaterThan(0);
      const text = segmentsToText(segs);
      expect(text.length).toBeGreaterThan(0);
      // An unmapped effect would fall through as its raw camelCase name.
      expect(text).not.toBe(p.effectType);
    }
  });
});
