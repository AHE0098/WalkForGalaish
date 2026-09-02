import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameHost, GAMES, emptyState, type GameId } from './gameHost.js';
import {
  addPlayer, createMemoryRoomStore, generateRoomCode, RoomError, type Room,
} from '../core/rooms.js';

const app = express();
const http = createServer(app);
const io = new Server(http);
const rooms = createMemoryRoomStore();
const hosts = new Map<string, GameHost>();

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/games', (_req, res) =>
  res.json(Object.values(GAMES).map(g =>
    ({ id: g.id, name: g.name, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers }))));

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html'))); // SPA fallback

function broadcast(code: string): void {
  const room = rooms.get(code);
  const host = hosts.get(code);
  if (!room) return;
  for (const p of room.players) {
    const payload = host
      ? { room: publicRoom(room), view: host.view(p.id) }
      : { room: publicRoom(room), view: null };
    io.to(`${code}:${p.id}`).emit('state', payload);
  }
}

function publicRoom(room: Room) {
  return {
    code: room.code, gameId: room.gameId, hostId: room.hostId,
    players: room.players.map(p =>
      ({ id: p.id, name: p.name, seat: p.seat, connected: p.connected, ready: p.ready })),
    started: !!hosts.get(room.code),
  };
}

io.on('connection', socket => {
  let joined: { code: string; playerId: string } | null = null;
  const fail = (cb: unknown, error: string) =>
    typeof cb === 'function' && (cb as (r: unknown) => void)({ ok: false, error });

  socket.on('createRoom', ({ playerId, name, gameId }, cb) => {
    const gid = (gameId ?? 'race-for-the-galaxy') as GameId;
    if (!GAMES[gid]) return fail(cb, 'Unknown game.');
    const code = generateRoomCode(c => !!rooms.get(c));
    const room = rooms.create({
      code, gameId: gid, hostId: playerId, createdAt: Date.now(), state: null,
      players: [{ id: playerId, name: name || 'Player 1', seat: 0, connected: true, ready: false }],
    });
    joined = { code, playerId };
    socket.join(`${code}:${playerId}`);
    cb?.({ ok: true, code });
    broadcast(code);
  });

  socket.on('joinRoom', ({ code, playerId, name }, cb) => {
    const room = rooms.get(String(code ?? '').toUpperCase());
    if (!room) return fail(cb, 'No room with that code.');
    const def = GAMES[room.gameId as GameId];
    try {
      const updated = rooms.update(room.code, r => addPlayer(r,
        { id: playerId, name: name || `Player ${r.players.length + 1}`, seat: r.players.length,
          connected: true, ready: false }, def.maxPlayers))!;
      joined = { code: updated.code, playerId };
      socket.join(`${updated.code}:${playerId}`);
      cb?.({ ok: true, code: updated.code });
      broadcast(updated.code);
    } catch (e) {
      return fail(cb, e instanceof RoomError ? e.message : 'Could not join that room.');
    }
  });

  socket.on('startGame', ({ code, playerId, seed }, cb) => {
    const room = rooms.get(code);
    if (!room) return fail(cb, 'No room with that code.');
    if (room.hostId !== playerId) return fail(cb, 'Only the host can start the game.');
    if (hosts.get(room.code)) return fail(cb, 'That game has already started.');
    const def = GAMES[room.gameId as GameId];
    if (room.players.length < def.minPlayers)
      return fail(cb, `${def.name} needs at least ${def.minPlayers} players.`);
    const host = new GameHost(emptyState(room.players), room.gameId as GameId, seed);
    host.start();
    hosts.set(room.code, host);
    cb?.({ ok: true });
    broadcast(room.code);
  });

  socket.on('action', ({ code, playerId, action }, cb) => {
    const host = hosts.get(code);
    if (!host) return fail(cb, 'That game is not running.');
    const r = host.submit(playerId, action);
    cb?.(r);
    broadcast(code);
  });

  socket.on('ready', ({ code, playerId, phaseId, ready }, cb) => {
    const host = hosts.get(code);
    if (!host) return fail(cb, 'That game is not running.');
    const r = host.ready(playerId, phaseId, ready !== false);
    cb?.(r);
    broadcast(code);
  });

  socket.on('leaveRoom', ({ code, playerId }, cb) => {
    const room = rooms.get(code);
    if (room) {
      rooms.update(code, r => ({ ...r, players: r.players.filter(p => p.id !== playerId) }));
      const after = rooms.get(code);
      if (after && after.players.length === 0) { rooms.delete(code); hosts.delete(code); }
      else broadcast(code);
    }
    joined = null;
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    if (!joined) return;
    rooms.update(joined.code, r => ({
      ...r, players: r.players.map(p => p.id === joined!.playerId ? { ...p, connected: false } : p),
    }));
    broadcast(joined.code);
  });
});

const PORT = Number(process.env.PORT ?? 3000);
http.listen(PORT, '0.0.0.0', () => console.log(`listening on 0.0.0.0:${PORT}`));
