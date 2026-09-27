import React, { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Bot, Code2, ShieldAlert, Table, UserCheck, Zap } from 'lucide-react';
import type { NodeType } from '@/types';
import { TASK_HEIGHT, TASK_WIDTH, outcomePortPoint } from '@/lib/layout/nodeGeometry';
import { EDGE_COLORS } from '../edgeStyle';
import { useCanvasView, useCompactZoom } from '../canvasContext';
import { NODE_ACCENT, NODE_TYPE_LABEL, taskFact } from './nodeStyle';
import { DiffBadge, NodeHandles, StatusBadge } from './NodeChrome';
import { type CanvasNode, stateOutline } from './nodeState';

const SIZE = { width: TASK_WIDTH, height: TASK_HEIGHT };

function TaskIcon({ type, className }: { type: NodeType; className?: string }) {
  const props = { className, style: { color: NODE_ACCENT[type] }, 'aria-hidden': true } as const;
  switch (type) {
    case 'agent':
      return <Bot {...props} />;
    case 'human':
      return <UserCheck {...props} />;
    case 'dmn':
      return <Table {...props} />;
    case 'engine-task':
      return <Zap {...props} />;
    case 'script':
      return <Code2 {...props} />;
    default:
      return null;
  }
}

/**
 * Activity card with a fixed footprint (so auto-layout places exactly what
 * is drawn): type accent and icon, a title wrapping to two lines, and one
 * line of key configuration. Zoomed out, only icon and title remain.
 * Outcome routes leave from BPMN-style boundary markers on the card edge.
 */
export const TaskNode = memo(({ data, selected }: NodeProps<CanvasNode>) => {
  const { direction } = useCanvasView();
  const compact = useCompactZoom();
  const accent = NODE_ACCENT[data.type];
  const outline = stateOutline(data, selected);
  const fact = taskFact(data);
  const outcomes = data.outcomeKinds ?? [];
  const tooltip = [NODE_TYPE_LABEL[data.type], data.diffAnnotation || data.description].filter(Boolean).join(' — ');

  return (
    <div
      className={`abada-node abada-task-card relative rounded-xl border bg-[#25201D] shadow-warm-lg ${
        data.isLiveCurrent || (data.isActiveSim && data.type === 'agent') ? 'glow-amethyst' : ''
      }`}
      style={{
        width: TASK_WIDTH,
        height: TASK_HEIGHT,
        borderColor: outline ?? `${accent}80`,
        boxShadow: outline ? `0 0 0 2px ${outline}` : undefined,
        opacity: data.diffKind === 'removed' ? 0.6 : 1,
      }}
      title={tooltip}
    >
      <span className="absolute inset-y-0 left-0 w-1 rounded-l-xl" style={{ background: accent }} />
      <div className="flex h-full flex-col justify-between py-2.5 pl-4 pr-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `${accent}26` }}>
            <TaskIcon type={data.type} className="h-3.5 w-3.5" />
          </span>
          <span className={`line-clamp-2 font-semibold text-[#EAE3D9] ${compact ? 'text-[15px] leading-[18px]' : 'text-[12px] leading-[15px]'}`}>
            {data.title}
          </span>
        </div>
        {!compact && fact && (
          <span className="truncate font-mono text-[10px] leading-3" style={{ color: accent }}>{fact}</span>
        )}
      </div>

      {outcomes.map((kind, index) => {
        const at = outcomePortPoint(SIZE, direction, index, outcomes.length);
        const color = EDGE_COLORS[kind === 'outcome-error' ? 'error' : 'warn'];
        const Icon = kind === 'outcome-error' ? Zap : ShieldAlert;
        return (
          <span
            key={index}
            className="pointer-events-none absolute z-20 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] bg-[#1A1614]"
            style={{ left: at.x, top: at.y, borderColor: color }}
            aria-hidden="true"
          >
            <Icon className="h-2.5 w-2.5" style={{ color }} />
          </span>
        );
      })}

      <StatusBadge status={data.status} live={data.isLiveCurrent} x={TASK_WIDTH - 2} y={2} />
      <DiffBadge kind={data.diffKind} />
      <NodeHandles />
    </div>
  );
});

TaskNode.displayName = 'TaskNode';
