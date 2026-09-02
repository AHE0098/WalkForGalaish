import type { GameDefinition, GameState, PlayerId, Rng } from './types.js';

let phaseCounter = 0;
export function newPhaseId(prefix = 'p'): string {
  phaseCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${phaseCounter}`;
}

export function bump(state: GameState): GameState {
  return { ...state, version: state.version + 1 };
}

export function currentPhase(state: GameState): string | null {
  return state.phasesThisRound[state.phaseIndex] ?? null;
}

export function requiredPlayers(state: GameState): PlayerId[] {
  return state.players.filter(p => p.connected || true).map(p => p.id);
}

export function allReady(state: GameState): boolean {
  const need = requiredPlayers(state);
  return need.length > 0 && need.every(id => state.players.find(p => p.id === id)?.ready);
}

export function setReady(state: GameState, playerId: PlayerId, ready: boolean): GameState {
  return bump({
    ...state,
    players: state.players.map(p => (p.id === playerId ? { ...p, ready } : p)),
  });
}

export function clearReady(state: GameState): GameState {
  return { ...state, players: state.players.map(p => ({ ...p, ready: false })) };
}

export function enterPhase(
  state: GameState, index: number, def?: GameDefinition, rng?: Rng,
): GameState {
  let next = clearReady({
    ...state, phaseIndex: index, phaseId: newPhaseId(state.phasesThisRound[index] ?? 'phase'),
    hiddenChoices: {}, revealedChoices: null,
  });
  const phase = next.phasesThisRound[index];
  if (def?.onPhaseEnter && phase && rng) next = def.onPhaseEnter(next, phase, rng);
  return bump(next);
}

/**
 * Advance exactly once. Callers may fire this repeatedly (rapid Ready clicks);
 * the phaseId guard makes every call after the first a no-op.
 */
export function advancePhase(
  state: GameState, def: GameDefinition, rng: Rng, expectedPhaseId: string,
): GameState {
  if (state.phaseId !== expectedPhaseId) return state; // stale: already advanced
  const phase = currentPhase(state);
  let next = phase ? def.onPhaseComplete(state, phase, rng) : state;

  if (next.phaseIndex + 1 < next.phasesThisRound.length)
    return enterPhase(next, next.phaseIndex + 1, def, rng);

  if (def.determineGameEnd(next))
    return bump({ ...next, status: 'finished', log: [...next.log, 'game over'] });

  next = { ...next, round: next.round + 1, log: [...next.log, `round ${next.round + 1}`] };
  next = { ...next, phasesThisRound: [], phaseIndex: -1, phaseId: newPhaseId('select'),
           hiddenChoices: {}, revealedChoices: null };
  return bump(clearReady(next));
}

/** Hidden simultaneous selection: choices stay private until everyone has submitted. */
export function submitHiddenChoice(state: GameState, playerId: PlayerId, choice: unknown): GameState {
  if (state.revealedChoices) return state; // already resolved
  return bump({ ...state, hiddenChoices: { ...state.hiddenChoices, [playerId]: choice } });
}

export function allChoicesIn(state: GameState): boolean {
  return state.players.every(p => state.hiddenChoices[p.id] !== undefined);
}

export function revealChoices(state: GameState): GameState {
  if (state.revealedChoices) return state;
  return bump({ ...state, revealedChoices: { ...state.hiddenChoices } });
}
