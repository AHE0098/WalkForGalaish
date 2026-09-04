import React from 'react';
import { GoodTally } from '../Good.js';

/** Everything a player might want to check, including live military strength. */
export function StatusView({ view, room }: { view: any; room: any }) {
  const chips = (view.info?.vpChips ?? {}) as Record<string, number>;
  const actions = view.roundActions ?? {};

  return (
    <div className="sheetbody">
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
          <tr><th>Player</th><th>VP</th><th>Chips</th><th>Mil</th><th>Goods</th>
              <th>Hand</th><th>Table</th><th>Action</th></tr>
        </thead>
        <tbody>
          {view.players.map((p: any) => (
            <tr key={p.id} className={p.id === view.you ? 'me' : ''}>
              <td>
                {p.name}
                {p.ready && <span className="ok-tick" title="ready"> ✓</span>}
                {!p.connected && <span className="away" title="disconnected"> away</span>}
              </td>
              <td>{p.score}</td>
              <td>{chips[p.id] ?? 0}</td>
              <td>
                {p.stats?.military ?? 0}
                {Number(p.stats?.tempMilitary ?? 0) > 0 &&
                  <span className="temp" title="temporary this phase">
                    +{p.stats.tempMilitary}</span>}
              </td>
              <td><GoodTally stats={p.stats} /></td>
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
    </div>
  );
}
