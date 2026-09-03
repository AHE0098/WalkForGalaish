/**
 * Procedural card art. Every image is derived deterministically from the card's
 * own data — type, resource, military, rebel, alien — so the picture always
 * agrees with the mechanics. Pure SVG: a few KB each, no external assets, no
 * copyright question. Overwrite any file with real art of the same name later.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'public/assets/packs/neon';
const cards = JSON.parse(readFileSync(
  'src/games/race-for-the-galaxy/cards/race_for_the_galaxy_base_cards.json', 'utf8')).cards;

const PALETTE = {
  novelty: ['#3fe0ff', '#0d6b8a'], rare: ['#ffb454', '#7a4413'],
  genes:   ['#9bff5c', '#2f7a1e'], alien: ['#c77dff', '#5c2b8a'],
  none:    ['#3dffa2', '#12684a'],
};

/** Small deterministic PRNG so a given card always draws the same picture. */
function rng(seed) {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
}

const W = 768, H = 1024;

function starfield(r, n = 90) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = r() * H, o = 0.15 + r() * 0.5, rad = r() < 0.9 ? 1 : 2;
    out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rad}" fill="#dff5ea" opacity="${o.toFixed(2)}"/>`;
  }
  return out;
}

/** A planet disc, lit from the upper left, with an optional resource halo. */
function planet(r, [hue, dark], { halo, filled, military }) {
  const cx = W / 2, cy = 400, rad = 190 + r() * 34;
  const bands = Array.from({ length: 5 }, (_, i) => {
    const y = cy - rad + (i + 1) * (rad * 2 / 6);
    const w = Math.sqrt(Math.max(0, rad * rad - (y - cy) ** 2)) * (0.7 + r() * 0.3);
    return `<rect x="${cx - w}" y="${y}" width="${w * 2}" height="${6 + r() * 12}" rx="6"
      fill="${hue}" opacity="${(0.08 + r() * 0.12).toFixed(2)}"/>`;
  }).join('');
  return `
    ${halo ? `<circle cx="${cx}" cy="${cy}" r="${rad + 30}" fill="none" stroke="${hue}"
        stroke-width="7" opacity=".55" filter="url(#glow)"/>
      <circle cx="${cx}" cy="${cy}" r="${rad + 52}" fill="none" stroke="${hue}"
        stroke-width="2" opacity=".25"/>` : ''}
    <circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#body)"/>
    <g clip-path="url(#disc)">${bands}
      ${filled ? `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${hue}" opacity=".16"/>` : ''}
    </g>
    <circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${hue}"
      stroke-width="2.5" opacity=".85" filter="url(#glow)"/>
    <circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#shade)"/>
    ${military ? `<g opacity=".8" filter="url(#glow)">
      ${[0, 1, 2].map(i => `<path d="M${cx - 120 + i * 100} ${cy + rad - 46}
        l26 -26 l26 26" fill="none" stroke="#ff5c72" stroke-width="6"
        stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</g>` : ''}
    <clipPath id="disc"><circle cx="${cx}" cy="${cy}" r="${rad}"/></clipPath>`;
}

/** A station or megastructure for developments. */
function structure(r, [hue], { huge }) {
  const cx = W / 2, cy = 400, s = huge ? 1.35 : 1;
  const cols = Array.from({ length: huge ? 7 : 5 }, (_, i) => {
    const h = (120 + r() * 190) * s, x = cx - (huge ? 250 : 180) + i * (huge ? 84 : 90);
    return `<rect x="${x}" y="${cy - h / 2}" width="${34 * s}" height="${h}" rx="8"
      fill="#0f1a1f" stroke="${hue}" stroke-width="2" opacity=".9"/>
      <rect x="${x + 8 * s}" y="${cy - h / 2 + 14}" width="${18 * s}" height="${h - 28}" rx="4"
      fill="${hue}" opacity="${(0.10 + r() * 0.18).toFixed(2)}"/>`;
  }).join('');
  return `
    <g filter="url(#glow)">
      <line x1="${cx - 300 * s}" y1="${cy}" x2="${cx + 300 * s}" y2="${cy}"
        stroke="${hue}" stroke-width="3" opacity=".55"/>
      ${huge ? `<circle cx="${cx}" cy="${cy}" r="${260}" fill="none" stroke="${hue}"
        stroke-width="2" opacity=".35" stroke-dasharray="14 10"/>` : ''}
    </g>
    ${cols}
    <circle cx="${cx}" cy="${cy}" r="${(huge ? 40 : 26)}" fill="${hue}" opacity=".9" filter="url(#glow)"/>`;
}

function svg(card) {
  const w = card.world;
  const res = w?.resourceType ?? 'none';
  const pal = PALETTE[res] ?? PALETTE.none;
  const r = rng(card.cardId);
  const isDev = card.cardType === 'development';

  const subject = isDev
    ? structure(r, pal, { huge: card.isSixCostDevelopment })
    : planet(r, pal, {
        halo: w?.productionMode === 'windfall',
        filled: w?.productionMode === 'production',
        military: w?.settlementMode === 'military',
      });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
  <radialGradient id="sky" cx="50%" cy="34%" r="78%">
    <stop offset="0%" stop-color="#16232a"/><stop offset="100%" stop-color="#05090b"/>
  </radialGradient>
  <radialGradient id="body" cx="36%" cy="30%" r="80%">
    <stop offset="0%" stop-color="#24343c"/><stop offset="100%" stop-color="#0a1114"/>
  </radialGradient>
  <radialGradient id="shade" cx="34%" cy="28%" r="82%">
    <stop offset="55%" stop-color="#000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000" stop-opacity=".72"/>
  </radialGradient>
  <linearGradient id="calm" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#05090b" stop-opacity=".85"/>
    <stop offset="24%" stop-color="#05090b" stop-opacity="0"/>
    <stop offset="62%" stop-color="#05090b" stop-opacity="0"/>
    <stop offset="100%" stop-color="#05090b" stop-opacity=".92"/>
  </linearGradient>
  <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="9" result="b"/><feMerge>
      <feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
${starfield(r)}
<g opacity=".18">${Array.from({ length: 12 }, (_, i) =>
  `<line x1="0" y1="${i * 90}" x2="${W}" y2="${i * 90}" stroke="${pal[0]}" stroke-width="1"/>`).join('')}</g>
${subject}
<!-- Keeps the top corners and lower third quiet, where the UI sits. -->
<rect width="${W}" height="${H}" fill="url(#calm)"/>
</svg>`;
}

mkdirSync(`${OUT}/cards`, { recursive: true });
for (const c of cards) writeFileSync(`${OUT}/cards/${c.cardId}.svg`, svg(c));
console.log(`wrote ${cards.length} card images`);
