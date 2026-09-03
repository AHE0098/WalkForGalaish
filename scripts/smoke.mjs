/**
 * End-to-end check driven by two real Socket.IO clients against the production
 * server. No browser required. Exits non-zero on the first failed assertion.
 */
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = process.env.SMOKE_PORT ?? 3111;
const URL = `http://localhost:${PORT}`;
let server, failed = false;

const ok = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${msg}`);
  if (!cond) failed = true;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(id) {
  const s = io(URL, { transports: ['websocket'] });
  s.playerId = id;
  s.latest = null;
  s.on('state', p => { s.latest = p; });
  s.rpc = (event, data) => new Promise(res =>
    s.emit(event, { playerId: id, name: id, ...data }, r => res(r ?? { ok: true })));
  return new Promise(res => s.on('connect', () => res(s)));
}

async function main() {
  server = spawn('node', ['dist/server/server/index.js'],
    { env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(res => server.stdout.on('data', d =>
    String(d).includes('listening') && res()));

  const A = await connect('alice');
  const B = await connect('bob');

  const created = await A.rpc('createRoom', { gameId: 'race-for-the-galaxy' });
  ok(created.ok && /^[A-Z2-9]{4}$/.test(created.code), `A created room ${created.code}`);
  const code = created.code;

  const joined = await B.rpc('joinRoom', { code });
  ok(joined.ok, 'B joined the room');

  const bad = await B.rpc('joinRoom', { code: 'ZZZZ' });
  ok(!bad.ok, `invalid room code rejected: "${bad.error}"`);

  await sleep(60);
  ok(A.latest?.room.players.length === 2, 'both clients see a two-player lobby');

  const notHost = await B.rpc('startGame', { code });
  ok(!notHost.ok, `non-host cannot start: "${notHost.error}"`);

  ok((await A.rpc('startGame', { code, seed: 4242 })).ok, 'host started the game');
  await sleep(80);

  ok(A.latest.view.hand.length === 6 && B.latest.view.hand.length === 6,
     'each client received a private six-card hand');
  ok(A.latest.view.info.openingDiscard === true, 'the game opens with the 6-choose-4 discard');
  const aIds = new Set(A.latest.view.hand.map(c => c.instanceId));
  const bIds = B.latest.view.hand.map(c => c.instanceId);
  ok(!bIds.some(id => aIds.has(id)), 'hands are disjoint');
  ok(!JSON.stringify(A.latest.view).includes(bIds[0]),
     "A's payload contains no card from B's hand");

  // Opening discard: two cards each, then the first round can begin.
  for (const C of [A, B]) {
    const two = C.latest.view.hand.slice(0, 2).map(c => c.instanceId);
    await C.rpc('action', { code, action:
      { type: 'DISCARD_CARDS', phaseId: C.latest.view.phaseId, payload: { instanceIds: two } } });
  }
  await sleep(80);
  ok(A.latest.view.hand.length === 4 && !A.latest.view.info.openingDiscard,
     'both players discarded down to four cards');
  ok(Object.keys(A.latest.view.playable).length === 4,
     'the client receives per-card legality for its hand');

  const phaseId = A.latest.view.phaseId;
  await A.rpc('action', { code, action:
    { type: 'SELECT_ACTION_CARD', phaseId, payload: { actionCard: 'develop' } } });
  await sleep(50);
  ok(A.latest.view.yourChoiceSubmitted === true, 'A submitted an action card');
  ok(B.latest.view.revealedChoices === null && B.latest.view.yourChoiceSubmitted === false,
     "B cannot see A's choice before revealing");

  const junk = await A.rpc('action', { code, action:
    { type: 'SELECT_ACTION_CARD', phaseId, payload: { actionCard: 'not-a-card' } } });
  ok(!junk.ok, `malformed action rejected: "${junk.error}"`);

  await B.rpc('action', { code, action:
    { type: 'SELECT_ACTION_CARD', phaseId, payload: { actionCard: 'settle' } } });
  await sleep(80);
  ok(A.latest.view.roundActions.alice === 'develop' && A.latest.view.roundActions.bob === 'settle',
     'both choices revealed and retained for the round');
  ok(JSON.stringify(A.latest.view.phasesThisRound) === '["develop","settle"]',
     `only chosen phases run: ${JSON.stringify(A.latest.view.phasesThisRound)}`);

  const stale = await A.rpc('action', { code, action:
    { type: 'PLAY_CARD', phaseId: 'stale', payload: {} } });
  ok(!stale.ok, `stale phaseId rejected: "${stale.error}"`);

  // Explore was not chosen this round, so Develop is first.
  ok(A.latest.view.currentPhase === 'develop', `first phase is ${A.latest.view.currentPhase}`);
  const legalA = Object.values(A.latest.view.playable);
  ok(legalA.every(p => typeof p.ok === 'boolean'), 'every hand card carries a legality verdict');
  ok(legalA.filter(p => !p.ok).every(p => !!p.reason), 'blocked cards explain why');

  const versionBefore = A.latest.view.version;
  const livePhase = A.latest.view.phaseId;
  await Promise.all([...Array(5)].map(() =>
    A.rpc('ready', { code, phaseId: livePhase, ready: true })));
  await Promise.all([...Array(5)].map(() =>
    B.rpc('ready', { code, phaseId: livePhase, ready: true })));
  await sleep(100);
  ok(A.latest.view.currentPhase === 'settle',
     `ten rapid Ready calls advanced exactly one phase (now ${A.latest.view.currentPhase})`);
  ok(typeof A.latest.view.info.vpPool === 'number' && A.latest.view.info.vpPool === 24,
     `victory point pool is ${A.latest.view.info.vpPool} for two players`);
  ok(A.latest.view.version > versionBefore, 'state version increased monotonically');

  const settlePhase = A.latest.view.phaseId;
  await A.rpc('ready', { code, phaseId: settlePhase, ready: true });
  await B.rpc('ready', { code, phaseId: settlePhase, ready: true });
  await sleep(100);
  ok(A.latest.view.round === 2, `round advanced to ${A.latest.view.round}`);
  ok(A.latest.view.currentPhase === null, 'new round waits on action selection');

  await A.rpc('leaveRoom', { code });
  const second = await A.rpc('createRoom', { gameId: 'race-for-the-galaxy' });
  ok(second.ok && second.code !== code, `a second room was created (${second.code})`);
  const C2 = await connect('carol');
  ok((await C2.rpc('joinRoom', { code: second.code })).ok, 'a third client joined the second room');
  ok((await A.rpc('startGame', { code: second.code, seed: 1 })).ok, 'the second game also starts');
  await sleep(80);
  for (const C of [A, C2]) {
    const two = C.latest.view.hand.slice(0, 2).map(c => c.instanceId);
    await C.rpc('action', { code: second.code, action:
      { type: 'DISCARD_CARDS', phaseId: C.latest.view.phaseId, payload: { instanceIds: two } } });
  }
  await sleep(60);
  for (const C of [A, C2])
    await C.rpc('action', { code: second.code, action: { type: 'SELECT_ACTION_CARD',
      phaseId: C.latest.view.phaseId, payload: { actionCard: 'explore-1-1' } } });
  await sleep(100);
  ok(A.latest.view.currentPhase === 'explore', 'explore phase opened');
  ok(A.latest.view.selection.length === 3, `drew ${A.latest.view.selection.length} cards to choose from`);
  ok(A.latest.view.info.keepCount === 2, `must keep ${A.latest.view.info.keepCount}`);
  const badKeep = await A.rpc('action', { code: second.code, action: { type: 'KEEP_CARDS',
    phaseId: A.latest.view.phaseId, payload: { instanceIds: [A.latest.view.selection[0].instanceId] } } });
  ok(!badKeep.ok, `keeping the wrong number is rejected: "${badKeep.error}"`);
  const handBefore = A.latest.view.hand.length;
  await A.rpc('action', { code: second.code, action: { type: 'KEEP_CARDS',
    phaseId: A.latest.view.phaseId,
    payload: { instanceIds: A.latest.view.selection.slice(0, 2).map(c => c.instanceId) } } });
  await sleep(80);
  ok(A.latest.view.hand.length === handBefore + 2, 'kept cards landed in hand');
  ok(A.latest.view.selection.length === 0, 'the rest were discarded');
  ok(typeof A.latest.view.discardCount === 'number' && A.latest.view.discardCount > 0,
     `graveyard tracked: ${A.latest.view.discardCount} cards`);
  ok(A.latest.view.players.every(p => p.scoreParts && 'card VP' in p.scoreParts),
     'each player carries a score breakdown');
  ok(A.latest.view.players.every(p => typeof p.stats?.military === 'number'),
     'military strength is reported for every player');
  ok(typeof A.latest.secondsLeft === 'number' && A.latest.secondsLeft > 0,
     `phase clock running: ${A.latest.secondsLeft}s left`);

  // A player who drops must not freeze the table: the server plays for them.
  const cards = await (await fetch(`${URL}/api/games/race-for-the-galaxy/cards`)).json();
  ok(Array.isArray(cards.cards) && cards.cards.length === 95,
     `card database served over HTTP (${cards.cards.length} definitions)`);
  ok(Array.isArray(cards.display?.sortKeys) && cards.display.sortKeys.length > 0,
     `deck browser sort keys published (${cards.display?.sortKeys?.length})`);

  // Leaving mid-game keeps the seat, and rejoining restores the same hand.
  const carolHand = JSON.stringify(C2.latest.view.hand.map(c => c.instanceId));
  await C2.rpc('leaveRoom', { code: second.code });
  await sleep(60);
  const stillSeated = A.latest.room.players.some(p => p.id === 'carol');
  ok(stillSeated, 'a player who leaves mid-game keeps their seat');
  const back = await C2.rpc('joinRoom', { code: second.code });
  await sleep(80);
  ok(back.ok, 'that player can walk straight back in');
  ok(JSON.stringify(C2.latest.view.hand.map(c => c.instanceId)) === carolHand,
     'their hand is exactly as they left it');

  A.close(); B.close(); C2.close();
}

main()
  .catch(e => { console.error(e); failed = true; })
  .finally(async () => {
    server?.kill();
    await sleep(50);
    console.log(failed ? '\nSMOKE: FAIL' : '\nSMOKE: PASS');
    process.exit(failed ? 1 : 0);
  });
