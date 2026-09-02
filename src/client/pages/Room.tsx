import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGame } from '../useGame.js';
import { useCardDb, powerLine, type CardFace } from '../cardDb.js';
import { GenericCard, type CardMood } from '../GenericCard.js';

const ACTIONS = [
  { id: 'explore-5', label: 'Explore +5', hint: 'draw 7, keep 1', phase: 'explore' },
  { id: 'explore-1-1', label: 'Explore +1,+1', hint: 'draw 3, keep 2', phase: 'explore' },
  { id: 'develop', label: 'Develop', hint: 'pay 1 less', phase: 'develop' },
  { id: 'settle', label: 'Settle', hint: 'draw after settling', phase: 'settle' },
  { id: 'consume-trade', label: 'Consume: Trade', hint: 'sell a good first', phase: 'consume' },
  { id: 'consume-2x', label: 'Consume: ×2 VP', hint: 'double VP chips', phase: 'consume' },
  { id: 'produce', label: 'Produce', hint: 'extra windfall good', phase: 'produce' },
];
const PHASES = [
  { id: 'explore', label: 'I Explore' }, { id: 'develop', label: 'II Develop' },
  { id: 'settle', label: 'III Settle' }, { id: 'consume', label: 'IV Consume' },
  { id: 'produce', label: 'V Produce' },
];

