import React from 'react';
import { Good } from '../Good.js';

export interface PlayerOption {
  id: string; label: string; detail?: string;
  spends?: string[]; kinds?: string[]; forced?: boolean;
}

/**
 * The choices the game is offering right now, one button each. Generic: any
 * game can put options on the wire and they render here.
 */
export function OptionList({ options, onChoose, onAuto, title, note }: {
  options: PlayerOption[];
  onChoose: (id: string) => void;
  onAuto?: () => void;
  title: string;
  note?: string;
}) {
  if (!options.length) return null;
  return (
    <section className="options">
      <h2 className="tight">{title}</h2>
      {note && <p className="muted tiny">{note}</p>}
      <div className="optiongrid">
        {options.map(o => (
          <button key={o.id} className="optionbtn" onClick={() => onChoose(o.id)}>
            <span className="optionbtn__kinds">
              {(o.kinds ?? []).filter(Boolean).slice(0, 4)
                .map((k, i) => <Good key={i} kind={k} size={15} />)}
            </span>
            <span>
              <b>{o.label}</b>
              {o.detail && <i>{o.detail}</i>}
            </span>
            {o.forced && <span className="forced" title="Required by the rules">forced</span>}
          </button>
        ))}
      </div>
      {onAuto && options.length > 1 && (
        <button className="ghost" onClick={onAuto}>Resolve the rest for me</button>
      )}
    </section>
  );
}
