import React from 'react';

export interface CardViewModel {
  id: string; name: string;
  stats: Array<{ label: string; value: string | number }>;
  badges: string[];
  powers: Array<{ phase: string; text: string }>;
  imageUrl?: string | null;
  kind?: string;
}

/**
 * One renderer for every card in every game. It is told which fields to show;
 * it never interprets what they mean. Missing artwork is a normal case.
 */
export function GenericCard(
  { card, onClick, selected }: { card: CardViewModel; onClick?: () => void; selected?: boolean },
) {
  return (
    <div className={`card${selected ? ' selected' : ''}`} onClick={onClick}
         role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      <div className="card-top">
        {card.stats.map(s => (
          <span key={s.label} className="stat" title={s.label}>{s.value}</span>
        ))}
      </div>
      <div className="card-art">
        {card.imageUrl
          ? <img src={card.imageUrl} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
          : <span className="art-placeholder">{card.kind ?? ''}</span>}
      </div>
      <div className="card-name">{card.name}</div>
      <div className="badges">{card.badges.map(b => <span key={b} className="badge">{b}</span>)}</div>
      <div className="powers">
        {card.powers.map((p, i) => (
          <div key={i} className="power"><b>{p.phase}</b> {p.text}</div>
        ))}
      </div>
    </div>
  );
}
