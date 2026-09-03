import React from 'react';

/** In-game menu: continue playing, browse the deck, or step out. */
export function MenuView({ items }: {
  items: Array<{ label: string; hint?: string; onClick: () => void; tone?: 'primary' | 'danger' }>;
}) {
  return (
    <div className="menulist">
      {items.map(it => (
        <button key={it.label} onClick={it.onClick}
                className={`menuitem${it.tone ? ` menuitem--${it.tone}` : ''}`}>
          <b>{it.label}</b>
          {it.hint && <i>{it.hint}</i>}
        </button>
      ))}
    </div>
  );
}
