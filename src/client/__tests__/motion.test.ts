import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'src/client/styles.css'), 'utf8');
const FEED = readFileSync(join(process.cwd(), 'src/client/Feed.tsx'), 'utf8');

describe('motion is cheap and optional', () => {
  /** Pull out each @keyframes body by matching braces, not by regex guesswork. */
  function keyframeBodies(css: string): Array<{ name: string; body: string }> {
    const out: Array<{ name: string; body: string }> = [];
    const re = /@keyframes\s+([\w-]+)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) {
      let depth = 1, i = re.lastIndex;
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
        i++;
      }
      out.push({ name: m[1]!, body: css.slice(re.lastIndex, i - 1) });
    }
    return out;
  }

  it('animates only compositable properties', () => {
    const frames = keyframeBodies(CSS);
    expect(frames.length).toBeGreaterThan(4);
    const banned = /(^|[;{\s])(width|height|top|left|right|bottom|margin|padding)\s*:/;
    for (const f of frames)
      expect(banned.test(f.body), `@keyframes ${f.name} animates layout`).toBe(false);
  });

  it('is switched off entirely for anyone who asks', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
    expect(CSS).toMatch(/animation-duration:\s*\.01ms\s*!important/);
  });

  it('keeps the idle breathing off touch devices, where it would just burn battery', () => {
    expect(CSS).toMatch(/@media \(hover: hover\) and \(prefers-reduced-motion: no-preference\)[\s\S]*?breathe/);
  });

  it('drives the feed from monotonic event ids, not from diffing state', () => {
    expect(FEED).toMatch(/e\.id > seen\.current/);
    expect(FEED).toMatch(/slice\(-3\)/);            // never floods
  });

  it('tolerates an empty or absent event list', () => {
    expect(FEED).toMatch(/if \(!events\?\.length\) return/);
    expect(FEED).toMatch(/if \(!shown\.length\) return null/);
  });
});
