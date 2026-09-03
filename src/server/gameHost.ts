import type { GameAction, GameState, Player, PlayerId, Rng } from '../core/types.js';
import { createRng } from '../core/random.js';
import {
  advancePhase, allChoicesIn, allReady, enterPhase, newPhaseId, revealChoices, setReady,
} from '../core/phases.js';
import { serializeForPlayer } from '../core/serialize.js';
import { raceForTheGalaxy } from '../games/race-for-the-galaxy/definition.js';

export const GAMES = { 'race-for-the-galaxy': raceForTheGalaxy };
export type GameId = keyof typeof GAMES;

const AUTO_READY = new Set(['PLAY_CARD', 'PASS', 'KEEP_CARDS']);

function nameOf(state: GameState, pid: PlayerId): string {
  return state.players.find(p => p.id === pid)?.name ?? pid;
}

export function emptyState(players: Player[]): GameState {
  return {
    version: 0, status: 'lobby', round: 0, phasesThisRound: [], phaseIndex: -1,
    phaseId: newPhaseId('lobby'), players, playerOrder: players.map(p => p.id),
    cards: {}, hiddenChoices: {}, revealedChoices: null, gameData: {}, log: [],
  };
}

/**
 * Drives one room's game. Every mutation goes through here so the version
 * number and the phase machine stay consistent.
 */
/** Grace period before an absent player's move is played for them. */
const AWAY_GRACE_MS = 6000;

export class GameHost {
  private rng: Rng;
  /** When the current phase stops waiting for absent players. */
  deadlineAt = 0;
  private awaySince = new Map<PlayerId, number>();

  constructor(public state: GameState, public gameId: GameId, seed?: number) {
    this.rng = createRng(seed);
  }
  private get def() { return GAMES[this.gameId]; }

  start(): void {
    this.state = this.def.setupGame(this.state, this.rng);
    this.state = { ...this.state, phasesThisRound: [], phaseIndex: -1, phaseId: newPhaseId('action') };
    this.resetClock();
  }

  private resetClock(): void {
    const secs = this.def.phaseTimeoutSeconds ?? 120;
    this.deadlineAt = Date.now() + secs * 1000;
  }

  setConnected(playerId: PlayerId, connected: boolean): void {
    this.state = { ...this.state,
      players: this.state.players.map(p => p.id === playerId ? { ...p, connected } : p) };
    if (connected) this.awaySince.delete(playerId);
    else this.awaySince.set(playerId, Date.now());
  }

  /** True when a player still owes the table a move in the current step. */
  private owesMove(playerId: PlayerId): boolean {
    if (this.state.status !== 'playing') return false;
    if (this.state.phaseIndex < 0 && !this.state.gameData.openingDiscard)
      return this.state.hiddenChoices[playerId] === undefined;
    if (this.state.gameData.openingDiscard)
      return !((this.state.gameData.openingDone as Record<string, boolean>) ?? {})[playerId];
    return !this.state.players.find(p => p.id === playerId)?.ready;
  }

  /** Plays a safe default for one player so the table is never stuck. */
  private playFor(playerId: PlayerId, why: string): boolean {
    if (!this.owesMove(playerId)) return false;
    const action = this.def.autoAction?.(this.state, playerId) ?? null;
    const before = this.state.version;
    if (action) this.submit(playerId, action);
    else this.ready(playerId, this.state.phaseId, true);
    if (this.state.version !== before)
      this.state = { ...this.state,
        log: [...this.state.log, `${nameOf(this.state, playerId)} auto-played (${why}).`] };
    return true;
  }

  /**
   * Called on a timer. Absent players are moved along after a short grace period;
   * everyone is moved along once the phase clock expires. Returns true if anything
   * changed and clients need a fresh view.
   */
  tick(now = Date.now()): boolean {
    if (this.state.status !== 'playing') return false;
    let changed = false;

    for (const p of this.state.players) {
      const since = this.awaySince.get(p.id);
      if (!p.connected && since !== undefined && now - since > AWAY_GRACE_MS)
        changed = this.playFor(p.id, 'disconnected') || changed;
    }
    if (now > this.deadlineAt) {
      for (const p of this.state.players)
        changed = this.playFor(p.id, 'timed out') || changed;
      this.resetClock();
    }
    return changed;
  }

  submit(playerId: PlayerId, action: GameAction): { ok: boolean; error?: string } {
    const r = this.def.resolveAction(this.state, playerId, action, this.rng);
    if (!r.ok || !r.state) return { ok: false, error: r.error };
    this.state = r.state;
    // Acting is consent: a player who has played, passed or kept is ready.
    if (AUTO_READY.has(action.type) && this.state.phaseIndex >= 0)
      return this.ready(playerId, this.state.phaseId, true), { ok: true };
    this.maybeReveal();
    return { ok: true };
  }

  ready(playerId: PlayerId, phaseId: string, ready: boolean): { ok: boolean; error?: string } {
    if (phaseId !== this.state.phaseId) return { ok: false, error: 'That action is out of date.' };
    this.state = setReady(this.state, playerId, ready);
    if (allReady(this.state)) {
      // advancePhase is guarded by phaseId, so repeated calls cannot double-advance.
      this.state = advancePhase(this.state, this.def, this.rng, phaseId);
      this.resetClock();
    }
    return { ok: true };
  }

  /** In the hidden action phase, reveal once everyone has chosen, then open the round. */
  private maybeReveal(): void {
    if (this.state.phaseIndex >= 0) return;
    if (!allChoicesIn(this.state)) return;
    this.state = revealChoices(this.state);
    const phases = this.def.selectPhasesForRound(this.state);
    // enterPhase clears revealedChoices, so keep the round's choices in gameData:
    // the per-phase bonuses belong to whoever selected that phase.
    this.state = {
      ...this.state, phasesThisRound: phases,
      gameData: { ...this.state.gameData, roundActions: { ...this.state.revealedChoices } },
    };
    this.state = phases.length ? enterPhase(this.state, 0, this.def, this.rng)
                               : advancePhase(this.state, this.def, this.rng, this.state.phaseId);
    this.resetClock();
  }

  view(playerId: PlayerId) { return serializeForPlayer(this.state, this.def, playerId); }
  secondsLeft(): number { return Math.max(0, Math.round((this.deadlineAt - Date.now()) / 1000)); }
}
