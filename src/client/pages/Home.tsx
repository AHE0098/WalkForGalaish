import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../useGame.js';
import { setPlayerName, playerName } from '../session.js';

export function Home() {
  const { emit, error, setError } = useGame();
  const [name, setName] = useState(playerName());
  const [code, setCode] = useState('');
  const nav = useNavigate();

  const create = async () => {
    setPlayerName(name);
    const r = await emit('createRoom', { name, gameId: 'race-for-the-galaxy' });
    if (r?.ok) nav(`/room/${r.code}`);
  };
  const join = async () => {
    setPlayerName(name);
    if (!code.trim()) return setError('Enter a room code.');
    const r = await emit('joinRoom', { code: code.trim().toUpperCase(), name });
    if (r?.ok) nav(`/room/${r.code}`);
  };

  return (
    <main className="wrap">
      <h1>Card Game Platform</h1>
      <p className="muted">Race for the Galaxy</p>
      {error && <p className="err">{error}</p>}
      <label>Your name<input value={name} onChange={e => setName(e.target.value)} /></label>
      <div className="row">
        <button onClick={create}>Create game</button>
      </div>
      <div className="row">
        <input placeholder="ROOM CODE" value={code} maxLength={4}
               onChange={e => setCode(e.target.value.toUpperCase())} />
        <button onClick={join}>Join game</button>
      </div>
    </main>
  );
}
