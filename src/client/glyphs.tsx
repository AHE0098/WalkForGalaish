import React from 'react';
import { Good } from './Good.js';

/**
 * A rule line is a list of segments rather than a string, so the renderer can
 * draw real symbols where the printed card does. Games decide which segments a
 * power produces; this module only knows how to draw them.
 */
export type Segment =
  | { t: 'text'; v: string }
  | { t: 'good'; kind: string }
  | { t: 'military'; v: number }
  | { t: 'vp'; v: number }
  | { t: 'card'; v: number }
  | { t: 'strong'; v: string };

export function Glyph({ seg }: { seg: Segment }) {
  switch (seg.t) {
    case 'good':
      return <Good kind={seg.kind} size={13} />;
    case 'military':
      // Same red circle the printed cards use for a world's defense.
      return (
        <span className="glyph glyph--mil" title={`${seg.v > 0 ? '+' : ''}${seg.v} military`}>
          {seg.v > 0 ? `+${seg.v}` : seg.v}
        </span>
      );
    case 'vp':
      return <span className="glyph glyph--vp" title={`${seg.v} victory points`}>{seg.v}</span>;
    case 'card':
      return <span className="glyph glyph--card" title={`${seg.v} cards`}>{seg.v}</span>;
    case 'strong':
      return <b>{seg.v}</b>;
    default:
      return <>{seg.v}</>;
  }
}

/** Draw a whole rule line. */
export function Segments({ segs }: { segs: Segment[] }) {
  return (
    <>{segs.map((s, i) => <Glyph key={i} seg={s} />)}</>
  );
}

/** Plain-text version, for aria-labels and any surface that cannot draw. */
export function segmentsToText(segs: Segment[]): string {
  return segs.map(s => {
    switch (s.t) {
      case 'good': return ` ${s.kind} `;
      case 'military': return ` ${s.v > 0 ? '+' : ''}${s.v} military `;
      case 'vp': return ` ${s.v} VP `;
      case 'card': return ` ${s.v} cards `;
      default: return s.v;
    }
  }).join('').replace(/\s+/g, ' ').trim();
}
