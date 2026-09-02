import type { CardInstance, GameDefinition, GameState, PlayerId } from './types.js';
import { ZONE } from './zones.js';
import { supplyCount, discardCount } from './deck.js';

export interface PlayerView {
  version: number;
  status: GameState['status'];
  round: number;
  phasesThisRound: string[];
  currentPhase: string | null;
  phaseId: string;
  you: PlayerId;
  supplyCount: number;
  discardCount: number;
  players: Array<{
    id: PlayerId; name: string; seat: number; connected: boolean; ready: boolean;
    handCount: number; score: number;
    tableau: Array<{ instanceId: string; defId: string; goods: Array<{ goodId: string }> }>;
  }>;
  hand: Array<{ instanceId: string; defId: string }>;
  selection: Array<{ instanceId: string; defId: string }>;
  yourChoiceSubmitted: boolean;
  revealedChoices: Record<PlayerId, unknown> | null;
  /** Who chose which action this round; drives the per-phase bonuses. */
  roundActions: Record<PlayerId, unknown>;
  log: string[];
}

/**
 * Build the view for one player. Anything that player must not know is omitted
 * here, on the server, rather than hidden in the client.
 */
export function serializeForPlayer(
  state: GameState, def: GameDefinition, viewer: PlayerId,
): PlayerView {
  const all = Object.values(state.cards);
  const tableauOf = (pid: PlayerId) =>
    all.filter(c => c.zone === ZONE.tableau && c.owner === pid).map(c => ({
      instanceId: c.instanceId,
      defId: c.defId,
      // Goods are face down. Instance ids embed the definition id, so sending one
      // would reveal the card underneath. Emit a stable opaque handle instead.
      goods: all.filter(g => g.zone === ZONE.goods && g.attachedTo === c.instanceId)
                .map((_g, i) => ({ goodId: `${c.instanceId}/g${i}` })),
    }));

  const own = (c: CardInstance) => c.owner === viewer;

  return {
    version: state.version,
    status: state.status,
    round: state.round,
    phasesThisRound: state.phasesThisRound,
    currentPhase: state.phasesThisRound[state.phaseIndex] ?? null,
    phaseId: state.phaseId,
    you: viewer,
    supplyCount: supplyCount(state),
    discardCount: discardCount(state),
    players: state.players.map(p => ({
      id: p.id, name: p.name, seat: p.seat, connected: p.connected, ready: p.ready,
      handCount: all.filter(c => c.zone === ZONE.hand && c.owner === p.id).length,
      score: state.status === 'lobby' ? 0 : def.calculateScore(state, p.id),
      tableau: tableauOf(p.id),
    })),
    hand: all.filter(c => c.zone === ZONE.hand && own(c))
             .map(c => ({ instanceId: c.instanceId, defId: c.defId })),
    selection: all.filter(c => c.zone === ZONE.selection && own(c))
                  .map(c => ({ instanceId: c.instanceId, defId: c.defId })),
    yourChoiceSubmitted: state.hiddenChoices[viewer] !== undefined,
    revealedChoices: state.revealedChoices,
    roundActions: (state.gameData.roundActions as Record<PlayerId, unknown>) ?? {},
    log: state.log.slice(-25),
  };
}
