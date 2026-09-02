import type { GameState, Player } from './types.js';

export interface Room {
  code: string;
  gameId: string;
  hostId: string;
  players: Player[];
  state: GameState | null;
  createdAt: number;
}

/** Swap this implementation for Redis later without touching the engine. */
export interface RoomStore {
  create(room: Room): Room;
  get(code: string): Room | undefined;
  update(code: string, fn: (r: Room) => Room): Room | undefined;
  delete(code: string): void;
  list(): Room[];
}

export function createMemoryRoomStore(): RoomStore {
  const rooms = new Map<string, Room>();
  return {
    create(room) { rooms.set(room.code, room); return room; },
    get(code) { return rooms.get(code.toUpperCase()); },
    update(code, fn) {
      const r = rooms.get(code.toUpperCase());
      if (!r) return undefined;
      const next = fn(r); rooms.set(next.code, next); return next;
    },
    delete(code) { rooms.delete(code.toUpperCase()); },
    list() { return [...rooms.values()]; },
  };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

export function generateRoomCode(taken: (c: string) => boolean): string {
  for (let attempt = 0; attempt < 500; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++)
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!taken(code)) return code;
  }
  throw new Error('could not allocate a room code');
}

export class RoomError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function addPlayer(room: Room, player: Player, maxPlayers: number): Room {
  if (room.players.some(p => p.id === player.id))
    return { ...room, players: room.players.map(p => p.id === player.id ? { ...p, connected: true } : p) };
  if (room.state && room.state.status !== 'lobby')
    throw new RoomError('GAME_STARTED', 'That game has already started.');
  if (room.players.length >= maxPlayers)
    throw new RoomError('ROOM_FULL', 'That room is full.');
  return { ...room, players: [...room.players, { ...player, seat: room.players.length }] };
}
