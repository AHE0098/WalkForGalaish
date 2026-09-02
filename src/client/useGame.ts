import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { sessionId, playerName } from './session.js';

export interface ServerPayload { room: any; view: any; }

export function useGame() {
  const socketRef = useRef<Socket | null>(null);
  const [payload, setPayload] = useState<ServerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(-1);

  useEffect(() => {
    const s = io({ autoConnect: true });
    socketRef.current = s;
    s.on('state', (p: ServerPayload) => {
      // Drop obviously stale updates.
      if (p.view && p.view.version < version.current) return;
      if (p.view) version.current = p.view.version;
      setPayload(p);
    });
    s.on('connect_error', () => setError('Lost connection to the server.'));
    return () => { s.close(); };
  }, []);

  const emit = (event: string, data: Record<string, unknown>) =>
    new Promise<any>(resolve => {
      socketRef.current?.emit(event, { playerId: sessionId(), name: playerName(), ...data },
        (r: any) => { if (r && !r.ok) setError(r.error ?? 'Something went wrong.'); resolve(r); });
    });

  return { payload, error, setError, emit, playerId: sessionId() };
}
