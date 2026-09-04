/** Generic card-game platform types. Nothing here knows about any specific game. */

export type PlayerId = string;
export type CardDefId = string;
export type CardInstanceId = string;

/** A card as it exists in a game's data file. */
export interface CardDefinition {
  id: CardDefId;
  name: string;
  quantity: number;
  /** Free-form, game-interpreted. Core never reads inside this. */
  payload: Record<string, unknown>;
}

/** One physical copy of a definition. Core tracks only where it is and who owns it. */
export interface CardInstance {
  instanceId: CardInstanceId;
  defId: CardDefId;
  zone: string;
  owner: PlayerId | null;
  /** Zone-local grouping, e.g. a good sitting on a particular world instance. */
  attachedTo?: CardInstanceId;
  faceDown: boolean;
}

export interface Player {
  id: PlayerId;
  name: string;
  seat: number;
  connected: boolean;
  ready: boolean;
}

export type GameStatus = 'lobby' | 'playing' | 'finished';

export interface PhaseDefinition {
  id: string;
  label: string;
  mode: 'simultaneous' | 'turn-based' | 'hidden-simultaneous';
}

export interface GameState {
  version: number;
  status: GameStatus;
  round: number;
  /** Phases selected for this round, computed by the game each round. */
  phasesThisRound: string[];
  phaseIndex: number;
  /** Changes on every phase entry; stale actions are rejected against it. */
  phaseId: string;
  players: Player[];
  playerOrder: PlayerId[];
  cards: Record<CardInstanceId, CardInstance>;
  /** Hidden submissions for a hidden-simultaneous phase, revealed together. */
  hiddenChoices: Record<PlayerId, unknown>;
  revealedChoices: Record<PlayerId, unknown> | null;
  /** Game-owned scratch space. Core never interprets it. */
  gameData: Record<string, unknown>;
  log: string[];
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  state?: GameState;
}

export interface Rng {
  next(): number;
  shuffle<T>(items: T[]): T[];
  randomChoice<T>(items: T[]): T;
  sample<T>(items: T[], n: number): T[];
}

/** What a game plugin must provide. Core is configured entirely through this. */
export interface GameDefinition {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  cardDatabase: CardDefinition[];
  phases: PhaseDefinition[];
  setupGame(state: GameState, rng: Rng): GameState;
  /** Which phases run this round, given hidden choices. */
  selectPhasesForRound(state: GameState): string[];
  legalActions(state: GameState, playerId: PlayerId): string[];
  resolveAction(state: GameState, playerId: PlayerId, action: GameAction, rng: Rng): ActionResult;
  /** Called when a phase opens: deal explore cards, auto-resolve, etc. */
  onPhaseEnter?(state: GameState, phase: string, rng: Rng): GameState;
  onPhaseComplete(state: GameState, phase: string, rng: Rng): GameState;
  /** Per-card legality for the current phase, keyed by hand instance id. */
  playability?(state: GameState, playerId: PlayerId): Record<string, Playable>;
  calculateScore(state: GameState, playerId: PlayerId): number;
  /** Optional named components of the score, shown on the results screen. */
  scoreParts?(state: GameState, playerId: PlayerId): Record<string, number>;
  /** Live per-player numbers for the status panel (military, goods, ...). */
  playerStats?(state: GameState, playerId: PlayerId): Record<string, number | string>;
  /** Public label for a face-down token sitting on a card, e.g. a good's kind. */
  tokenKind?(state: GameState, hostInstanceId: string): string | null;
  /** A safe default move so an absent player never stalls the table. */
  autoAction?(state: GameState, playerId: PlayerId): GameAction | null;
  /** Seconds a phase may sit idle before absent players are moved along. */
  phaseTimeoutSeconds?: number;
  determineGameEnd(state: GameState): boolean;
  display: DisplayConfig;
}

export interface Playable {
  ok: boolean;
  reason?: string;
  /** Cards that must be discarded to pay for this one. */
  cost?: number;
}

export interface GameAction {
  type: string;
  phaseId: string;
  payload?: Record<string, unknown>;
}

/** Tells the generic renderer what to show without telling it what any of it means. */
export interface SortKey {
  id: string;
  label: string;
  /** Dotted path into the card payload, e.g. "world.defense". */
  path: string;
  direction?: 'asc' | 'desc';
}

export interface DisplayConfig {
  primaryStats: string[];
  badges: string[];
  /** Offered to the player as hand/deck sort options. */
  sortKeys?: SortKey[];
  /** cardPropertyValue -> symbol token, plus a text fallback per token. */
  symbolTokens: Record<string, string>;
  symbolFallbacks: Record<string, string>;
}
