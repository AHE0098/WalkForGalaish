#!/usr/bin/env node
/**
 * Check a folder of artwork against the card database before you upload it.
 *
 *   node scripts/check-art.mjs [folder]        report only
 *   node scripts/check-art.mjs [folder] --fix  also rename what it can
 *
 * Default folder: public/assets/packs/art/cards
 */
import { readFileSync, readdirSync, renameSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const dir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : 'public/assets/packs/art/cards';
const fix = process.argv.includes('--fix');

const cards = JSON.parse(readFileSync(
  'src/games/race-for-the-galaxy/cards/race_for_the_galaxy_base_cards.json', 'utf8')).cards;
const ids = new Set(cards.map(c => c.cardId));
const OK_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg', '.svg']);
const MAX_BYTES = 400_000;

if (!existsSync(dir)) { console.error(`No such folder: ${dir}`); process.exit(1); }

const slug = s => s.toLowerCase().trim()
  .replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const squash = s => s.replace(/[^a-z0-9]/g, '');

const files = readdirSync(dir).filter(f => !f.startsWith('.'));
const present = new Set(), renamed = [], orphans = [], oversize = [], badExt = [];

for (const file of files) {
  const ext = extname(file).toLowerCase();
  const stem = basename(file, extname(file));
  if (!OK_EXT.has(ext)) { badExt.push(file); continue; }
  if (statSync(join(dir, file)).size > MAX_BYTES) oversize.push(file);

  if (ids.has(stem)) { present.add(stem); continue; }

  // Try to repair the usual mistakes: capitals, spaces, underscores, apostrophes.
  const guess = ids.has(slug(stem)) ? slug(stem)
    : [...ids].find(id => squash(id) === squash(slug(stem)));
  if (guess) {
    if (fix) {
      renameSync(join(dir, file), join(dir, `${guess}${ext}`));
      renamed.push(`${file} -> ${guess}${ext}`);
      present.add(guess);
    } else renamed.push(`${file}  (should be ${guess}${ext})`);
  } else orphans.push(file);
}

const missing = [...ids].filter(id => !present.has(id)).sort();

console.log(`\nArtwork in ${dir}`);
console.log(`  matched   ${present.size} / ${ids.size} cards`);
if (renamed.length) {
  console.log(`  ${fix ? 'renamed' : 'NEEDS RENAME'}  ${renamed.length}`);
  renamed.forEach(r => console.log(`     ${r}`));
  if (!fix) console.log('     run again with --fix to rename these automatically');
}
if (orphans.length) {
  console.log(`  unmatched ${orphans.length} file(s) — no card has this id`);
  orphans.forEach(o => console.log(`     ${o}`));
}
if (badExt.length) {
  console.log(`  wrong type ${badExt.length}`);
  badExt.forEach(o => console.log(`     ${o}`));
}
if (oversize.length) {
  console.log(`  oversize  ${oversize.length} file(s) over ${MAX_BYTES / 1000} KB`);
  oversize.forEach(o => console.log(`     ${o}`));
}
if (missing.length) {
  console.log(`  missing   ${missing.length} card(s) — these fall back to procedural art`);
  console.log(`     ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}`);
}
console.log(missing.length || orphans.length || renamed.length
  ? '\nNot complete yet — but the app runs fine with a partial set.\n'
  : '\nComplete and correctly named.\n');
