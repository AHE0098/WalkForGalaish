import React, { useEffect, useRef, useState } from 'react';
import { Good } from './Good.js';

export interface GameEvent {
  id: number; type: string; who?: string; whoName?: string;
  text: string; cardId?: string; kind?: string; value?: number;
}

/** A little colour, so the table has a voice. Purely cosmetic. */
const FLAVOUR: Record<string, string[]> = {
  settle:  ['claims a world', 'plants a flag', 'the empire grows', 'another one'],
  develop: ['builds it out', 'the machine hums', 'progress', 'engineering, applied'],
  explore: ['scouts ahead', 'charts the dark', 'something out there'],
  produce: ['the factories turn', 'goods on the line', 'output secured'],
  consume: ['cashes in', 'points banked', 'good business'],
  trade:   ['sold at a fine price', 'the market smiles', 'cargo away'],
  discard: ['travels lighter', 'lets it go'],
  pass:    ['bides their time', 'holds fire'],
};
const pick = (a: string[], seed: number) => a[seed % a.length]!;

const ICON: Record<string, string> = {
  settle: '◉', develop: '◆', explore: '✦', produce: '⚙',
  consume: '★', trade: '⇄', discard: '✕', pass: '…',
};

/**
 * Shows what just happened, one card at a time. Events arrive with monotonic
 * ids, so the feed simply shows anything it has not shown before — no diffing
 * of game state, nothing to get out of sync, and a dropped frame costs nothing.
 */
export function Feed({ events, you }: { events: GameEvent[]; you: string }) {
  const [shown, setShown] = useState<GameEvent[]>([]);
  const seen = useRef(0);

  useEffect(() => {
    if (!events?.length) return;
    const fresh = events.filter(e => e.id > seen.current);
    if (!fresh.length) return;
    seen.current = events[events.length - 1]!.id;
    // Never flood: the last three are enough to follow the action.
    setShown(prev => [...prev, ...fresh].slice(-3));
    const timer = setTimeout(
      () => setShown(prev => prev.filter(e => e.id > seen.current - 3)), 4200);
    return () => clearTimeout(timer);
  }, [events]);

  useEffect(() => {
    if (!shown.length) return;
    const t = setTimeout(() => setShown(prev => prev.slice(1)), 4200);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown.length) return null;

  return (
    <div className="feed" aria-live="polite">
      {shown.map(e => (
        <div key={e.id} className={`feed__item feed__item--${e.type}` +
          `${e.who === you ? ' feed__item--mine' : ''}`}>
          <span className="feed__icon" aria-hidden>{ICON[e.type] ?? '•'}</span>
          <span className="feed__body">
            <b>{e.who === you ? 'You' : e.whoName ?? 'Someone'}</b> {e.text}
            {FLAVOUR[e.type] && <i> — {pick(FLAVOUR[e.type]!, e.id)}</i>}
          </span>
          {e.kind && <Good kind={e.kind} size={15} />}
        </div>
      ))}
    </div>
  );
}

/** Turning gears: the table is thinking, and you can see that it is. */
export function Gears({ label }: { label: string }) {
  return (
    <div className="gears" role="status">
      <svg viewBox="0 0 44 30" width="46" height="32" aria-hidden>
        <g className="gears__a">
          <circle cx="14" cy="15" r="7" />
          {[0, 60, 120, 180, 240, 300].map(a => (
            <rect key={a} x="12.5" y="4" width="3" height="4" rx="1"
                  transform={`rotate(${a} 14 15)`} />
          ))}
        </g>
        <g className="gears__b">
          <circle cx="31" cy="20" r="5" />
          {[0, 72, 144, 216, 288].map(a => (
            <rect key={a} x="29.8" y="12.5" width="2.4" height="3.4" rx="1"
                  transform={`rotate(${a} 31 20)`} />
          ))}
        </g>
      </svg>
      <span>{label}</span>
    </div>
  );
}
