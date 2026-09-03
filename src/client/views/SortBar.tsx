import React from 'react';
import type { SortKey } from '../sort.js';
import { toggleKey } from '../sort.js';

/** Pick sort keys in order; the numbered chips show the order being applied. */
export function SortBar({ keys, active, onChange, label = 'Sort' }: {
  keys: SortKey[]; active: SortKey[]; onChange: (next: SortKey[]) => void; label?: string;
}) {
  return (
    <div className="sortbar">
      <span className="sortbar__label">{label}</span>
      {keys.map(k => {
        const i = active.findIndex(a => a.id === k.id);
        return (
          <button key={k.id} className={`chip${i >= 0 ? ' chip--on' : ''}`}
                  onClick={() => onChange(toggleKey(active, k))}>
            {i >= 0 && <i>{i + 1}</i>}{k.label}
          </button>
        );
      })}
      {active.length > 0 &&
        <button className="chip chip--clear" onClick={() => onChange([])}>clear</button>}
    </div>
  );
}
