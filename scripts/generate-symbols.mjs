/** Flat single-colour icons for the 23 symbol tokens. */
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = 'public/assets/packs/neon/symbols';
mkdirSync(OUT, { recursive: true });

const C = { novelty: '#3fe0ff', rare: '#ffb454', genes: '#9bff5c', alien: '#c77dff',
            neon: '#3dffa2', danger: '#ff5c72', ink: '#dff5ea' };
const wrap = (body, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128" fill="none"
 stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const numeral = (t, c) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">
<rect x="6" y="6" width="52" height="52" rx="12" fill="none" stroke="${c}" stroke-width="4"/>
<text x="32" y="43" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif"
 font-size="26" font-weight="800" fill="${c}">${t}</text></svg>`;

const icons = {
  'resource-novelty': wrap('<rect x="14" y="14" width="36" height="36" rx="6"/><path d="M24 24h16v16H24z"/>', C.novelty),
  'resource-rare': wrap('<path d="M32 10l18 12v20L32 54 14 42V22z"/><path d="M32 24v16"/>', C.rare),
  'resource-genes': wrap('<path d="M22 10c0 14 20 16 20 30M42 10c0 14-20 16-20 30M22 54h20"/>', C.genes),
  'resource-alien': wrap('<path d="M32 8l20 14-8 26H20l-8-26z"/><path d="M26 34h12"/>', C.alien),
  'type-world': wrap('<circle cx="32" cy="32" r="20"/><path d="M12 32h40"/>', C.ink),
  'type-development': wrap('<rect x="32" y="8" width="34" height="34" rx="6" transform="rotate(45 32 8)"/>', C.ink),
  'type-start-world': wrap('<circle cx="32" cy="32" r="20"/><circle cx="32" cy="32" r="8"/>', C.neon),
  'badge-military': wrap('<path d="M32 8l20 8v18c0 12-9 19-20 22-11-3-20-10-20-22V16z"/>', C.danger),
  'badge-rebel': wrap('<path d="M32 8l20 8v18c0 12-9 19-20 22-11-3-20-10-20-22V16z"/><path d="M24 30l16 12M40 30L24 42"/>', C.danger),
  'badge-alien': wrap('<path d="M32 10l18 22-18 22-18-22z"/><path d="M32 24v16"/>', C.alien),
  'badge-windfall': wrap('<circle cx="32" cy="32" r="12"/><circle cx="32" cy="32" r="22" stroke-dasharray="6 6"/>', C.neon),
  'badge-production': wrap('<circle cx="32" cy="32" r="10"/><path d="M32 6v10M32 48v10M6 32h10M48 32h10M14 14l7 7M43 43l7 7M50 14l-7 7M21 43l-7 7"/>', C.neon),
  'phase-explore': numeral('I', C.neon),
  'phase-develop': numeral('II', C.neon),
  'phase-settle': numeral('III', C.neon),
  'phase-consume': numeral('IV', C.neon),
  'phase-produce': numeral('V', C.neon),
  'stat-cost': wrap('<circle cx="32" cy="32" r="20"/>', C.ink),
  'stat-defense': wrap('<circle cx="32" cy="32" r="20"/><path d="M22 32l8 8 12-16"/>', C.danger),
  'stat-vp': wrap('<path d="M32 10l7 15 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2z"/>', C.neon),
  'vp-chip': wrap('<path d="M32 8l21 12v24L32 56 11 44V20z"/><path d="M32 22v20"/>', C.neon),
  'good-marker': wrap('<rect x="12" y="18" width="40" height="28" rx="6"/><path d="M12 28h40"/>', C.neon),
  'card-back': wrap('<rect x="10" y="6" width="44" height="52" rx="8"/><path d="M20 22h24M20 32h24M20 42h16"/>', C.neon),
};

for (const [name, body] of Object.entries(icons)) writeFileSync(`${OUT}/${name}.svg`, body);
console.log(`wrote ${Object.keys(icons).length} symbols`);
