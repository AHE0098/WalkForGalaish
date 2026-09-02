import React from 'react';

/** Everything a player might want to check, behind one button. */
export function StatusSheet({ view, room, onClose }: { view: any; room: any; onClose: () => void }) {
  const chips = (view.info?.vpChips ?? {}) as Record<string, number>;
  const actions = view.roundActions ?? {};

  return (
    <div className="inspector" onClick={onClose} role="dialog" aria-label="Game status">
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h3>Game status</h3>

        <div className="statgrid">
          <span><b>{room.code}</b><i>room</i></span>
          <span><b>{view.round}</b><i>round</i></span>
          <span><b>{view.supplyCount}</b><i>deck</i></span>
          <span><b>{view.discardCount}</b><i>graveyard</i></span>
          <span><b>{view.info?.vpPool ?? '–'}</b><i>vp pool</i></span>
          <span><b>{view.currentPhase ?? 'choosing'}</b><i>phase</i></span>
        </div>

        <table className="scoretable">
          <thead>
            <tr><th>Player</th><th>VP</th><th>Chips</th><th>Hand</th><th>Cards</th><th>Action</th></tr>
          </thead>
          <tbody>
            {view.players.map((p: any) => (
              <tr key={p.id} className={p.id === view.you ? 'me' : ''}>
                <td>{p.name}{p.ready ? ' ✓' : ''}</td>
                <td>{p.score}</td>
                <td>{chips[p.id] ?? 0}</td>
                <td>{p.handCount}</td>
                <td>{p.tableau.length}/12</td>
                <td className="tiny">{String(actions[p.id] ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="tight">Recent events</h3>
        <div className="logbox">
          {view.log.slice().reverse().map((l: string, i: number) => <div key={i}>{l}</div>)}
        </div>
        <p className="muted tiny">Tap anywhere to close</p>
      </div>
    </div>
  );
}
