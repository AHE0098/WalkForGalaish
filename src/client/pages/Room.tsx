import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGame } from '../useGame.js';
import { GenericCard } from '../GenericCard.js';

export function Room() {
  const { code = '' } = useParams();
  const { payload, error, setError, emit, playerId } = useGame();
  const nav = useNavigate();
  const room = payload?.room;
  const view = payload?.view;

  React.useEffect(() => { void emit('joinRoom', { code }); }, [code]);

  const leave = async () => { await emit('leaveRoom', { code }); nav('/'); };

  if (!room) return <main className="wrap"><p>Connecting to {code}…</p>
    <button onClick={() => nav('/')}>Home</button></main>;

  // ---- Lobby ----
  if (!view || view.status === 'lobby') {
    return (
      <main className="wrap">
        <h1>Room {room.code}</h1>
        {error && <p className="err">{error}</p>}
        <ul className="players">
          {room.players.map((p: any) => (
            <li key={p.id}>{p.name}{p.id === room.hostId ? ' (host)' : ''}
              {p.connected ? '' : ' — disconnected'}</li>
          ))}
        </ul>
        <p className="muted">{room.players.length} player(s)</p>
        <div className="row">
          {room.hostId === playerId &&
            <button onClick={() => emit('startGame', { code })}>Start game</button>}
          <button onClick={leave}>Leave room</button>
        </div>
      </main>
    );
  }

  // ---- Results ----
  if (view.status === 'finished') {
    const ranked = [...view.players].sort((a: any, b: any) => b.score - a.score);
    return (
      <main className="wrap">
        <h1>Final scores</h1>
        <ol>{ranked.map((p: any) => <li key={p.id}>{p.name}: {p.score} VP</li>)}</ol>
        <div className="row"><button onClick={leave}>Return home</button></div>
      </main>
    );
  }

  // ---- Game ----
  const me = view.players.find((p: any) => p.id === playerId);
  const readyCount = view.players.filter((p: any) => p.ready).length;

  return (
    <main className="board">
      <header className="status">
        <b>Race for the Galaxy</b> · Room {room.code} · Round {view.round} ·
        Phase {view.currentPhase ?? 'choose action'} ·
        Supply {view.supplyCount} · Discard {view.discardCount} ·
        Ready {readyCount}/{view.players.length} · Your score {me?.score ?? 0}
      </header>
      {error && <p className="err" onClick={() => setError(null)}>{error}</p>}

      <section className="opponents">
        {view.players.filter((p: any) => p.id !== playerId).map((p: any) => (
          <div key={p.id} className="opponent">
            <b>{p.name}</b> · hand {p.handCount} · {p.score} VP · {p.ready ? 'ready' : 'thinking'}
            <div className="mini-tableau">
              {p.tableau.map((t: any) => (
                <span key={t.instanceId} className="mini">{t.defId}{t.goods.length ? ' ●' : ''}</span>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2>Your tableau</h2>
        <div className="row wrap-row">
          {me?.tableau.map((t: any) => (
            <GenericCard key={t.instanceId}
              card={{ id: t.defId, name: t.defId, stats: [], badges: t.goods.length ? ['good'] : [], powers: [] }} />
          ))}
        </div>
      </section>

      <section>
        <h2>Your hand ({view.hand.length})</h2>
        <div className="row wrap-row">
          {view.hand.map((c: any) => (
            <GenericCard key={c.instanceId}
              card={{ id: c.defId, name: c.defId, stats: [], badges: [], powers: [] }} />
          ))}
        </div>
      </section>

      <footer className="row">
        {view.currentPhase === null && !view.yourChoiceSubmitted &&
          ['explore-5','explore-1-1','develop','settle','consume-trade','consume-2x','produce']
            .map(a => (
              <button key={a} onClick={() => emit('action', { code,
                action: { type: 'SELECT_ACTION_CARD', phaseId: view.phaseId, payload: { actionCard: a } } })}>
                {a}
              </button>
            ))}
        {view.currentPhase !== null &&
          <button onClick={() => emit('ready', { code, phaseId: view.phaseId, ready: true })}>
            Ready
          </button>}
        <button onClick={leave}>Leave game</button>
      </footer>
    </main>
  );
}
