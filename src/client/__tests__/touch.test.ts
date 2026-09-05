import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The interaction convention, enforced rather than merely written down:
 *
 *   1. Every action is reachable by tapping a real button.
 *   2. Hover, long press and drag may accelerate an action, never be its only path.
 *   3. Nothing important is communicated by a tooltip alone.
 *
 * These checks are deliberately blunt. A false alarm is cheap; a gesture-only
 * feature that works on a laptop and not on a phone is not.
 */
const CLIENT = join(process.cwd(), 'src/client');
const CSS = readFileSync(join(CLIENT, 'styles.css'), 'utf8');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : walk(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
const sources = walk(CLIENT).map(f => ({ file: f, text: readFileSync(f, 'utf8') }));

describe('touch robustness', () => {
  it('never makes a long press the only way to reach something', () => {
    for (const { file, text } of sources) {
      if (!text.includes('useLongPress')) continue;
      if (file.endsWith('useLongPress.ts')) continue;
      // The same component must also offer a plain button.
      expect(text, `${file} uses a long press`).toMatch(/<button/);
    }
  });

  it('has no double-click or drag handlers, which phones cannot produce', () => {
    for (const { file, text } of sources) {
      expect(text, `${file}`).not.toMatch(/onDoubleClick/);
      expect(text, `${file}`).not.toMatch(/onDrag(Start|End|Over)?=/);
      expect(text, `${file}`).not.toMatch(/onMouseEnter|onMouseOver/);
    }
  });

  it('guards hover styling so it cannot stick after a tap', () => {
    expect(CSS).toMatch(/@media \(hover: none\)/);
  });

  it('uses dynamic viewport units for full-height overlays', () => {
    const fullHeight = CSS.match(/height:\s*100vh/g) ?? [];
    expect(fullHeight, 'use 100dvh: 100vh is wrong when mobile toolbars collapse')
      .toHaveLength(0);
    expect(CSS).toMatch(/100dvh/);
  });

  it('respects the notch and the home indicator', () => {
    expect(CSS).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(CSS).toMatch(/env\(safe-area-inset-top\)/);
  });

  it('stops iOS zooming when an input is focused', () => {
    expect(CSS).toMatch(/input[^{]*\{[^}]*font-size:\s*16px/);
  });

  it('declares a viewport that covers the safe area', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/viewport-fit=cover/);
    expect(html).not.toMatch(/user-scalable=no/);   // never block pinch zoom
  });

  it('keeps tap targets large enough on small screens', () => {
    expect(CSS).toMatch(/@media \(max-width:520px\)[\s\S]*?min-height:\s*44px/);
  });

  it('does not rely on a tooltip to explain a blocked action', () => {
    const room = sources.find(s => s.file.endsWith('pages/Room.tsx'))!.text;
    // The reason a card cannot be played is shown in the reader, not only as title=.
    expect(room).toMatch(/reason/);
  });
});
