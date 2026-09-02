import React, { useEffect, useState } from 'react';

/**
 * The table stops together to rebuild the supply from the discard pile.
 * The animation is decorative — the actual shuffle happens on the server once
 * every player has confirmed.
 */
export function Reshuffle({ ready, discardCount, onReady }:
  { ready: boolean; discardCount: number; onReady: () => void }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => setTick(v => v + 1), 420);
    return () => clearInterval(t);
  }, [ready]);

  return (
    <section className="reshuffle">
      <div className="riffle" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <span key={i} className={`riffle__card${ready ? ' riffle__card--go' : ''}`}
                style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
      <div>
        <h2 className="tight">Reshuffle the graveyard</h2>
        <p className="muted">
          The supply is empty. {discardCount} discarded card{discardCount === 1 ? '' : 's'} go back in.
        </p>
        {ready
          ? <p className="shuffling">Shuffling{'.'.repeat(1 + (tick % 3))}</p>
          : <button className="primary" onClick={onReady}>Ready to shuffle</button>}
      </div>
    </section>
  );
}
