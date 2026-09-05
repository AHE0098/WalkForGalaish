import type { GameState, PlayerId } from './types.js';

/**
 * Something worth showing the table. Games emit these; the client turns them
 * into a moment on screen. Structured rather than a sentence, so the UI can
 * draw a card, a good or a player colour instead of parsing text.
 */
export interface GameEvent {
  id: number;
  /** Chosen by the game. The client styles and narrates by type. */
  type: string;
  who?: PlayerId;
  whoName?: string;
  /** Short factual description. Flavour is added by the client. */
  text: string;
  cardId?: string;
  kind?: string;
  value?: number;
}

const KEEP = 40;

/** Append an event and keep the tail bounded. */
export function emit(
  state: GameState, ev: Omit<GameEvent, 'id' | 'whoName'>,
): GameState {
  const events = (state.events ?? []);
  const id = (events[events.length - 1]?.id ?? 0) + 1;
  const whoName = ev.who ? state.players.find(p => p.id === ev.who)?.name : undefined;
  return {
    ...state,
    events: [...events, { ...ev, id, whoName }].slice(-KEEP),
    // The log stays as the plain-text record behind the status sheet.
    log: [...state.log, whoName ? `${whoName} ${ev.text}` : ev.text],
  };
}

export function eventsSince(state: GameState, id: number): GameEvent[] {
  return (state.events ?? []).filter(e => e.id > id);
}
