#!/usr/bin/env node
/* Structural validator for race_for_the_galaxy_base_cards.json. No dependencies. */
const fs = require('fs');
const path = process.argv[2] || './race_for_the_galaxy_base_cards.json';
let doc; try { doc = JSON.parse(fs.readFileSync(path, 'utf8')); }
catch (e) { console.error('FATAL: cannot read/parse ' + path + ': ' + e.message); process.exit(1); }

const errors = [], warnings = [];
const E = m => errors.push(m), W = m => warnings.push(m);
const cards = doc.cards || [];
if (!cards.length) { console.error('FATAL: no cards'); process.exit(1); }

const en = doc.enums || {};
const seen = new Set();
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

for (const c of cards) {
  const id = c.cardId || '(missing cardId)';
  for (const f of ['cardId','name','setId','quantity','cardType','traits','powers','validation'])
    if (c[f] === undefined) E(`${id}: missing field "${f}"`);
  if (!KEBAB.test(c.cardId || '')) E(`${id}: cardId is not kebab-case`);
  if (seen.has(c.cardId)) E(`${id}: duplicate cardId`); seen.add(c.cardId);
  if (!(c.quantity >= 1)) E(`${id}: quantity must be >= 1`);
  if (!en.cardTypes.includes(c.cardType)) E(`${id}: unknown cardType "${c.cardType}"`);
  for (const t of c.traits || []) if (!en.traits.includes(t)) E(`${id}: trait "${t}" not in enums`);

  if (c.cardType === 'development') {
    if (c.world !== null) E(`${id}: development must have world: null`);
    if (typeof c.cost !== 'number') E(`${id}: development needs a numeric cost`);
    if (c.isSixCostDevelopment) {
      if (c.cost !== 6) E(`${id}: six-cost development with cost ${c.cost}`);
      if (c.victoryPoints !== null) E(`${id}: six-cost development must have victoryPoints: null`);
      if (!(c.powers || []).some(p => p.phase === 'endGame'))
        E(`${id}: six-cost development has no endGame scoring power`);
    } else if (typeof c.victoryPoints !== 'number') E(`${id}: development needs numeric victoryPoints`);
  } else {
    const w = c.world;
    if (!w) E(`${id}: world card missing world object`);
    else {
      if (!en.settlementModes.includes(w.settlementMode)) E(`${id}: bad settlementMode`);
      if (!en.productionModes.includes(w.productionMode)) E(`${id}: bad productionMode`);
      if (w.settlementMode === 'military') {
        if (typeof w.defense !== 'number') E(`${id}: military world needs numeric defense`);
        if (w.settleCost !== null) E(`${id}: military world must have settleCost: null`);
      } else {
        if (typeof w.settleCost !== 'number') E(`${id}: payment world needs numeric settleCost`);
        if (w.defense !== null) E(`${id}: payment world must have defense: null`);
      }
      if (w.productionMode === 'none' && w.resourceType !== null)
        E(`${id}: non-producing world has a resourceType`);
      if (w.productionMode !== 'none' && !en.resourceTypes.includes(w.resourceType))
        E(`${id}: producing world has bad resourceType "${w.resourceType}"`);
    }
    if (c.cost !== null) E(`${id}: world must have top-level cost: null (use world.defense/settleCost)`);
    if (c.isStartWorld && !c.startWorld) E(`${id}: start world missing startWorld object`);
    if (!c.isStartWorld && c.startWorld) E(`${id}: non-start world has a startWorld object`);
  }

  for (const p of c.powers || []) {
    if (!en.phases.includes(p.phase)) E(`${id}: power phase "${p.phase}" not in enums`);
    if (!en.effectTypes.includes(p.effectType)) E(`${id}: effectType "${p.effectType}" not in enums`);
    if (p.effectType === 'unmapped') E(`${id}: contains an unmapped power`);
    const r = p.conditions && p.conditions.resourceType;
    if (r && r !== 'any' && !en.resourceTypes.includes(r)) E(`${id}: bad conditions.resourceType "${r}"`);
  }
  for (const s of c.specialEffectIds || [])
    if (!en.specialEffectIds.includes(s)) E(`${id}: specialEffectId "${s}" not documented in enums`);
  if (c.image !== null) W(`${id}: image should be null in the data file`);
  if (!c.source || !c.source.length) E(`${id}: no source recorded`);
  if (c.validation && c.validation.verified === false && !(c.validation.notes || []).length)
    E(`${id}: verified:false with no explanatory note`);
}

const W_ = cards.filter(c => c.cardType === 'world');
const D_ = cards.filter(c => c.cardType === 'development');
const mil = W_.filter(c => c.world.settlementMode === 'military');
const pay = W_.filter(c => c.world.settlementMode === 'payment');
const sum = a => a.reduce((n, c) => n + c.quantity, 0);
const dist = (a, get) => { const d = new Array(8).fill(0);
  for (const c of a) { const v = get(c); if (v >= 0 && v <= 7) d[v] += c.quantity; } return d; };

const actual = {
  uniqueDefinitions: cards.length, physicalCards: sum(cards),
  worlds: W_.length, developments: D_.length,
  startWorlds: cards.filter(c => c.isStartWorld).length,
  militaryWorlds: mil.length,
  windfallWorlds: W_.filter(c => c.world.productionMode === 'windfall').length,
  productionWorlds: W_.filter(c => c.world.productionMode === 'production').length,
  sixCostDevelopments: cards.filter(c => c.isSixCostDevelopment).length,
};

console.log('=== TOTALS ===');
let mismatch = 0;
for (const [k, v] of Object.entries(actual)) {
  const exp = (doc.expectedTotals || {})[k];
  const ok = exp === undefined ? '     ' : (exp === v ? ' PASS' : ' FAIL');
  if (exp !== undefined && exp !== v) mismatch++;
  console.log(`  ${k.padEnd(22)} ${String(v).padStart(4)}` +
              (exp === undefined ? '' : `  expected ${String(exp).padStart(4)} ${ok}`));
}
console.log('\n=== COST / DEFENSE DISTRIBUTION (physical cards, index 0-7) ===');
console.log('  developments   ', dist(D_, c => c.cost).join(','));
console.log('  payment worlds ', dist(pay, c => c.world.settleCost).join(','));
console.log('  military worlds', dist(mil, c => c.world.defense).join(','));

console.log('\n=== STRUCTURE ===');
console.log('  distinct traits      ', en.traits.length);
console.log('  distinct effectTypes ', en.effectTypes.length);
console.log('  specialEffectIds     ', en.specialEffectIds.length);
console.log('  total powers         ', cards.reduce((n, c) => n + c.powers.length, 0));

const unver = cards.filter(c => c.validation && c.validation.verified === false);
console.log('\n=== UNRESOLVED ===');
if (!unver.length) console.log('  none');
else unver.forEach(c => console.log(`  ${c.cardId}: ${c.validation.notes.join('; ')}`));
if (doc.knownGaps) { console.log('\n=== KNOWN GAPS ===');
  doc.knownGaps.forEach((g, i) => console.log(`  ${i + 1}. ${g}`)); }

if (warnings.length) { console.log('\n=== WARNINGS ==='); warnings.forEach(w => console.log('  ' + w)); }
if (errors.length) { console.log('\n=== ERRORS ==='); errors.forEach(e => console.log('  ' + e)); }
console.log(`\n${errors.length ? 'FAIL' : 'PASS'}: ${errors.length} error(s), ` +
            `${warnings.length} warning(s), ${mismatch} checksum mismatch(es).`);
process.exit(errors.length || mismatch ? 1 : 0);
