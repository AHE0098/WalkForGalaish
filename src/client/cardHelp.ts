import type { CardFace } from './cardDb.js';

export interface Callout {
  n: number;
  /** Where the marker sits on the large card, in percent. */
  at: { top: string; left?: string; right?: string };
  title: string;
  text: string;
}

/**
 * Short, type-aware guidance shown beside the full-size card. The numbers on the
 * card match the numbers in the list, which survives a phone screen better than
 * drawn arrows.
 */
export function cardHelp(c: CardFace): { headline: string; callouts: Callout[]; phase: string } {
  const w = c.world;
  const out: Callout[] = [];

  if (c.cardType === 'development') {
    out.push({ n: 1, at: { top: '5%', left: '5%' },
      title: 'Cost (diamond)',
      text: c.isSixCostDevelopment
        ? 'A six-cost development. Discard 6 cards from hand to build it — 5 if you chose the Develop action.'
        : `Discard ${c.cost} card${c.cost === 1 ? '' : 's'} from your hand to build it. One fewer if you chose the Develop action.` });
    out.push({ n: 2, at: { top: '5%', right: '5%' },
      title: c.isSixCostDevelopment ? 'Victory points: ?' : 'Victory points',
      text: c.isSixCostDevelopment
        ? 'Worth a variable amount, counted at the end of the game from what else is in your tableau. See the ★ row.'
        : `Adds ${c.victoryPoints} to your final score, permanently.` });
    return {
      headline: c.isSixCostDevelopment
        ? 'Six-cost development — an end-game scoring engine'
        : 'Development — built in phase II',
      phase: 'Play this during II Develop. You may hold only one copy of a given development.',
      callouts: pushPowers(out, c),
    };
  }

  const military = w?.settlementMode === 'military';
  out.push(military
    ? { n: 1, at: { top: '5%', left: '5%' }, title: 'Defense (red circle)',
        text: `You must conquer this world: your total military must be at least ${w!.defense}. You pay no cards for it.` }
    : { n: 1, at: { top: '5%', left: '5%' }, title: 'Cost (circle)',
        text: `Discard ${w!.settleCost} card${w!.settleCost === 1 ? '' : 's'} from your hand to settle it. Military does not help here.` });

  out.push({ n: 2, at: { top: '5%', right: '5%' }, title: 'Victory points',
    text: `Adds ${c.victoryPoints} to your final score, permanently.` });

  if (w?.productionMode === 'windfall')
    out.push({ n: 3, at: { top: '5%', left: '5%' }, title: 'Windfall (coloured halo)',
      text: `The halo means one ${w.resourceType} good is placed here the moment you settle it. It does not refill during Produce unless a power says so.` });
  else if (w?.productionMode === 'production')
    out.push({ n: 3, at: { top: '5%', left: '5%' }, title: 'Production (filled circle)',
      text: `A solid circle means this world makes a ${w.resourceType} good every Produce phase, whenever it is empty.` });

  if (w?.isRebel)
    out.push({ n: out.length + 1, at: { top: '32%', left: '6%' }, title: 'Rebel world',
      text: 'Some cards give extra military specifically against Rebel worlds, and some six-cost developments score for owning them.' });
  if (w?.isAlien)
    out.push({ n: out.length + 1, at: { top: '38%', left: '6%' }, title: 'Alien world',
      text: 'Contact Specialist cannot be used to pay for an Alien military world.' });
  if (c.isStartWorld)
    out.push({ n: out.length + 1, at: { top: '44%', left: '6%' }, title: 'Start world',
      text: 'One of these begins in every player\u2019s tableau. Unused copies are shuffled into the deck as ordinary cards.' });

  // A world can be several things at once — say all of them, in priority order.
  const how = military ? 'conquered with military' : 'settled by paying cards';
  const makes = w?.productionMode === 'windfall' ? 'arrives holding a good'
    : w?.productionMode === 'production' ? 'produces a good each Produce'
    : null;
  return {
    headline: `${military ? 'Military world' : 'World'} — ${how}${makes ? `, ${makes}` : ''}`,
    phase: 'Play this during III Settle. One world per Settle phase.',
    callouts: pushPowers(out, c),
  };
}

function pushPowers(out: Callout[], c: CardFace): Callout[] {
  if (c.powers.some(p => p.phase !== 'endGame'))
    out.push({ n: out.length + 1, at: { top: '72%', left: '5%' }, title: 'Powers (I–V)',
      text: 'Each row is a phase. A power starts working the phase after the card is placed, and must be used when it applies unless it says "may".' });
  if (c.powers.some(p => p.phase === 'endGame'))
    out.push({ n: out.length + 1, at: { top: '86%', left: '5%' }, title: '★ End-game scoring',
      text: 'Counted once when the game ends. For one card, each tableau card scores in only one of its categories.' });
  return out;
}

/** The five phases, for the small reference strip in the reader. */
export const PHASE_HELP = [
  { n: 'I', name: 'Explore', text: 'Draw cards and keep some' },
  { n: 'II', name: 'Develop', text: 'Build one development, paying cards' },
  { n: 'III', name: 'Settle', text: 'Place one world, by payment or conquest' },
  { n: 'IV', name: 'Consume', text: 'Spend goods for victory chips' },
  { n: 'V', name: 'Produce', text: 'Production worlds make goods' },
];
