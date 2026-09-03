import React, { useMemo, useState } from 'react';
import { GenericCard } from '../GenericCard.js';
import { SortBar } from './SortBar.js';
import { sortByKeys, type SortKey } from '../sort.js';
import type { CardFace } from '../cardDb.js';

/**
 * Generic deck browser. It takes a list of card faces plus the sort keys the
 * game declares, so it works for any deck without knowing the game's rules.
 */
export function DeckView({ cards, sortKeys, onOpen, counts }: {
  cards: CardFace[];
  sortKeys: SortKey[];
  onOpen: (face: CardFace) => void;
  counts?: Record<string, number>;
}) {
  const [active, setActive] = useState<SortKey[]>([]);
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? cards.filter(c => c.name.toLowerCase().includes(q)
          || c.traits.some(t => t.includes(q))
          || c.cardType.startsWith(q))
      : cards;
    return sortByKeys(filtered, active, c => c);
  }, [cards, active, query]);

  const total = shown.reduce((n, c) => n + (counts?.[c.cardId] ?? 1), 0);

  return (
    <div className="deckview">
      <div className="deckview__controls">
        <input placeholder="Search name or trait…" value={query}
               onChange={e => setQuery(e.target.value)} />
        <SortBar keys={sortKeys} active={active} onChange={setActive} />
        <p className="muted tiny">{shown.length} definitions · {total} cards</p>
      </div>
      <div className="deckgrid">
        {shown.map(c => (
          <GenericCard key={c.cardId} face={c} onClick={() => onOpen(c)}
                       badge={counts?.[c.cardId] && counts[c.cardId]! > 1
                         ? `×${counts[c.cardId]}` : undefined} />
        ))}
        {!shown.length && <p className="muted">Nothing matches that search.</p>}
      </div>
    </div>
  );
}
