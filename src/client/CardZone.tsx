import React, { useState } from 'react';
import { SortBar } from './views/SortBar.js';
import { sortByKeys, type SortKey } from './sort.js';
import { useLongPress } from './useLongPress.js';

/**
 * A named row of cards. Every zone on the board — hand, tableau, an opponent's
 * tableau, a draft row — is one of these, so behaviour added here is available
 * everywhere. Sorting is core functionality but stays out of the way: press and
 * hold the zone's title to reveal it.
 */
export function CardZone<T>({
  title, meta, items, render, sortKeys, resolve, empty, accent, dense, defaultSorted,
}: {
  title: string;
  meta?: React.ReactNode;
  items: T[];
  render: (item: T, index: number) => React.ReactNode;
  /** Omit to disable sorting entirely for this zone. */
  sortKeys?: SortKey[];
  resolve?: (item: T) => unknown;
  empty?: string;
  accent?: boolean;
  dense?: boolean;
  defaultSorted?: SortKey[];
}) {
  const [keys, setKeys] = useState<SortKey[]>(defaultSorted ?? []);
  const [open, setOpen] = useState(false);
  const canSort = !!sortKeys?.length && !!resolve;
  // A long press is an accelerator, never the only way in: the button below
  // does the same thing and works on every device.
  const press = useLongPress(() => canSort && setOpen(v => !v));

  const shown = canSort ? sortByKeys(items, keys, resolve!) : items;

  return (
    <section className={`zone${accent ? ' zone--accent' : ''}${dense ? ' zone--dense' : ''}`}>
      <header className="zone__bar" {...(canSort ? press.handlers : {})}>
        <h2 className="zone__title">
          {title}
          {canSort && keys.length > 0 && <span className="zone__sorted">sorted</span>}
        </h2>
        <span className="zone__meta">
          {meta}
          {canSort && (
            <button type="button" className={`zonebtn${open ? ' zonebtn--on' : ''}`}
                    aria-pressed={open} aria-label={open ? 'Hide sorting' : 'Sort this zone'}
                    onClick={() => setOpen(v => !v)}>
              <span aria-hidden>⇅</span> Sort
            </button>
          )}
        </span>
      </header>

      {open && canSort && (
        <SortBar keys={sortKeys!} active={keys} onChange={setKeys} label="Order by" />
      )}

      {shown.length
        ? <div className="cardrow">{shown.map(render)}</div>
        : <p className="zone__empty">{empty ?? 'Nothing here yet.'}</p>}
    </section>
  );
}
