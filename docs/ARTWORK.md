# Adding your artwork

The app already runs. Artwork is additive: every file you add improves one card,
every file you skip falls back to the procedurally drawn version. **A partial set
looks deliberate, not broken.**

---

## Where the files go

```
public/assets/packs/art/cards/<cardId>.webp     ← your artwork
public/assets/packs/art/symbols/<token>.png     ← optional icons
public/assets/packs/art/card-back.webp          ← optional
```

The folder already exists in the repo with its `pack.json`. You only add files.

**This folder is yours.** The zips you receive never contain it, so uploading a new
version of the app can never overwrite or delete your artwork. GitHub's upload only
adds and replaces files that are in the upload; anything else is untouched.

## Naming is the entire integration

There is no config to edit. The filename *is* the mapping: `gem-world.webp` becomes
the art for the card whose `cardId` is `gem-world`. Names come from
`art/art-manifest.csv`.

Before uploading, check them:

```bash
npm run art:check          # report
npm run art:fix            # rename what it can, automatically
```

It repairs the usual mistakes — `Gem World.webp`, `old_earth.png`, stray capitals or
apostrophes — and names anything it cannot match, so nothing fails silently. A file
whose name matches no card simply never appears; this is how you find out.

## Format

| | |
|---|---|
| Format | **WebP** (PNG and JPG also work) |
| Size | **768 × 1024**, portrait 3:4 |
| Weight | aim under **200 KB** each; the checker flags anything over 400 KB |
| Colour | sRGB |
| Content | **no text, no numbers, no logos** — the app draws all of those |

Roughly 100 files at 200 KB is about 20 MB, which git handles comfortably.

**Composition matters more than resolution.** The app draws the cost, victory points,
tags and phase powers *on top of* your image:

- keep the **top-left** quiet — the cost pip sits there
- keep the **top-right** quiet — the victory points sit there
- keep the **bottom third** quiet — the phase rail sits there
- keep the **centre** mid-toned and low-detail

`art/ART-BRIEF.md` has the full style guide and `art/prompts.txt` a per-card prompt.

## Uploading

GitHub's web upload takes up to 100 files at a time, so do the artwork in two goes:

1. **Add file → Upload files**, drag roughly the first half, commit.
2. Repeat with the rest.

Each upload is its own commit and only adds what is new. Render redeploys on each.

Keep doing normal app updates exactly as before — drag the contents of the zip in. The
two never collide, because the zip has no `packs/art/` folder.

## Turning it on

`ASSET_PACK=art` is already the default. Nothing to configure.

To compare, add `?pack=neon` to the URL for the procedural set, or `?pack=generated`
for no artwork at all.

## How the fallback works

For every card the app looks in order:

1. `packs/art/` — your artwork
2. `packs/neon/` — the procedural image, drawn at build time
3. the card drawn from data, with no image

So you can upload ten cards today and ninety next week, and the board stays coherent
throughout.

## Licensing

Only upload images you have the right to distribute. The repo is public unless you
made it private; artwork committed here is published with it.

---

## The contract (this will not change)

The app asks for artwork in a fixed order and takes the first thing it finds:

```
1  packs/art/cards/<cardId>.webp          your individual artwork
2  packs/art/templates/<template>.webp    a shared image for a class of card
3  the same two in packs/neon             the procedural image
4  nothing                                the card is drawn from data
```

`<cardId>` is the key. It comes from `art-manifest.csv` and never changes.
Filenames are the only integration point: no registry, no config, no code.

Extensions are tried `webp → png → jpg → avif → svg`, so your bitmap always wins
over the procedural SVG of the same name.

### Templates, for later

You are supplying individual art, so you can ignore this. When you eventually want
one image to stand in for a whole class of card, drop it in `templates/` under one
of these keys and every card of that class without its own artwork uses it:

```
development            development-six
world-production-novelty      world-windfall-novelty
world-production-rare         world-windfall-rare
world-production-genes        world-windfall-genes
world-production-alien        world-windfall-alien
military-production-<good>    military-windfall-<good>
world                  military
```

Individual art always beats a template. Mixing the two is a supported state, not a
compromise: a handful of templates gives the whole set a floor while the individual
pieces arrive.
