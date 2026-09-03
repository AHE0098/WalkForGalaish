import React, { useEffect, useState } from 'react';
import { GenericCard } from './GenericCard.js';
import { powersByPhase, type CardFace } from './cardDb.js';
import { cardHelp, PHASE_HELP } from './cardHelp.js';

/**
 * Full-size card reader. Shows the art, every power in phase order, and a short
 * type-aware explanation of how this kind of card is actually played.
 * Any click, tap or Escape closes it.
 */
export function CardInspector({
  face, onClose, action, note,
}: {
  face: CardFace; onClose: () => void;
  action?: { label: string; onClick: () => void }; note?: string;
}) {
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const { rows, endGame } = powersByPhase(face);
  const help = cardHelp(face);

  return (
    <div className="inspector" onClick={onClose} role="dialog" aria-label={face.name}>
      <div className="inspector__inner" onClick={e => e.stopPropagation()}>
        <div className="inspector__cardwrap">
          <GenericCard face={face} size="large" />
          {showHelp && help.callouts.map(c => (
            <span key={c.n} className="callout"
                  style={{ top: c.at.top, left: c.at.left, right: c.at.right }}>{c.n}</span>
          ))}
        </div>

        <div className="inspector__detail">
          <h3>{face.name}</h3>
          <p className="inspector__headline">{help.headline}</p>

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
              <><dt className="star">★</dt>
                <dd>{endGame.map((l, i) => <div key={i}>{l}</div>)}</dd></>
            )}
          </dl>

          <button className="chip chip--wide" onClick={() => setShowHelp(v => !v)}>
            {showHelp ? 'Hide' : 'How does this card work?'}
          </button>

          {showHelp && (
            <div className="helpbox">
              <p className="helpbox__phase">{help.phase}</p>
              <ol className="helpbox__list">
                {help.callouts.map(c => (
                  <li key={c.n}><span className="callout callout--inline">{c.n}</span>
                    <b>{c.title}</b> {c.text}</li>
                ))}
              </ol>
              <div className="phasestrip">
                {PHASE_HELP.map(p => (
                  <span key={p.n}><b>{p.n}</b> {p.name}<i>{p.text}</i></span>
                ))}
              </div>
            </div>
          )}

          {note && <p className="inspector__note">{note}</p>}
          {action && <button className="primary wide" onClick={action.onClick}>{action.label}</button>}
          <p className="muted tiny">Tap anywhere to close</p>
        </div>
      </div>
    </div>
  );
}
