import type { Rng } from './types.js';

/** Deterministic, seedable RNG. All game randomness goes through this. */
export function createRng(seed?: number): Rng {
  let s = (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  if (s === 0) s = 0x9e3779b9;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 0x100000000;
  };
  return {
    next,
    shuffle<T>(items: T[]): T[] {
      const a = items.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j] as T, a[i] as T];
      }
      return a;
    },
    randomChoice<T>(items: T[]): T {
      if (!items.length) throw new Error('randomChoice on empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
    sample<T>(items: T[], n: number): T[] {
      return this.shuffle(items).slice(0, n);
    },
  };
}
