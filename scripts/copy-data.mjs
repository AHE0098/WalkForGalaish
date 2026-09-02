/** tsc does not emit .json imports; copy game data into the server build. */
import { cpSync, mkdirSync } from 'node:fs';
const from = 'src/games/race-for-the-galaxy/cards';
const to = 'dist/server/games/race-for-the-galaxy/cards';
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`copied ${from} -> ${to}`);
