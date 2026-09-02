import type { GameDefinition, GameState, PlayerId, Playable } from './types.js';
import { ZONE } from './zones.js';
import { supplyCount, discardCount } from './deck.js';

export interface TableauEntry {
  instanceId: string;
  defId: string;
  /** Face-down goods: a count and their public kind, never the card underneath. */
  goods: Array<{ goodId: string }>;
}

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
    handCount: number; score: number; scoreParts: Record<string, number>;
    tableau: TableauEntry[];
  }>;
  hand: Array<{ instanceId: string; defId: string }>;
  selection: Array<{ instanceId: string; defId: string }>;
  /** Per-hand-card legality for the phase in play, so the UI can highlight. */
  playable: Record<string, Playable>;
  legalActions: string[];
  yourChoiceSubmitted: boolean;
  revealedChoices: Record<PlayerId, unknown> | null;
  roundActions: Record<PlayerId, unknown>;
  /** Free-form public numbers the game wants shown (VP pool, keep count, ...). */
  info: Record<string, unknown>;
  log: string[];
}

export function serializeForPlayer(
  state: GameState, def: GameDefinition, viewer: PlayerId,
): PlayerView {
  const all = Object.values(state.cards);
  const tableauOf = (pid: PlayerId): TableauEntry[] =>
    all.filter(c => c.zone === ZONE.tableau && c.owner === pid).map(c => ({
      instanceId: c.instanceId,
      defId: c.defId,
      // Instance ids embed the definition id, so face-down goods get opaque handles.
      goods: all.filter(g => g.zone === ZONE.goods && g.attachedTo === c.instanceId)
                .map((_g, i) => ({ goodId: `${c.instanceId}/g${i}` })),
    }));

  const playing = state.status !== 'lobby';

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
      score: playing ? def.calculateScore(state, p.id) : 0,
      scoreParts: playing && def.scoreParts ? def.scoreParts(state, p.id) : {},
      tableau: tableauOf(p.id),
    })),
    hand: all.filter(c => c.zone === ZONE.hand && c.owner === viewer)
             .map(c => ({ instanceId: c.instanceId, defId: c.defId })),
    selection: all.filter(c => c.zone === ZONE.selection && c.owner === viewer)
                  .map(c => ({ instanceId: c.instanceId, defId: c.defId })),
    playable: playing && def.playability ? def.playability(state, viewer) : {},
    legalActions: playing ? def.legalActions(state, viewer) : [],
    yourChoiceSubmitted: state.hiddenChoices[viewer] !== undefined,
    revealedChoices: state.revealedChoices,
    roundActions: (state.gameData.roundActions as Record<PlayerId, unknown>) ?? {},
    info: publicInfo(state, viewer),
    log: state.log.slice(-40),
  };
}

/** Game-owned public numbers. Anything secret stays out of gameData or out of here. */
function publicInfo(state: GameState, viewer: PlayerId): Record<string, unknown> {
  const g = state.gameData;
  return {
    vpPool: g.vpPool ?? null,
    vpChips: (g.vpChips as Record<string, number>) ?? {},
    openingDiscard: g.openingDiscard ?? false,
    keepCount: (g.keepCounts as Record<string, number> | undefined)?.[viewer] ?? null,
  };
}
