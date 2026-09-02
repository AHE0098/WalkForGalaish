# Adding card pictures

The game works perfectly with no pictures at all. Everything below is optional.

## 1. Make a folder

Inside `public/assets/packs/`, make a new folder — call it whatever you like,
e.g. `my-pack`. Inside it, make two folders: `cards` and `symbols`.

## 2. Name each picture after the card

This is the only rule that matters. The file must be named exactly like the card's
`cardId`, which you can look up in `race_for_the_galaxy_base_cards.csv`.

- Gem World → `cards/gem-world.webp`
- Old Earth → `cards/old-earth.webp`

Use `.webp`, `.png`, `.jpg`, or `.svg`. Hyphens, never underscores or spaces.

## 3. Add a small settings file

Create `pack.json` inside your folder:

```json
{ "packId": "my-pack", "name": "My Pack", "renderMode": "hybrid",
  "license": "Where these files came from and what you are allowed to do with them." }
```

`hybrid` puts your picture inside the card frame and keeps the numbers as text, so
the card stays readable. `image` uses the whole picture. `generated` ignores pictures.

## 4. Turn it on

Set the `ASSET_PACK` environment variable to `my-pack`, or add `?pack=my-pack` to
the web address to try it out.

## 5. Check your work

```bash
npm run assets:check
```

It tells you how many cards have pictures and — most usefully — lists any file whose
name doesn't match a card, suggesting the right name. A misnamed file shows up as a
blank card with no error message, so run this whenever you add files.

## 6. A caution about copyright

Published card artwork belongs to its publisher. Do not commit artwork you do not
have permission to distribute. The `.gitignore` already keeps pack images out of the
repository, which also means **they will not appear on the deployed site**. To deploy
with pictures, either host the folder elsewhere and set `ASSET_BASE_URL`, or use a
private repository and remove the ignore rule.
