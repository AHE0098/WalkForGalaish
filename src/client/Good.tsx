import React from 'react';

export const GOOD_KINDS = ['novelty', 'rare', 'genes', 'alien'] as const;
export type GoodKind = typeof GOOD_KINDS[number];

/** Distinct silhouette per good, so colour is never the only signal. */
const SHAPE: Record<string, React.ReactNode> = {
  novelty: <rect x="4" y="4" width="16" height="16" rx="3" />,
  rare:    <path d="M12 2l9 6v8l-9 6-9-6V8z" />,
  genes:   <path d="M7 3c0 6 10 7 10 9s-10 3-10 9M17 3c0 6-10 7-10 9s10 3 10 9" fill="none"
                  strokeWidth="2.6" strokeLinecap="round" />,
  alien:   <path d="M12 2l10 8-4 12H6L2 10z" />,
};

/** One good token: a coloured shape with the kind as its accessible label. */
export function Good({ kind, size = 16, title }:
  { kind: string | null; size?: number; title?: string }) {
  const k = (kind ?? 'novelty') as GoodKind;
  return (
    <svg className={`good-token good-token--${k}`} width={size} height={size}
         viewBox="0 0 24 24" role="img" aria-label={title ?? `${k} good`}>
      <title>{title ?? `${k} good`}</title>
      {SHAPE[k] ?? SHAPE.novelty}
    </svg>
  );
}

/** A compact "2 novelty, 1 alien" strip for the status table and player areas. */
export function GoodTally({ stats, size = 14 }:
  { stats: Record<string, number | string> | undefined; size?: number }) {
  if (!stats) return null;
  const present = GOOD_KINDS.filter(k => Number(stats[k] ?? 0) > 0);
  if (!present.length) return <span className="muted tiny">—</span>;
  return (
    <span className="tally">
      {present.map(k => (
        <span key={k} className="tally__item" title={`${stats[k]} ${k}`}>
          <Good kind={k} size={size} />{Number(stats[k]) > 1 && <i>{stats[k]}</i>}
        </span>
      ))}
    </span>
  );
}
