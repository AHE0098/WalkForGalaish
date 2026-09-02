/** Reports pack coverage and, crucially, filenames that match no cardId. */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PACKS = 'public/assets/packs';
const cards = JSON.parse(readFileSync(
  'src/games/race-for-the-galaxy/cards/race_for_the_galaxy_base_cards.json', 'utf8')).cards;
const ids = new Set(cards.map(c => c.cardId));
const TOKENS = ['resource-novelty','resource-rare','resource-genes','resource-alien',
  'type-world','type-development','type-start-world','badge-military','badge-rebel',
  'badge-alien','badge-windfall','badge-production','phase-explore','phase-develop',
  'phase-settle','phase-consume','phase-produce','stat-cost','stat-defense','stat-vp',
  'vp-chip','good-marker','card-back'];

const walk = d => existsSync(d) ? readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
}) : [];

const near = (a, b) => a.replace(/[^a-z0-9]/g, '') === b.replace(/[^a-z0-9]/g, '');

if (!existsSync(PACKS)) { console.log('no packs directory'); process.exit(0); }
for (const pack of readdirSync(PACKS)) {
  const root = join(PACKS, pack);
  if (!statSync(root).isDirectory()) continue;
  const manifestPath = join(root, 'pack.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { renderMode: 'generated' };
  const files = walk(root).map(f => relative(root, f).replaceAll('\\', '/'));
  const cardFiles = files.filter(f => f.startsWith('cards/'));
  const symbolFiles = files.filter(f => f.startsWith('symbols/'));
  const stem = f => f.split('/').pop().replace(/\.[^.]+$/, '');

  const present = new Set(cardFiles.map(stem).filter(s => ids.has(s)));
  const orphans = cardFiles.filter(f => !ids.has(stem(f)));
  const symbolsPresent = symbolFiles.map(stem).filter(s => TOKENS.includes(s));
  const oversize = walk(root).filter(f => statSync(f).size > 400_000);

  console.log(`\nPack: ${pack} (${manifest.renderMode})`);
  console.log(`  Cards:    ${present.size} / ${ids.size} present, ${ids.size - present.size} missing`);
  console.log(`  Symbols:  ${symbolsPresent.length} / ${TOKENS.length} present`);
  if (orphans.length) {
    console.log(`  Orphans:  ${orphans.length} file(s) match no cardId`);
    for (const o of orphans) {
      const guess = [...ids].find(id => near(stem(o), id));
      console.log(`     ${o}${guess ? `  → did you mean "${guess}"?` : ''}`);
    }
  } else console.log('  Orphans:  none');
  if (oversize.length) {
    console.log(`  Oversize: ${oversize.length} file(s) over 400 KB`);
    oversize.forEach(f => console.log(`     ${relative(root, f)}`));
  }
  if (manifest.attribution) console.log(`  Attribution: ${manifest.attribution}`);
}
