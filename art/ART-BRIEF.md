# Art brief — Race for the Galaxy card pack

Hand this whole file to an image-generation model, along with `prompts.txt`
(one ready-to-use prompt per card) and `art-manifest.csv` (the same data as a table).

The app already runs without any of this. Art is purely additive: every file you
supply improves one card, and every file you skip falls back to the generated face.
**Nothing breaks if the set is incomplete.**

---

## 1. What to produce

| Group | Count | Folder | Format |
|---|---|---|---|
| Card art | 95 | `cards/` | `.webp`, 768 × 1024 (3:4 portrait) |
| Symbols | 23 | `symbols/` | `.png` or `.svg`, 128 × 128, transparent |
| Card back | 1 | root | `card-back.webp`, 768 × 1024 |

Total: **119 images.**

## 2. Naming is the whole integration

There is no config file to edit and no registry to update. **The filename is the
mapping.** A file named `cards/gem-world.webp` becomes the art for the card whose
`cardId` is `gem-world`. Get the name right and it appears; get it wrong and the
card silently keeps its generated face.

- Exact `cardId` from `art-manifest.csv`, lowercase, hyphens only.
- No spaces, no underscores, no capitals, no version suffixes (`gem-world-v2.webp` will not load).
- One file per card. Do not batch several cards into a sheet.

Run `npm run assets:check` after dropping files in. It reports coverage and names
every file that matches no card, suggesting the intended `cardId`.

## 3. Where the files go

```
public/assets/packs/neon/
  pack.json          ← already written for you, see §8
  cards/<cardId>.webp
  symbols/<token>.png
  card-back.webp
```

## 4. House style

**Neon-mechanical deep space.** Think engineered hardware lit from within, not
painterly space fantasy.

- **Substrate:** near-black to gunmetal. Deep, cool, matte.
- **Light:** emissive. Rim lights, glowing seams, thin luminous linework tracing
  structure. Light comes *from* the subject, not from a sun.
- **Form:** clean geometric silhouettes. Hard edges, honest engineering, visible
  structural logic. Volumetric haze for depth, never for mush.
- **Restraint:** one dominant accent hue per card, taken from its resource palette
  below. Everything else stays desaturated. Neon is a highlight, not a wash.
- **Mood:** cold, precise, slightly ominous. Industrial sublime.

### Resource palettes — carry the accent hue, it is information

| Resource | Accent |
|---|---|
| Novelty | electric cyan, cold white |
| Rare elements | amber, burnt copper |
| Genes | acid green, pale jade |
| Alien technology | violet, magenta |
| Developments (no resource) | neon lime on gunmetal |

A player should be able to guess a world's good from its glow alone.

### Framing by card type

- **Developments** — engineered facilities, machines, civic structures. Interior or
  close orbital scale.
- **Six-cost developments** — vast orbital institutions and megastructures at a
  distance. These should feel like the biggest images in the set.
- **Payment worlds** — quiet colonised planets seen from orbit.
- **Production worlds** — visible extraction, refineries, working industry.
- **Windfall worlds** — untouched or abandoned, holding something unclaimed.
- **Military worlds** — fortified, contested, defensive installations. Red hazard
  accents are welcome *in addition to* the resource hue.
- **Rebel worlds** — insurgent markings, scorched plating, improvised armour.
- **Alien worlds** — non-human geometry, unsettling symmetry, nothing ergonomic.
- **Start worlds** — established homeworlds, warmer and more welcoming than the rest.

## 5. Composition rules — these exist for a reason

The app draws the card's numbers, name, tags and phase powers **on top of** the art.

- **Keep the centre calm.** Mid-tone, low-detail middle band. Detail belongs at the
  edges and in the upper third.
- **Top-left corner must stay quiet** — the cost pip sits there.
- **Top-right corner must stay quiet** — the victory-point number sits there.
- **Bottom third must stay quiet** — the phase power rail sits there.
- **No text of any kind.** No letters, numbers, glyphs, logos, watermarks, or
  signatures. The UI supplies every character on the card.
- **No close-up faces.** Human presence at architectural scale only.
- Avoid pure black corners; a faint structural gradient reads better behind the
  translucent UI scrims.

## 6. Negative prompt (apply to all)

```
text, letters, numbers, watermark, signature, logo, UI, frame, border, caption,
busy centre, high-contrast clutter, lens flare spam, chromatic aberration,
photorealistic human face, cartoon, chibi, painterly brushwork, sepia, beige
```

## 7. Symbols

Flat, single-colour, transparent background, 128 × 128, generous padding, readable
at 16 px. These are icons, not illustrations — no gradients, no glow.

```
resource-novelty   resource-rare      resource-genes     resource-alien
type-world         type-development   type-start-world
badge-military     badge-rebel        badge-alien
badge-windfall     badge-production
phase-explore      phase-develop      phase-settle
phase-consume      phase-produce
stat-cost          stat-defense       stat-vp
vp-chip            good-marker        card-back
```

Suggested motifs: resources as a chip / crystal / helix / unknown polyhedron;
phases as I–V machine numerals; military as a hexagonal shield; windfall as a ring;
production as a gear; vp-chip as a hexagon.

## 8. pack.json

Save this as `public/assets/packs/neon/pack.json`:

```json
{
  "packId": "neon",
  "name": "Neon Mechanical",
  "renderMode": "hybrid",
  "cardAspectRatio": "0.75",
  "license": "Describe the licence or generation terms of these files here.",
  "attribution": "Credit line, if one is required.",
  "overrides": { "cards": {}, "symbols": {} }
}
```

`hybrid` draws your art behind the generated frame, keeping the numbers and powers
as live text. Set `"renderMode": "image"` only if you produce fully finished cards
with the stats already painted in — not recommended, because the text would then
stop matching the game state.

## 9. Delivery checklist

1. 95 files in `cards/`, named exactly as in `art-manifest.csv`
2. 23 files in `symbols/`
3. `card-back.webp`
4. `pack.json`
5. `npm run assets:check` reports 95/95 and zero orphans
6. Set `ASSET_PACK=neon`, or visit the app with `?pack=neon` to preview

Do not commit artwork you lack the rights to distribute — see `docs/ASSETS.md`.
