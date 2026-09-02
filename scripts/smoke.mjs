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
  const aIds = new Set(A.latest.view.hand.map(c => c.instanceId));
  const bIds = B.latest.view.hand.map(c => c.instanceId);
  ok(!bIds.some(id => aIds.has(id)), 'hands are disjoint');
  ok(!JSON.stringify(A.latest.view).includes(bIds[0]),
     "A's payload contains no card from B's hand");

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

  const versionBefore = A.latest.view.version;
  const livePhase = A.latest.view.phaseId;
  await Promise.all([...Array(5)].map(() =>
    A.rpc('ready', { code, phaseId: livePhase, ready: true })));
  await Promise.all([...Array(5)].map(() =>
    B.rpc('ready', { code, phaseId: livePhase, ready: true })));
  await sleep(100);
  ok(A.latest.view.currentPhase === 'settle',
     `ten rapid Ready calls advanced exactly one phase (now ${A.latest.view.currentPhase})`);
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
  const C = await connect('carol');
  ok((await C.rpc('joinRoom', { code: second.code })).ok, 'a third client joined the second room');
  ok((await A.rpc('startGame', { code: second.code, seed: 1 })).ok, 'the second game also starts');

  A.close(); B.close(); C.close();
}

main()
  .catch(e => { console.error(e); failed = true; })
  .finally(async () => {
    server?.kill();
    await sleep(50);
    console.log(failed ? '\nSMOKE: FAIL' : '\nSMOKE: PASS');
    process.exit(failed ? 1 : 0);
  });
