import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface PackData {
  packId: string;
  manifest: { renderMode?: string; overrides?: { cards?: Record<string, string>;
              symbols?: Record<string, string> } } | null;
  files: string[];
  baseUrl: string;
}

const EXT = ['webp', 'png', 'jpg', 'svg'];

/**
 * Resolves a cardId or symbol token to a URL, or to null. Null is the normal
 * answer when a pack is incomplete: the card renders from data instead.
 */
export interface AssetApi {
  packId: string;
  renderMode: string;
  card(cardId: string): string | null;
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
    const files = new Set(pack.files);
    const base = (pack.baseUrl || '').replace(/\/$/, '');
    const url = (rel: string) => `${base}/assets/packs/${pack.packId}/${rel}`;
    const find = (kind: 'cards' | 'symbols', key: string) => {
      const over = pack.manifest?.overrides?.[kind]?.[key];
      if (over) return files.has(over) ? url(over) : null;
      for (const e of EXT) if (files.has(`${kind}/${key}.${e}`)) return url(`${kind}/${key}.${e}`);
      return null;
    };
    return {
      packId: pack.packId,
      renderMode: pack.manifest?.renderMode ?? 'generated',
      card: id => find('cards', id),
      symbol: t => find('symbols', t),
      coverage: pack.files.filter(f => f.startsWith('cards/')).length,
    };
  }, [pack]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
