import React from 'react';
import { costFace, powersByPhase, type CardFace } from './cardDb.js';
import { useAssets } from './assets.js';
import { Good } from './Good.js';

export type CardMood = 'plain' | 'playable' | 'blocked' | 'selected';
export type CardSize = 'mini' | 'normal' | 'large';

/**
 * The printed card, drawn from data. The cost pip mirrors the physical game:
 * diamond for developments, circle for worlds, red for military, a solid colour
 * for production worlds and a halo for windfall worlds.
 *
 * Every text element sits on its own scrim so it stays legible once card art is
 * dropped in behind it.
 */
export function GenericCard({
  face, mood = 'plain', size = 'normal', badge, goods = 0, goodKind, onClick, imageUrl,
}: {
  face: CardFace | undefined; mood?: CardMood; size?: CardSize;
  badge?: string; goods?: number; goodKind?: string | null;
  onClick?: () => void; imageUrl?: string | null;
}) {
  const assets = useAssets();
  if (!face) return <div className={`card card--${size} card--ghost`} />;
  const art = imageUrl ?? (assets.renderMode === 'generated' ? null : assets.card(face.cardId));

  const pip = costFace(face);
  const { rows, endGame } = powersByPhase(face);
  const hasPowers = rows.some(r => r.lines.length) || endGame.length;
  const mini = size === 'mini';

  return (
    <button type="button" onClick={onClick} disabled={!onClick} aria-label={face.name}
            className={`card card--${size} card--${mood}${art ? ' card--art' : ''}`}>
      {art && <img className="card__image" src={art} alt="" loading="lazy"
                   onError={e => { e.currentTarget.style.display = 'none'; }} />}

      <span className="card__top">
        <span className={`pip pip--${pip.shape}${pip.military ? ' pip--mil' : ''}`}
              data-fill={pip.fill ?? undefined} data-halo={pip.halo ?? undefined}>
          <i>{pip.value}</i>
        </span>
        <span className="vp">{face.victoryPoints ?? '?'}<i>VP</i></span>
      </span>

      <span className="card__title">{face.name}</span>

      {!mini && (
        <span className="card__tags">
          <i className={`tag tag--${face.cardType === 'development' ? 'dev' : 'world'}`}>
            {face.cardType === 'development' ? 'development' : 'world'}
          </i>
          {face.world?.resourceType &&
            <i className={`tag tag--${face.world.resourceType}`}>{face.world.resourceType}</i>}
          {face.world?.productionMode === 'windfall' && <i className="tag">windfall</i>}
          {face.world?.isRebel && <i className="tag tag--rebel">rebel</i>}
          {face.isSixCostDevelopment && <i className="tag tag--six">6-cost</i>}
        </span>
      )}

      {/* The phase rail keeps I–V in the same place on every card, like the print. */}
      {!mini && (
        <span className="rail">
          {rows.map(r => (
            <span key={r.phase} className={`rail__row${r.lines.length ? '' : ' rail__row--empty'}`}>
              <i className="rail__num">{r.numeral}</i>
              <i className="rail__text">{r.lines.join(' · ') || '—'}</i>
            </span>
          ))}
          {endGame.length > 0 && (
            <span className="rail__row rail__row--end">
              <i className="rail__num">★</i>
              <i className="rail__text">{endGame.join(' · ')}</i>
            </span>
          )}
        </span>
      )}

      {mini && hasPowers && <span className="card__more" aria-hidden>…</span>}
      {goods > 0 && (
        <span className="goodslot" title={`${goods} ${goodKind ?? ''} good${goods > 1 ? 's' : ''}`}>
          <Good kind={goodKind ?? face.world?.resourceType ?? null} size={size === 'mini' ? 13 : 17} />
          {goods > 1 && <i>{goods}</i>}
        </span>
      )}
      {badge && <span className="card__badge">{badge}</span>}
      {size === 'normal' && <span className="card__more card__more--corner" aria-hidden>…</span>}
    </button>
  );
}
