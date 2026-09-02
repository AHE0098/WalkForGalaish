import type { GameAction, GameState, Player, PlayerId, Rng } from '../core/types.js';
import { createRng } from '../core/random.js';
import {
  advancePhase, allChoicesIn, allReady, enterPhase, newPhaseId, revealChoices, setReady,
} from '../core/phases.js';
import { serializeForPlayer } from '../core/serialize.js';
import { raceForTheGalaxy } from '../games/race-for-the-galaxy/definition.js';

export const GAMES = { 'race-for-the-galaxy': raceForTheGalaxy };
export type GameId = keyof typeof GAMES;

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
export class GameHost {
  private rng: Rng;
  constructor(public state: GameState, public gameId: GameId, seed?: number) {
    this.rng = createRng(seed);
  }
  private get def() { return GAMES[this.gameId]; }

  start(): void {
    this.state = this.def.setupGame(this.state, this.rng);
    this.state = { ...this.state, phasesThisRound: [], phaseIndex: -1, phaseId: newPhaseId('action') };
  }

  submit(playerId: PlayerId, action: GameAction): { ok: boolean; error?: string } {
    const r = this.def.resolveAction(this.state, playerId, action, this.rng);
    if (!r.ok || !r.state) return { ok: false, error: r.error };
    this.state = r.state;
    this.maybeReveal();
    return { ok: true };
  }

  ready(playerId: PlayerId, phaseId: string, ready: boolean): { ok: boolean; error?: string } {
    if (phaseId !== this.state.phaseId) return { ok: false, error: 'That action is out of date.' };
    this.state = setReady(this.state, playerId, ready);
    if (allReady(this.state)) {
      // advancePhase is guarded by phaseId, so repeated calls cannot double-advance.
      this.state = advancePhase(this.state, this.def, this.rng, phaseId);
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
    this.state = phases.length ? enterPhase(this.state, 0)
                               : advancePhase(this.state, this.def, this.rng, this.state.phaseId);
  }

  view(playerId: PlayerId) { return serializeForPlayer(this.state, this.def, playerId); }
}