export function Room() {
  const { code = '' } = useParams();
  const { payload, error, setError, emit, playerId } = useGame();
  const db = useCardDb();
  const nav = useNavigate();

  const [picked, setPicked] = useState<string[]>([]);   // explore keeps / opening discards
  const [inspect, setInspect] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ instanceId: string; cost: number } | null>(null);
  const [payment, setPayment] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);

  const room = payload?.room;
  const view = payload?.view;

  React.useEffect(() => { void emit('joinRoom', { code }); }, [code]);
  React.useEffect(() => { setPicked([]); setInspect(null); setPaying(null); setPayment([]); },
    [view?.phaseId]);

  const face = (defId?: string): CardFace | undefined => (defId && db ? db[defId] : undefined);
  const leave = async () => { await emit('leaveRoom', { code }); nav('/'); };
  const act = (type: string, extra: Record<string, unknown> = {}) =>
    emit('action', { code, action: { type, phaseId: view.phaseId, payload: extra } });

  if (!room) return <main className="pad"><p>Connecting to {code}…</p>
    <button onClick={() => nav('/')}>Home</button></main>;

  // ------------------------------------------------------------------ lobby
  if (!view || view.status === 'lobby') {
    return (
      <main className="pad">
        <h1>Room <code className="roomcode">{room.code}</code></h1>
        <p className="muted">Share this code. 2–4 players.</p>
        {error && <p className="err" onClick={() => setError(null)}>{error}</p>}
        <ul className="stack">
          {room.players.map((p: any) => (
            <li key={p.id} className="pill">
              {p.name}{p.id === room.hostId ? ' · host' : ''}{p.connected ? '' : ' · away'}
            </li>
          ))}
        </ul>
        <div className="btnrow">
          {room.hostId === playerId
            ? <button className="primary" disabled={room.players.length < 2}
                      onClick={() => emit('startGame', { code })}>
                {room.players.length < 2 ? 'Waiting for a second player…' : 'Start game'}
              </button>
            : <span className="muted">Waiting for the host to start…</span>}
          <button onClick={leave}>Leave</button>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------- results
  if (view.status === 'finished') {
    const ranked = [...view.players].sort((a: any, b: any) => b.score - a.score);
    return (
      <main className="pad">
        <h1>Final scores</h1>
        <ol className="stack">
          {ranked.map((p: any, i: number) => (
            <li key={p.id} className={`pill${i === 0 ? ' pill--win' : ''}`}>
              <b>{p.name}</b> — {p.score} VP {i === 0 && <span className="tag tag--good">winner</span>}
              <div className="muted" style={{ fontSize: 12 }}>
                {Object.entries(p.scoreParts ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ')}
                {` · ${p.tableau.length} cards in tableau`}
              </div>
            </li>
          ))}
        </ol>
        <div className="btnrow"><button className="primary" onClick={leave}>Return home</button></div>
      </main>
    );
  }

  // ------------------------------------------------------------------- game
  const me = view.players.find((p: any) => p.id === playerId);
  const opponents = view.players.filter((p: any) => p.id !== playerId);
  const phase = view.currentPhase;
  const legal: string[] = view.legalActions ?? [];
  const opening = !!view.info?.openingDiscard;
  const keepCount = view.info?.keepCount ?? 1;
  const iAmReady = !!me?.ready;
  const chips = (view.info?.vpChips ?? {}) as Record<string, number>;

  const toggle = (id: string, max: number) => setPicked(prev =>
    prev.includes(id) ? prev.filter(x => x !== id)
      : prev.length >= max ? prev : [...prev, id]);

  const startPlay = (instanceId: string) => {
    const p = view.playable[instanceId];
    if (!p?.ok) return;
    setInspect(null);
    if ((p.cost ?? 0) === 0) { void act('PLAY_CARD', { instanceId, payment: [] }); return; }
    setPaying({ instanceId, cost: p.cost ?? 0 }); setPayment([]);
  };

  const confirmPay = async () => {
    if (!paying) return;
    await act('PLAY_CARD', { instanceId: paying.instanceId, payment });
    setPaying(null); setPayment([]);
  };

  const moodOf = (instanceId: string): CardMood => {
    if (opening || phase === null) return picked.includes(instanceId) ? 'selected' : 'plain';
    if (paying) return payment.includes(instanceId) ? 'selected'
      : instanceId === paying.instanceId ? 'plain' : 'playable';
    const p = view.playable[instanceId];
    if (!p) return 'plain';
    return p.ok ? 'playable' : 'blocked';
  };

  const instruction = opening
    ? `Discard 2 cards to finish setup (${picked.length}/2 chosen)`
    : phase === null
      ? (view.yourChoiceSubmitted ? 'Waiting for the other players…' : 'Choose your action card')
      : phase === 'explore'
        ? `Keep ${keepCount} of the drawn cards (${picked.length}/${keepCount})`
        : phase === 'develop' ? 'Play one development, or pass'
        : phase === 'settle' ? 'Settle one world, or pass'
        : phase === 'consume' ? 'Consume resolved automatically — check the log'
        : 'Goods produced — check the log';

  return (
    <div className="board">
      <header className="topbar">
        <span className="topbar__title">Race for the Galaxy</span>
        <span className="chipline">
          <b>{room.code}</b><i>room</i></span>
        <span className="chipline"><b>{view.round}</b><i>round</i></span>
        <span className="chipline"><b>{view.supplyCount}</b><i>deck</i></span>
        <span className="chipline"><b>{view.info?.vpPool ?? '–'}</b><i>vp pool</i></span>
        <span className="chipline"><b>{me?.score ?? 0}</b><i>your vp</i></span>
        <span className="chipline"><b>{view.players.filter((p: any) => p.ready).length}/{view.players.length}</b><i>ready</i></span>
        <button className="ghost" onClick={() => setShowLog(v => !v)}>{showLog ? 'Hide' : 'Log'}</button>
        <button className="ghost" onClick={leave}>Leave</button>
      </header>

      <nav className="phasebar" aria-label="Phases this round">
        {PHASES.map(p => {
          const included = view.phasesThisRound.includes(p.id);
          const active = phase === p.id;
          const done = included && !active &&
            view.phasesThisRound.indexOf(p.id) < view.phasesThisRound.indexOf(phase ?? '');
          return (
            <span key={p.id}
                  className={`phase${included ? ' phase--on' : ''}${active ? ' phase--now' : ''}${done ? ' phase--done' : ''}`}>
              {p.label}
            </span>
          );
        })}
      </nav>

      <p className="instruction">{instruction}</p>
      {error && <p className="err" onClick={() => setError(null)}>{error}</p>}

      {showLog && (
        <section className="logbox">
          {view.log.slice().reverse().map((l: string, i: number) => <div key={i}>{l}</div>)}
        </section>
      )}

      <section className="opponents">
        {opponents.map((p: any) => (
          <article key={p.id} className="opp">
            <header>
              <b>{p.name}</b>
              <span className={`dot${p.ready ? ' dot--ready' : ''}`} title={p.ready ? 'ready' : 'thinking'} />
            </header>
            <div className="opp__stats">
              hand {p.handCount} · {p.score} vp · chips {chips[p.id] ?? 0} · {p.tableau.length} cards
              {view.roundActions?.[p.id] ? ` · ${view.roundActions[p.id]}` : ''}
            </div>
            <div className="minirow">
              {p.tableau.map((t: any) => (
                <GenericCard key={t.instanceId} face={face(t.defId)} compact goods={t.goods.length}
                             onClick={() => setInspect(t.defId)} />
              ))}
            </div>
          </article>
        ))}
      </section>

      <section>
        <h2>Your tableau <span className="muted">({me?.tableau.length ?? 0} cards · 12 ends the game)</span></h2>
        <div className="cardrow">
          {me?.tableau.map((t: any) => (
            <GenericCard key={t.instanceId} face={face(t.defId)} goods={t.goods.length}
                         onClick={() => setInspect(t.defId)} />
          ))}
        </div>
      </section>

      {phase === 'explore' && view.selection.length > 0 && (
        <section className="highlightbox">
          <h2>Drawn cards — keep {keepCount}</h2>
          <div className="cardrow">
            {view.selection.map((c: any) => (
              <GenericCard key={c.instanceId} face={face(c.defId)}
                           mood={picked.includes(c.instanceId) ? 'selected' : 'playable'}
                           onClick={() => toggle(c.instanceId, keepCount)} />
            ))}
          </div>
          <button className="primary" disabled={picked.length !== Math.min(keepCount, view.selection.length)}
                  onClick={() => act('KEEP_CARDS', { instanceIds: picked })}>
            Keep {picked.length}/{keepCount}
          </button>
        </section>
      )}

      <section>
        <h2>Your hand <span className="muted">({view.hand.length})</span></h2>
        <div className="cardrow">
          {view.hand.map((c: any) => {
            const p = view.playable[c.instanceId];
            return (
              <GenericCard key={c.instanceId} face={face(c.defId)} mood={moodOf(c.instanceId)}
                badge={p?.ok && p.cost !== undefined ? `pay ${p.cost}` : undefined}
                onClick={() => {
                  if (opening) return toggle(c.instanceId, 2);
                  if (paying) {
                    if (c.instanceId === paying.instanceId) return;
                    return setPayment(prev => prev.includes(c.instanceId)
                      ? prev.filter(x => x !== c.instanceId)
                      : prev.length >= paying.cost ? prev : [...prev, c.instanceId]);
                  }
                  setInspect(c.defId);
                }} />
            );
          })}
        </div>
      </section>

      <footer className="actionbar">
        {opening && (
          <button className="primary" disabled={picked.length !== 2}
                  onClick={() => act('DISCARD_CARDS', { instanceIds: picked })}>
            Discard {picked.length}/2
          </button>
        )}

        {!opening && phase === null && !view.yourChoiceSubmitted && (
          <div className="actiongrid">
            {ACTIONS.map(a => (
              <button key={a.id} onClick={() => act('SELECT_ACTION_CARD', { actionCard: a.id })}>
                <b>{a.label}</b><i>{a.hint}</i>
              </button>
            ))}
          </div>
        )}

        {!opening && phase === null && view.yourChoiceSubmitted && (
          <span className="muted">Action chosen — waiting for the others.</span>
        )}

        {paying && (
          <div className="payline">
            <span>Select {paying.cost} card(s) to discard as payment — {payment.length}/{paying.cost}</span>
            <button className="primary" disabled={payment.length !== paying.cost} onClick={confirmPay}>
              Confirm
            </button>
            <button onClick={() => { setPaying(null); setPayment([]); }}>Cancel</button>
          </div>
        )}

        {!opening && !paying && (phase === 'develop' || phase === 'settle') && !iAmReady && (
          <button onClick={() => act('PASS')}>Pass</button>
        )}

        {!opening && !paying && legal.includes('READY') && !iAmReady && (
          <button className="primary"
                  onClick={() => emit('ready', { code, phaseId: view.phaseId, ready: true })}>
            Continue
          </button>
        )}

        {iAmReady && phase !== null && <span className="muted">Waiting for the other players…</span>}
      </footer>

      {inspect && db?.[inspect] && (
        <div className="modal" onClick={() => setInspect(null)}>
          <div className="modal__card" onClick={e => e.stopPropagation()}>
            <h3>{db[inspect]!.name}</h3>
            <GenericCard face={db[inspect]} />
            <ul className="powerlist">
              {db[inspect]!.powers.map((p, i) => <li key={i}>{powerLine(p)}</li>)}
              {!db[inspect]!.powers.length && <li className="muted">No powers.</li>}
            </ul>
            {(() => {
              const inHand = view.hand.find((c: any) => c.defId === inspect);
              const p = inHand ? view.playable[inHand.instanceId] : undefined;
              if (!inHand) return null;
              return p?.ok
                ? <button className="primary" onClick={() => startPlay(inHand.instanceId)}>
                    Play {p.cost ? `(pay ${p.cost})` : '(free)'}
                  </button>
                : <p className="muted">{p?.reason ?? 'Cannot be played in this phase.'}</p>;
            })()}
            <button onClick={() => setInspect(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
