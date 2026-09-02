import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRng } from '../random.js';
import { buildInstances, draw, reshuffleDiscard, shuffleSupply, supplyCount } from '../deck.js';
import { ZONE, cardsIn, moveCard } from '../zones.js';
import { advancePhase, allReady, enterPhase, setReady, submitHiddenChoice, allChoicesIn, revealChoices } from '../phases.js';
import { serializeForPlayer } from '../serialize.js';
import { addPlayer, createMemoryRoomStore, generateRoomCode, RoomError } from '../rooms.js';
import { createAssetResolver } from '../assets.js';
import type { CardDefinition, GameDefinition, GameState, Player } from '../types.js';

const defs: CardDefinition[] = [
  { id: 'alpha', name: 'Alpha', quantity: 2, payload: {} },
  { id: 'beta',  name: 'Beta',  quantity: 3, payload: {} },
  { id: 'gamma', name: 'Gamma', quantity: 1, payload: {} },
];
const players: Player[] = [
  { id: 'p1', name: 'One', seat: 0, connected: true, ready: false },
  { id: 'p2', name: 'Two', seat: 1, connected: true, ready: false },
];
const baseState = (): GameState => ({
  version: 0, status: 'playing', round: 1, phasesThisRound: ['a', 'b'], phaseIndex: 0,
  phaseId: 'ph-1', players: players.map(p => ({ ...p })), playerOrder: ['p1', 'p2'],
  cards: buildInstances(defs), hiddenChoices: {}, revealedChoices: null, gameData: {}, log: [],
});
const stubDef = {
  onPhaseComplete: (s: GameState) => s,
  determineGameEnd: () => false,
  calculateScore: () => 7,
} as unknown as GameDefinition;

