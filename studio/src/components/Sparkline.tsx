import React, { useId } from 'react';
import { palette } from '@/lib/tokens';

const W = 100;
const H = 32;

/**
 * A small trend line: an area fill, a faint baseline and the latest point
 * emphasised. `null` values leave a gap (no data for that slot), so a missing
 * hour never reads as zero.
 */
export const Sparkline: React.FC<{
  values: readonly (number | null)[];
  /** A literal colour from `palette`. */
  colour: string;
  /** What the line shows, for screen readers. */
  label: string;
  className?: string;
}> = ({ values, colour, label, className = 'h-8 w-full' }) => {
  const gradient = useId();
  const known = values.filter((value): value is number => value !== null);
  const max = known.length ? Math.max(...known) * 1.15 || 1 : 1;
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const point = (value: number, index: number) => [index * step, H - (value / max) * (H - 2) - 1] as const;

  const segments: (readonly [number, number])[][] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (segments.at(-1)?.length) segments.push([]);
      return;
    }
    if (!segments.length) segments.push([]);
    segments[segments.length - 1].push(point(value, index));
  });
  const lines = segments.filter((segment) => segment.length > 0);
  const lastIndex = values.findLastIndex((value) => value !== null);
  const last = lastIndex >= 0 ? point(values[lastIndex] as number, lastIndex) : null;
  const toPath = (segment: readonly (readonly [number, number])[]) =>
    segment.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={`overflow-visible ${className}`}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colour} stopOpacity={0.22} />
          <stop offset="1" stopColor={colour} stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke={palette.hairline} strokeWidth={1}
        vectorEffect="non-scaling-stroke" strokeDasharray={known.length ? undefined : '3 4'} />
      {lines.map((segment, index) => (
        <g key={index}>
          {segment.length > 1 && (
            <path d={`${toPath(segment)} L${segment[segment.length - 1][0]} ${H} L${segment[0][0]} ${H} Z`}
              fill={`url(#${gradient})`} />
          )}
          <path d={toPath(segment)} fill="none" stroke={colour} strokeWidth={1.5}
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}
      {last && (
        <circle cx={last[0]} cy={last[1]} r={2.4} fill={colour} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
};
