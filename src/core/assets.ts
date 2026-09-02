/**
 * Maps a cardId or a symbol token to a URL, or to null.
 * Null is a normal answer: the renderer draws the card from data instead.
 * No rules code may import this module.
 */
export interface PackManifest {
  packId: string;
  name: string;
  renderMode: 'generated' | 'image' | 'hybrid';
  cardAspectRatio?: string;
  license?: string;
  attribution?: string;
  overrides?: { cards?: Record<string, string>; symbols?: Record<string, string> };
}

export interface AssetResolverOptions {
  pack: PackManifest;
  baseUrl?: string;
  /** Files known to exist in the pack, relative to the pack root. */
  index: Set<string>;
}

const EXTENSIONS = ['svg', 'webp', 'png', 'jpg'];

export function createAssetResolver(opts: AssetResolverOptions) {
  const { pack, index } = opts;
  const base = (opts.baseUrl ?? '').replace(/\/$/, '');
  const url = (rel: string) => `${base}/assets/packs/${pack.packId}/${rel}`;

  const lookup = (kind: 'cards' | 'symbols', key: string): string | null => {
    if (!key) return null;
    const override = pack.overrides?.[kind]?.[key];
    if (override) return index.has(override) ? url(override) : null;
    for (const ext of EXTENSIONS) {
      const rel = `${kind}/${key}.${ext}`;
      if (index.has(rel)) return url(rel);
    }
    return null;
  };

  return {
    renderMode: pack.renderMode,
    cardImage: (cardId: string) => lookup('cards', cardId),
    symbol: (token: string) => lookup('symbols', token),
    coverage: (cardIds: string[]) => cardIds.filter(id => lookup('cards', id) !== null).length,
    /** Files in cards/ that match no known cardId — the usual naming mistake. */
    orphans: (cardIds: string[]) => {
      const known = new Set(cardIds);
      return [...index].filter(rel => rel.startsWith('cards/'))
        .filter(rel => !known.has(rel.replace(/^cards\//, '').replace(/\.[^.]+$/, '')));
    },
  };
}
