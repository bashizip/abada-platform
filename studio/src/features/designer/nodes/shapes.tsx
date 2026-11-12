import React from 'react';
import { EVENT_SIZE, GATEWAY_SIZE, diamond } from '@/lib/layout/nodeGeometry';
import { kindAccent, kindSpec, type NodeKind } from './nodeCatalog';
import { kindIcon } from './kindIcons';

/**
 * The drawings of each node kind, shared by the canvas nodes and the palette
 * glyphs: one drawing at canvas size, scaled down through an SVG viewBox for
 * the palette, so what the user picks is what lands on the canvas.
 */

const EC = EVENT_SIZE / 2;

/** BPMN event circle in canvas coordinates: thin ring (start), thick ring (end), double ring (catch). */
export const EventShape: React.FC<{ kind: NodeKind; color: string; fill: string; ended?: boolean }> = ({
  kind, color, fill, ended,
}) => {
  const ring = kind === 'end' ? 4 : 2;
  const isCatch = kind === 'timer' || kind === 'message' || kind === 'signal';
  return (
    <>
      <circle cx={EC} cy={EC} r={EC - ring / 2} fill={fill} stroke={color} strokeWidth={ring} />
      {/* Finished here: the end marker fills in. */}
      {ended && <circle cx={EC} cy={EC} r={EC - ring - 4} fill={color} />}
      {isCatch && <circle cx={EC} cy={EC} r={EC - 5} fill="none" stroke={color} strokeWidth="1.5" />}
    </>
  );
};

const S = GATEWAY_SIZE;
const GC = S / 2;


/** BPMN gateway marker: X exclusive, + parallel, O inclusive, pentagon event-based. */
export const GatewayMarker: React.FC<{ kind: NodeKind; color: string }> = ({ kind, color }) => {
  switch (kind) {
    case 'parallel':
      return <path d={`M ${GC} ${GC - 11} V ${GC + 11} M ${GC - 11} ${GC} H ${GC + 11}`} stroke={color} strokeWidth="3.5" strokeLinecap="round" />;
    case 'inclusive':
      return <circle cx={GC} cy={GC} r="9" fill="none" stroke={color} strokeWidth="3" />;
    case 'event-gateway': {
      const pentagon = Array.from({ length: 5 }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        return `${(GC + Math.cos(a) * 6.5).toFixed(2)},${(GC + Math.sin(a) * 6.5).toFixed(2)}`;
      }).join(' ');
      return (
        <g fill="none" stroke={color} strokeWidth="1.5">
          <circle cx={GC} cy={GC} r="12.5" />
          <circle cx={GC} cy={GC} r="10" />
          <polygon points={pentagon} strokeLinejoin="round" />
        </g>
      );
    }
    default:
      return <path d={`M ${GC - 8} ${GC - 8} L ${GC + 8} ${GC + 8} M ${GC + 8} ${GC - 8} L ${GC - 8} ${GC + 8}`} stroke={color} strokeWidth="3.5" strokeLinecap="round" />;
  }
};

/** Gateway diamond and marker in canvas coordinates. */
export const GatewayShape: React.FC<{ kind: NodeKind; color: string; fill: string }> = ({ kind, color, fill }) => (
  <>
    <polygon points={diamond(1)} fill={fill} stroke={color} strokeWidth="2" strokeLinejoin="round" />
    <GatewayMarker kind={kind} color={color} />
  </>
);

/**
 * A node kind drawn small, exactly as the canvas draws it: the event circle,
 * the gateway diamond or the activity card with its accent bar and icon.
 * `size` is the glyph's height in pixels.
 */
export const NodeGlyph: React.FC<{ kind: NodeKind; size?: number; className?: string }> = ({
  kind, size = 28, className,
}) => {
  const spec = kindSpec(kind);
  const color = kindAccent(kind);
  const Icon = kindIcon(kind);
  const label = spec.label;
  if (spec.type === 'event') {
    return (
      <svg width={size} height={size} viewBox={`-1 -1 ${EVENT_SIZE + 2} ${EVENT_SIZE + 2}`} role="img" aria-label={label}
        className={className} data-shape="event">
        <EventShape kind={kind} color={color} fill={`${color}1f`} />
        {Icon && <Icon x={EC - 9} y={EC - 9} width={18} height={18} color={color} aria-hidden="true" />}
      </svg>
    );
  }
  if (spec.type === 'gateway') {
    return (
      <svg width={size} height={size} viewBox={`-1 -1 ${S + 2} ${S + 2}`} role="img" aria-label={label}
        className={className} data-shape="gateway">
        <GatewayShape kind={kind} color={color} fill={`${color}1f`} />
      </svg>
    );
  }
  // The activity card: a rounded rectangle with the accent bar and the icon chip.
  const width = Math.round(size * 1.55);
  return (
    <span role="img" aria-label={label} data-shape="task" className={`relative inline-flex shrink-0 items-center overflow-hidden rounded-md border ${className ?? ''}`}
      style={{ width, height: size, borderColor: `${color}80`, background: `${color}14` }}>
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
      <span className="ml-[7px] flex items-center justify-center rounded" style={{ width: size * 0.6, height: size * 0.6, background: `${color}26` }}>
        {Icon && <Icon style={{ width: size * 0.4, height: size * 0.4, color }} aria-hidden="true" />}
      </span>
    </span>
  );
};
