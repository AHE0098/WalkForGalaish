import React, { useEffect } from 'react';
import { GenericCard } from './GenericCard.js';
import { powersByPhase, type CardFace } from './cardDb.js';

/**
 * Full-size reader for one card. Any click, tap, or Escape closes it —
 * no hunting for a small X. Works for hand, tableau, opponent and drawn cards.
 */
export function CardInspector({
  face, onClose, action, note,
}: {
  face: CardFace; onClose: () => void;
  action?: { label: string; onClick: () => void }; note?: string;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const { rows, endGame } = powersByPhase(face);

  return (
    <div className="inspector" onClick={onClose} role="dialog" aria-label={face.name}>
      <div className="inspector__inner" onClick={e => e.stopPropagation()}>
        <GenericCard face={face} size="large" />

        <div className="inspector__detail">
          <h3>{face.name}</h3>
          <dl className="powergrid">
            {rows.map(r => (
              <React.Fragment key={r.phase}>
                <dt className={r.lines.length ? '' : 'dim'}>{r.numeral}</dt>
                <dd className={r.lines.length ? '' : 'dim'}>
                  {r.lines.length ? r.lines.map((l, i) => <div key={i}>{l}</div>) : 'no power'}
                </dd>
              </React.Fragment>
            ))}
            {endGame.length > 0 && (
              <>
                <dt>★</dt>
                <dd>{endGame.map((l, i) => <div key={i}>{l}</div>)}</dd>
              </>
            )}
          </dl>
          {note && <p className="inspector__note">{note}</p>}
          {action && (
            <button className="primary wide" onClick={action.onClick}>{action.label}</button>
          )}
          <p className="muted tiny">Tap anywhere to close</p>
        </div>
      </div>
    </div>
  );
}
