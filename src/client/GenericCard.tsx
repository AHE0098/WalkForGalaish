import React from 'react';
import { costFace, powerLine, type CardFace } from './cardDb.js';

export type CardMood = 'plain' | 'playable' | 'blocked' | 'selected';

/**
 * One renderer for every card. It is handed a face plus a mood; it never decides
 * legality itself. Artwork is optional — the card is complete without it.
 */
export function GenericCard({
  face, mood = 'plain', badge, goods = 0, onClick, compact, imageUrl,
}: {
  face: CardFace | undefined; mood?: CardMood; badge?: string; goods?: number;
  onClick?: () => void; compact?: boolean; imageUrl?: string | null;
}) {
  if (!face) return <div className="card card--ghost" />;
  const { value, kind } = costFace(face);
  const res = face.world?.resourceType;
  const mode = face.world?.productionMode;

  return (
    <button type="button" className={`card card--${mood}${compact ? ' card--compact' : ''}`}
            onClick={onClick} disabled={!onClick} aria-label={face.name}>
      <span className="card__head">
        <span className={`pip pip--${kind}`}>{value}</span>
        <span className="pip pip--vp">{face.victoryPoints ?? '?'}<i>vp</i></span>
      </span>

      {imageUrl && <img className="card__art" src={imageUrl} alt=""
                        onError={e => { e.currentTarget.style.display = 'none'; }} />}

      <span className="card__name">{face.name}</span>

      <span className="card__tags">
        {face.cardType === 'development'
          ? <i className="tag tag--dev">dev</i>
          : <i className="tag tag--world">world</i>}
        {res && <i className={`tag tag--${res}`}>{res}</i>}
        {mode === 'windfall' && <i className="tag">windfall</i>}
        {mode === 'production' && <i className="tag">produces</i>}
        {face.world?.isRebel && <i className="tag tag--rebel">rebel</i>}
        {face.isSixCostDevelopment && <i className="tag tag--six">6-cost</i>}
        {goods > 0 && <i className="tag tag--good">{goods} good</i>}
      </span>

      {!compact && (
        <span className="card__powers">
          {face.powers.slice(0, 4).map((p, i) => <em key={i}>{powerLine(p)}</em>)}
          {face.powers.length > 4 && <em>+{face.powers.length - 4} more…</em>}
        </span>
      )}

      {badge && <span className="card__badge">{badge}</span>}
    </button>
  );
}
