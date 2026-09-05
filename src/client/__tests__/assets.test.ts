import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The artwork folder is the user's, not the build's. These checks protect the two
 * ways it could be destroyed: a build step overwriting it, or a release archive
 * shipping over the top of it.
 */
describe('artwork survives everything else', () => {
  const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

  it('commits the art pack, so it reaches the deployed app', () => {
    expect(gitignore).toMatch(/!public\/assets\/packs\/art\//);
  });

  it('keeps the generated pack out of the repository', () => {
    expect(gitignore).toMatch(/public\/assets\/packs\/neon\/cards\//);
  });

  it('never generates into the art folder', () => {
    const gen = readFileSync(join(process.cwd(), 'scripts/generate-art.mjs'), 'utf8');
    expect(gen).toMatch(/packs\/neon/);
    expect(gen).not.toMatch(/packs\/art/);
  });

  it('offers a checker before uploading', () => {
    expect(pkg.scripts['art:check']).toBeTruthy();
    expect(pkg.scripts['art:fix']).toBeTruthy();
  });

  it('defaults the deployed app to the art pack', () => {
    const render = readFileSync(join(process.cwd(), 'render.yaml'), 'utf8');
    expect(render).toMatch(/ASSET_PACK[\s\S]*?value:\s*art/);
  });

  it('falls back through art, then procedural, then the drawn card', () => {
    const server = readFileSync(join(process.cwd(), 'src/server/index.ts'), 'utf8');
    expect(server).toMatch(/\[requested, 'neon', 'generated'\]/);
  });
});

describe('the art contract', () => {
  const cardDb = readFileSync(join(process.cwd(), 'src/client/cardDb.ts'), 'utf8');
  const assets = readFileSync(join(process.cwd(), 'src/client/assets.tsx'), 'utf8');

  it('prefers bitmap artwork over the procedural svg of the same name', () => {
    const order = /const EXT = \[([^\]]+)\]/.exec(assets)![1]!;
    const list = order.split(',').map(s => s.trim().replace(/'/g, ''));
    expect(list.indexOf('webp')).toBeLessThan(list.indexOf('svg'));
    expect(list[0]).toBe('webp');
  });

  it('falls back from individual art through every template key, then to nothing', () => {
    expect(assets).toMatch(/find\('cards', id\)\s*\?\?\s*\(templates \?\? \[\]\)\.reduce/);
  });

  it('degrades template keys from specific to broad, so a few images cover the set', () => {
    expect(cardDb).toMatch(/export function templateKeys/);
    for (const key of ['development', 'development-six', 'military', 'world'])
      expect(cardDb).toContain(key);
  });

  it('never lets a missing image break a card', () => {
    const card = readFileSync(join(process.cwd(), 'src/client/GenericCard.tsx'), 'utf8');
    expect(card).toMatch(/onError/);                 // a broken file hides itself
    expect(card).toMatch(/\{art &&/);                // and null is a normal answer
  });
});