describe('deck', () => {
  it('expands quantities into unique instances', () => {
    const inst = buildInstances(defs);
    expect(Object.keys(inst)).toHaveLength(6);
    expect(inst['alpha#001']).toBeTruthy();
    expect(inst['beta#003']).toBeTruthy();
    expect(new Set(Object.keys(inst)).size).toBe(6);
  });

  it('rejects a bad quantity', () => {
    expect(() => buildInstances([{ id: 'x', name: 'X', quantity: 0, payload: {} }])).toThrow();
  });

  it('shuffles reproducibly for a given seed', () => {
    const a = shuffleSupply(baseState(), createRng(42)).gameData.supplyOrder;
    const b = shuffleSupply(baseState(), createRng(42)).gameData.supplyOrder;
    const c = shuffleSupply(baseState(), createRng(43)).gameData.supplyOrder;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('draws from the supply and reshuffles the discard when it runs out', () => {
    let s = shuffleSupply(baseState(), createRng(1));
    const first = draw(s, 6, createRng(1));
    expect(first.drawn).toHaveLength(6);
    expect(supplyCount(first.state)).toBe(0);
    let t = first.state;
    for (const id of first.drawn) t = moveCard(t, id, ZONE.discard, { owner: null });
    const again = draw(t, 2, createRng(2));
    expect(again.drawn).toHaveLength(2);
  });
});

describe('zones', () => {
  it('moves a card and updates ownership', () => {
    const s = moveCard(baseState(), 'alpha#001', ZONE.hand, { owner: 'p1' });
    expect(cardsIn(s, ZONE.hand, 'p1')).toHaveLength(1);
    expect(cardsIn(s, ZONE.supply)).toHaveLength(5);
  });

  it('rejects a move when the owner does not match', () => {
    const s = moveCard(baseState(), 'alpha#001', ZONE.hand, { owner: 'p1' });
    expect(() => moveCard(s, 'alpha#001', ZONE.discard, { expectOwner: 'p2' })).toThrow();
  });

  it('rejects a move from the wrong zone', () => {
    expect(() => moveCard(baseState(), 'alpha#001', ZONE.discard, { expectFromZone: ZONE.hand }))
      .toThrow();
  });
});

describe('phases and ready', () => {
  it('gates on all players being ready', () => {
    let s = baseState();
    s = setReady(s, 'p1', true);
    expect(allReady(s)).toBe(false);
    s = setReady(s, 'p2', true);
    expect(allReady(s)).toBe(true);
  });

  it('advances exactly once however many times it is called', () => {
    let s = enterPhase(baseState(), 0);
    const phaseId = s.phaseId;
    s = setReady(setReady(s, 'p1', true), 'p2', true);
    let after = advancePhase(s, stubDef, createRng(1), phaseId);
    const indexAfterFirst = after.phaseIndex;
    for (let i = 0; i < 9; i++) after = advancePhase(after, stubDef, createRng(1), phaseId);
    expect(after.phaseIndex).toBe(indexAfterFirst);
    expect(indexAfterFirst).toBe(1);
  });

  it('resets readiness on entering a phase', () => {
    let s = setReady(baseState(), 'p1', true);
    s = enterPhase(s, 1);
    expect(s.players.every(p => !p.ready)).toBe(true);
  });

  it('increments the version on every mutation', () => {
    const s = baseState();
    expect(setReady(s, 'p1', true).version).toBe(s.version + 1);
  });

  it('keeps hidden choices hidden until everyone has submitted', () => {
    let s = submitHiddenChoice(baseState(), 'p1', 'develop');
    expect(allChoicesIn(s)).toBe(false);
    expect(s.revealedChoices).toBeNull();
    s = submitHiddenChoice(s, 'p2', 'settle');
    expect(allChoicesIn(s)).toBe(true);
    s = revealChoices(s);
    expect(s.revealedChoices).toEqual({ p1: 'develop', p2: 'settle' });
  });
});

describe('private state serialization', () => {
  it('never leaks another player\'s hand or the identity of a good', () => {
    let s = baseState();
    s = moveCard(s, 'alpha#001', ZONE.hand, { owner: 'p1' });
    s = moveCard(s, 'beta#001', ZONE.hand, { owner: 'p2' });
    s = moveCard(s, 'beta#002', ZONE.tableau, { owner: 'p2', faceDown: false });
    s = moveCard(s, 'gamma#001', ZONE.goods, { owner: 'p2', attachedTo: 'beta#002', faceDown: true });

    const view = serializeForPlayer(s, stubDef, 'p1');
    const json = JSON.stringify(view);
    expect(view.hand.map(c => c.instanceId)).toEqual(['alpha#001']);
    expect(json).not.toContain('beta#001');          // opponent hand contents
    expect(json).not.toContain('gamma');              // the good's identity is never sent
    const opp = view.players.find(p => p.id === 'p2')!;
    expect(opp.handCount).toBe(1);
    expect(opp.tableau[0]!.goods).toHaveLength(1);   // the good is visible as a presence only
  });
});

describe('rooms', () => {
  it('generates distinct codes and stores rooms', () => {
    const store = createMemoryRoomStore();
    const code = generateRoomCode(c => !!store.get(c));
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    store.create({ code, gameId: 'g', hostId: 'p1', players: [], state: null, createdAt: 0 });
    expect(store.get(code.toLowerCase())).toBeTruthy();
  });

  it('enforces the player limit and tolerates duplicate joins', () => {
    let room = { code: 'AAAA', gameId: 'g', hostId: 'p1', players: [], state: null, createdAt: 0 } as any;
    room = addPlayer(room, players[0]!, 2);
    room = addPlayer(room, players[1]!, 2);
    expect(room.players).toHaveLength(2);
    room = addPlayer(room, players[0]!, 2);           // duplicate join is idempotent
    expect(room.players).toHaveLength(2);
    expect(() => addPlayer(room, { ...players[0]!, id: 'p3' }, 2)).toThrow(RoomError);
  });
});

describe('asset resolver', () => {
  const pack = { packId: 'test', name: 'Test', renderMode: 'hybrid' as const,
                 overrides: { cards: { 'odd-card': 'cards/renamed.webp' } } };
  const index = new Set(['cards/gem-world.webp', 'cards/renamed.webp', 'cards/typo_world.png']);

  it('resolves by convention and returns null when absent', () => {
    const r = createAssetResolver({ pack, index });
    expect(r.cardImage('gem-world')).toContain('/assets/packs/test/cards/gem-world.webp');
    expect(r.cardImage('missing-world')).toBeNull();
  });

  it('lets an override win over the convention', () => {
    const r = createAssetResolver({ pack, index });
    expect(r.cardImage('odd-card')).toContain('renamed.webp');
  });

  it('applies a base URL', () => {
    const r = createAssetResolver({ pack, index, baseUrl: 'https://cdn.example.com/' });
    expect(r.cardImage('gem-world')).toMatch(/^https:\/\/cdn\.example\.com\//);
  });

  it('flags orphan files that match no cardId', () => {
    const r = createAssetResolver({ pack, index });
    expect(r.orphans(['gem-world'])).toContain('cards/typo_world.png');
  });
});

describe('layering', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : [];
    });

  it('core never imports from games', () => {
    const offenders = walk(join(process.cwd(), 'src/core'))
      .filter(f => /from\s+['"][^'"]*games\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
