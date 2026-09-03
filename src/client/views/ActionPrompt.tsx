import React from 'react';

export const ACTION_CARDS = [
  { id: 'explore-5', label: 'Explore +5', phase: 'explore', numeral: 'I',
    hint: 'Draw 7 cards, keep 1' },
  { id: 'explore-1-1', label: 'Explore +1,+1', phase: 'explore', numeral: 'I',
    hint: 'Draw 3 cards, keep 2' },
  { id: 'develop', label: 'Develop', phase: 'develop', numeral: 'II',
    hint: 'Pay one card less for your development' },
  { id: 'settle', label: 'Settle', phase: 'settle', numeral: 'III',
    hint: 'Draw a card after placing a world' },
  { id: 'consume-trade', label: 'Consume: Trade', phase: 'consume', numeral: 'IV',
    hint: 'Sell one good for cards first' },
  { id: 'consume-2x', label: 'Consume: ×2 VP', phase: 'consume', numeral: 'IV',
    hint: 'Double the VP chips you gain' },
  { id: 'produce', label: 'Produce', phase: 'produce', numeral: 'V',
    hint: 'Also produce on one windfall world' },
];

/**
 * The round's opening decision, given its own step rather than being buried in
 * the action bar. Every phase your card triggers is spelled out.
 */
export function ActionPrompt({ chosen, onChoose, waitingOn }: {
  chosen: string | null; onChoose: (id: string) => void; waitingOn: string[];
}) {
  if (chosen) {
    const c = ACTION_CARDS.find(a => a.id === chosen);
    return (
      <section className="prompt prompt--waiting">
        <div>
          <h2 className="tight">You chose {c?.label}</h2>
          <p className="muted">
            {waitingOn.length
              ? `Waiting for ${waitingOn.join(', ')}…`
              : 'Revealing…'}
          </p>
        </div>
        <span className="spinner" aria-hidden />
      </section>
    );
  }

  return (
    <section className="prompt">
      <h2 className="tight">Choose your action for round</h2>
      <p className="muted tiny">
        Only the phases chosen by someone will happen. You get the bonus for yours.
      </p>
      <div className="actiongrid actiongrid--rich">
        {ACTION_CARDS.map(a => (
          <button key={a.id} onClick={() => onChoose(a.id)} className="actioncard">
            <span className="actioncard__num">{a.numeral}</span>
            <span>
              <b>{a.label}</b>
              <i>{a.hint}</i>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
