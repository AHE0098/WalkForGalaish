/** Lightweight browser identity: enough to reclaim a seat after a refresh. */
const KEY = 'cgp.session';

export function sessionId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) { id = `p_${Math.random().toString(36).slice(2, 10)}`; localStorage.setItem(KEY, id); }
  return id;
}
export function playerName(): string { return localStorage.getItem('cgp.name') ?? 'Player'; }
export function setPlayerName(n: string): void { localStorage.setItem('cgp.name', n); }
