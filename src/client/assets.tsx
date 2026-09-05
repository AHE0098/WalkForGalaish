import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface PackFiles {
  packId: string;
  manifest: { renderMode?: string; overrides?: { cards?: Record<string, string>;
              symbols?: Record<string, string> } } | null;
  files: string[];
}
interface PackData {
  packId: string;
  manifest: PackFiles['manifest'];
  /** Highest priority first; a miss falls through to the next. */
  packs: PackFiles[];
  files: string[];
  baseUrl: string;
}

// Individual artwork is preferred over anything generated, so bitmap formats
// are tried before svg: the procedural pack writes svg.
const EXT = ['webp', 'png', 'jpg', 'avif', 'svg'];

/**
 * Resolves a cardId or symbol token to a URL, or to null. Null is the normal
 * answer when a pack is incomplete: the card renders from data instead.
 */
export interface AssetApi {
  packId: string;
  renderMode: string;
  /**
   * Art for one card. Resolution order, first hit wins:
   *   1. cards/<cardId>.<ext>      individual artwork — the contract
   *   2. templates/<template>.<ext> a shared image for a class of card
   *   3. the same two in each fallback pack
   *   4. null → the card is drawn from data
   * Callers pass a template key; supplying one is always optional.
   */
  card(cardId: string, template?: string | null): string | null;
  symbol(token: string): string | null;
  coverage: number;
}

const Ctx = createContext<AssetApi>({
  packId: 'generated', renderMode: 'generated',
  card: () => null, symbol: () => null, coverage: 0,
});
export const useAssets = () => useContext(Ctx);

export function AssetProvider({ children }: { children: React.ReactNode }) {
  const [pack, setPack] = useState<PackData | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('pack');
    fetch(`/api/assets${q ? `?pack=${encodeURIComponent(q)}` : ''}`)
      .then(r => r.json()).then(setPack).catch(() => setPack(null));
  }, []);

  const api = useMemo<AssetApi>(() => {
    if (!pack) return { packId: 'generated', renderMode: 'generated',
                        card: () => null, symbol: () => null, coverage: 0 };
    const base = (pack.baseUrl || '').replace(/\/$/, '');
    const chain = (pack.packs?.length ? pack.packs
      : [{ packId: pack.packId, manifest: pack.manifest, files: pack.files ?? [] }])
      .map(p => ({ ...p, set: new Set(p.files) }));

    const find = (kind: string, key: string): string | null => {
      if (!key) return null;
      for (const p of chain) {
        const url = (rel: string) => `${base}/assets/packs/${p.packId}/${rel}`;
        const over = (p.manifest?.overrides as Record<string, Record<string, string>> | undefined)
          ?.[kind]?.[key];
        if (over && p.set.has(over)) return url(over);
        for (const e of EXT) if (p.set.has(`${kind}/${key}.${e}`)) return url(`${kind}/${key}.${e}`);
      }
      return null;
    };
    return {
      packId: pack.packId,
      renderMode: pack.manifest?.renderMode ?? 'hybrid',
      card: (id, template) => find('cards', id) ?? (template ? find('templates', template) : null),
      symbol: t => find('symbols', t),
      coverage: chain[0]?.files.filter(f => f.startsWith('cards/')).length ?? 0,
    };
  }, [pack]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
