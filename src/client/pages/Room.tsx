import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGame } from '../useGame.js';
import { useCardDb, useDisplay, type CardFace } from '../cardDb.js';
import { GenericCard, type CardMood } from '../GenericCard.js';
import { CardInspector } from '../CardInspector.js';
import { Reshuffle } from '../Reshuffle.js';
import { useViews } from '../views/ViewHost.js';
import { DeckView } from '../views/DeckView.js';
import { StatusView } from '../views/StatusView.js';
import { MenuView } from '../views/MenuView.js';
import { ActionPrompt, ACTION_CARDS } from '../views/ActionPrompt.js';
import { CardZone } from '../CardZone.js';
import type { SortKey } from '../sort.js';
import { GoodTally } from '../Good.js';
import { OptionList } from '../views/OptionList.js';

const PHASES = [
  { id: 'explore', label: 'I Explore' }, { id: 'develop', label: 'II Develop' },
  { id: 'settle', label: 'III Settle' }, { id: 'consume', label: 'IV Consume' },
  { id: 'produce', label: 'V Produce' },
];

export function Room() {
  const { code = '' } = useParams();
  const { payload, error, setError, emit, playerId } = useGame();
  const db = useCardDb();
  const display = useDisplay();
  const views = useViews();
  const nav = useNavigate();

  const [picked, setPicked] = useState<string[]>([]);
  const [paying, setPaying] = useState<{ instanceId: string; cost: number } | null>(null);
  const [payment, setPayment] = useState<string[]>([]);
  const [showOpponents, setShowOpponents] = useState(false);

  const room = payload?.room;
  const view = payload?.view;
  const secondsLeft = payload?.secondsLeft ?? null;

  React.useEffect(() => { void emit('joinRoom', { code }); }, [code]);
  React.useEffect(() => { setPicked([]); setPaying(null); setPayment([]); }, [view?.phaseId]);

  const face = (defId?: string): CardFace | undefined => (defId && db ? db[defId] : undefined);
  const allCards = useMemo(() => (db ? Object.values(db) : []), [db]);
  const leave = async () => { await emit('leaveRoom', { code }); views.closeAll(); nav('/'); };
  const act = (type: string, extra: Record<string, unknown> = {}) =>
    emit('action', { code, action: { type, phaseId: view.phaseId, payload: extra } });

  const openCard = (f: CardFace, extra?: { action?: { label: string; onClick: () => void }; note?: string }) =>
    views.push({ id: `card-${f.cardId}`, node:
      <CardInspector face={f} onClose={() => views.pop()}
        action={extra?.action && { label: extra.action.label,
          onClick: () => { views.closeAll(); extra.action!.onClick(); } }}
        note={extra?.note} /> });

  const openDeck = () => views.push({ id: 'deck', title: 'Deck', wide: true, node:
    <DeckView cards={allCards} sortKeys={display?.sortKeys ?? []}
              counts={Object.fromEntries(allCards.map(c => [c.cardId, (c as any).quantity ?? 1]))}
              onOpen={f => openCard(f)} /> });

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
              {p.name}{p.id === room.hostId ? ' · host' : ''}
              {p.connected ? '' : <span className="away"> · away</span>}
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
          <button onClick={openDeck}>Browse deck</button>
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
              <div className="muted tiny">
                {Object.entries(p.scoreParts ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ')}
                {` · ${p.tableau.length} cards`}
              </div>
            </li>
          ))}
        </ol>
        <div className="btnrow">
          <button className="primary" onClick={leave}>Return home</button>
          <button onClick={openDeck}>Browse deck</button>
        </div>
      </main>
    );
  }

  // ------------------------------------------------------------------- game
  const me = view.players.find((p: any) => p.id === playerId);
  const opponents = view.players.filter((p: any) => p.id !== playerId);
  const phase = view.currentPhase;
  const legal: string[] = view.legalActions ?? [];
  const opening = !!view.info?.openingDiscard;
  const pending = view.info?.pending as
    { purpose: string; count: number; label: string } | null | undefined;
  const keepCount = view.info?.keepCount ?? 1;
  const iAmReady = !!me?.ready;
  // yourChoiceSubmitted is authoritative for "have I chosen this round".
  const myAction = view.yourChoiceSubmitted
    ? ((view.roundActions ?? {})[playerId] ?? 'chosen') : null;
  const choosing = !opening && phase === null;

  const sortKeys: SortKey[] = display?.sortKeys ?? [];
  const faceOf = (c: any) => db?.[c.defId] ?? {};

  const toggle = (id: string, max: number) => setPicked(prev =>
    prev.includes(id) ? prev.filter(x => x !== id)
      : prev.length >= max ? prev : [...prev, id]);

  const startPlay = (instanceId: string) => {
    const p = view.playable[instanceId];
    if (!p?.ok) return;
    if ((p.cost ?? 0) === 0) { void act('PLAY_CARD', { instanceId, payment: [] }); return; }
    setPaying({ instanceId, cost: p.cost ?? 0 }); setPayment([]);
  };

  const moodOf = (instanceId: string): CardMood => {
    if (opening || pending) return picked.includes(instanceId) ? 'selected' : 'playable';
    if (paying) return payment.includes(instanceId) ? 'selected'
      : instanceId === paying.instanceId ? 'plain' : 'playable';
    const p = view.playable[instanceId];
    if (!p) return 'plain';
    return p.ok ? 'playable' : 'blocked';
  };

  const tapHandCard = (c: any) => {
    if (opening) return toggle(c.instanceId, 2);
    if (pending) return toggle(c.instanceId, pending.count);
    if (paying) {
      if (c.instanceId === paying.instanceId) return;
      return setPayment(prev => prev.includes(c.instanceId)
        ? prev.filter(x => x !== c.instanceId)
        : prev.length >= paying.cost ? prev : [...prev, c.instanceId]);
    }
    const f = face(c.defId); if (!f) return;
    const p = view.playable[c.instanceId];
    openCard(f, {
      action: p?.ok ? { label: p.cost ? `Play — pay ${p.cost} card(s)` : 'Play for free',
                        onClick: () => startPlay(c.instanceId) } : undefined,
      note: p && !p.ok ? (p.reason ?? 'Not playable in this phase.') : undefined,
    });
  };

  const instruction = opening ? `Discard 2 cards to finish setup (${picked.length}/2)`
    : pending ? `${pending.label} — choose ${pending.count} (${picked.length}/${pending.count})`
    : phase === 'explore' ? `Keep ${keepCount} of the drawn cards (${picked.length}/${keepCount})`
    : phase === 'develop' ? 'Play one development, or pass'
    : phase === 'settle' ? 'Settle one world, or pass'
    : phase === 'consume'
      ? ((view.options ?? []).length
          ? 'Consume: choose how to spend your goods'
          : 'Nothing left to consume — continue when ready')
    : phase === 'reshuffle' ? 'Everyone must agree before the graveyard is shuffled back'
    : phase === 'produce' ? 'Goods produced — open status to see what happened'
    : '';

  return (
    <div className="board">
      <header className="topbar">
        <button className="statusbtn" onClick={() => views.push(
          { id: 'status', title: 'Game status', node: <StatusView view={view} room={room} /> })}>
          <span className="statusbtn__main"><b>{me?.score ?? 0}</b> VP<em>R{view.round}</em></span>
          <span className="statusbtn__sub">
            deck {view.supplyCount} · grave {view.discardCount} · mil {me?.stats?.military ?? 0}
            {Number(me?.stats?.tempMilitary ?? 0) > 0 && ` (+${me!.stats!.tempMilitary} temp)`} ·
            goods {me?.stats?.goods ?? 0} ·
            ready {view.players.filter((p: any) => p.ready).length}/{view.players.length}
          </span>
        </button>
        <button className={`ghost${showOpponents ? ' ghost--on' : ''}`}
                onClick={() => setShowOpponents(v => !v)}>
          {showOpponents ? 'Hide table' : 'Show table'}
        </button>
        <button className="ghost" onClick={() => views.push({ id: 'menu', title: 'Menu', node:
          <MenuView items={[
            { label: 'Resume game', hint: 'Back to the table', onClick: () => views.closeAll() },
            { label: 'Browse deck', hint: `All ${allCards.length} cards in this game`,
              onClick: () => { views.pop(); openDeck(); } },
            { label: 'Game status', hint: 'Scores, military, log',
              onClick: () => views.replace({ id: 'status', title: 'Game status',
                node: <StatusView view={view} room={room} /> }) },
            { label: 'Leave game', hint: 'Your seat is kept — you can rejoin',
              tone: 'danger', onClick: leave },
          ]} /> })}>Menu</button>
      </header>

      <nav className="phasebar" aria-label="Phases this round">
        {[...PHASES, ...(view.phasesThisRound.includes('reshuffle')
          ? [{ id: 'reshuffle', label: '⟳ Shuffle' }] : [])].map(p => {
          const included = view.phasesThisRound.includes(p.id);
          const active = phase === p.id;
          const done = included && !active && phase !== null &&
            view.phasesThisRound.indexOf(p.id) < view.phasesThisRound.indexOf(phase);
          const pickers = Object.entries(view.roundActions ?? {})
            .filter(([, a]) => ACTION_CARDS.find(x => x.id === a)?.phase === p.id)
            .map(([id]) => view.players.find((pl: any) => pl.id === id)?.name?.[0] ?? '?');
          return (
            <span key={p.id} className={`phase${included ? ' phase--on' : ''}` +
              `${active ? ' phase--now' : ''}${done ? ' phase--done' : ''}`}>
              {p.label}
              {pickers.length > 0 && <i className="phase__who">{pickers.join('')}</i>}
            </span>
          );
        })}
      </nav>

      {(view.waitingOn ?? []).length > 0 && (
        <p className="waiting">Waiting for {view.waitingOn.join(', ')}</p>
      )}
      {instruction && <p className="instruction">{instruction}</p>}
      {error && <p className="err" onClick={() => setError(null)}>{error}</p>}

      {(view.options ?? []).length > 0 && !pending && (
        <OptionList
          title={phase === 'produce' ? 'Produce'
            : phase === 'settle' ? 'Optional: discard a card for an advantage'
            : 'Spend your goods'}
          note={phase === 'produce'
            ? 'The rules place these goods for you — confirm so everyone can follow along.'
            : phase === 'settle'
              ? 'These cards leave your tableau permanently, and only help this phase.'
              : 'Consuming is compulsory in Race, but which good and which power is your call.'}
          options={view.options}
          onChoose={id => act('CHOOSE_OPTION', { optionId: id })}
          onAuto={phase === 'consume' ? () => act('AUTO_RESOLVE') : undefined} />
      )}

      {pending && (
        <section className="options">
          <h2 className="tight">{pending.label}</h2>
          <p className="muted tiny">
            Choose {pending.count} card{pending.count === 1 ? '' : 's'} from your hand below
            {pending.purpose === 'discardForVp' ? ' — each is worth a victory point.' : '.'}
          </p>
          <button className="primary" disabled={picked.length !== pending.count}
                  onClick={() => act('SUBMIT_SELECTION', { instanceIds: picked })}>
            Discard {picked.length}/{pending.count}
          </button>
        </section>
      )}

      {phase === 'reshuffle' && (
        <Reshuffle ready={iAmReady} discardCount={view.discardCount}
                   onReady={() => emit('ready', { code, phaseId: view.phaseId, ready: true })} />
      )}

      {choosing && (
        <ActionPrompt chosen={myAction}
          onChoose={id => act('SELECT_ACTION_CARD', { actionCard: id })}
          waitingOn={view.waitingOn ?? []} />
      )}

      {showOpponents ? (
        <section className="opponents">
          {opponents.map((p: any) => (
            <article key={p.id} className="opp">
              <header>
                <b>{p.name}</b>
                <span className={`dot${p.ready ? ' dot--ready' : ''}`} />
                {!p.connected && <span className="away">away</span>}
              </header>
              <div className="opp__stats">
                hand {p.handCount} · {p.score} vp · mil {p.stats?.military ?? 0} ·
                {p.tableau.length}/12 <GoodTally stats={p.stats} />
                {view.roundActions?.[p.id] &&
                  <span className="whotag">{String(view.roundActions[p.id])}</span>}
              </div>
              <div className="minirow">
                {p.tableau.length
                  ? p.tableau.map((t: any) => (
                      <GenericCard key={t.instanceId} face={face(t.defId)} size="mini"
                        goods={t.goods.length} goodKind={t.goods[0]?.kind}
                        onClick={() => { const f = face(t.defId); if (f) openCard(f); }} />
                    ))
                  : <span className="muted tiny">no cards yet</span>}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <button className="peek" onClick={() => setShowOpponents(true)}>
          Show opponents’ tableaux ({opponents.length} player{opponents.length === 1 ? '' : 's'})
        </button>
      )}

      <CardZone
        title="Your tableau"
        meta={<>{me?.tableau.length ?? 0}/12 <GoodTally stats={me?.stats} /></>}
        items={me?.tableau ?? []}
        sortKeys={sortKeys} resolve={faceOf}
        empty="Nothing played yet."
        render={(t: any) => (
          <GenericCard key={t.instanceId} face={face(t.defId)} goods={t.goods.length}
            goodKind={t.goods[0]?.kind}
            mood={phase === 'consume' && t.goods.length ? 'playable' : 'plain'}
            onClick={() => { const f = face(t.defId); if (f) openCard(f); }} />
        )} />

      {phase === 'explore' && view.selection.length > 0 && (
        <div className="highlightbox">
          <CardZone
            title="Drawn cards" accent dense
            meta={`keep ${picked.length}/${keepCount}`}
            items={view.selection}
            sortKeys={sortKeys} resolve={faceOf}
            render={(c: any) => (
              <GenericCard key={c.instanceId} face={face(c.defId)}
                mood={picked.includes(c.instanceId) ? 'selected' : 'playable'}
                onClick={() => toggle(c.instanceId, keepCount)} />
            )} />
          <div className="btnrow">
            <button className="primary"
                    disabled={picked.length !== Math.min(keepCount, view.selection.length)}
                    onClick={() => act('KEEP_CARDS', { instanceIds: picked })}>
              Keep {picked.length}/{keepCount}
            </button>
            <button onClick={() => { const f = face(view.selection[0]?.defId); if (f) openCard(f); }}>
              Read cards
            </button>
          </div>
        </div>
      )}

      <CardZone
        title="Your hand"
        meta={`${view.hand.length} card${view.hand.length === 1 ? '' : 's'}`}
        items={view.hand}
        sortKeys={sortKeys} resolve={faceOf}
        empty="Your hand is empty."
        render={(c: any) => {
          const p = view.playable[c.instanceId];
          return (
            <GenericCard key={c.instanceId} face={face(c.defId)} mood={moodOf(c.instanceId)}
              badge={p?.ok && p.cost !== undefined ? `pay ${p.cost}` : undefined}
              onClick={() => tapHandCard(c)} />
          );
        }} />

      <footer className="actionbar">
        {opening && (
          <button className="primary" disabled={picked.length !== 2}
                  onClick={() => act('DISCARD_CARDS', { instanceIds: picked })}>
            Discard {picked.length}/2
          </button>
        )}
        {paying && (
          <div className="payline">
            <span>Pick {paying.cost} card(s) to discard — {payment.length}/{paying.cost}</span>
            <button className="primary" disabled={payment.length !== paying.cost}
                    onClick={async () => { await act('PLAY_CARD',
                      { instanceId: paying.instanceId, payment }); setPaying(null); setPayment([]); }}>
              Confirm
            </button>
            <button onClick={() => { setPaying(null); setPayment([]); }}>Cancel</button>
          </div>
        )}
        {!opening && !paying && legal.includes('PASS') && (
          <button onClick={() => act('PASS')}>Pass</button>
        )}
        {!opening && !paying && legal.includes('READY') && !iAmReady && phase !== 'reshuffle' && (
          <button className="primary"
                  onClick={() => emit('ready', { code, phaseId: view.phaseId, ready: true })}>
            Continue
          </button>
        )}
        {iAmReady && phase !== null && legal.length === 0 &&
          <span className="muted">Done this phase — waiting for the others…</span>}
      </footer>
    </div>
  );
}
