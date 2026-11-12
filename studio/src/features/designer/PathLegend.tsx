import React, { useState } from 'react';
import { Panel } from '@xyflow/react';
import { ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { EDGE_COLORS, PATH_STROKE } from './edgeStyle';
import type { PathView } from '@/lib/run/instancePath';
import { palette } from '@/lib/tokens';

const COLLAPSED_KEY = 'abada.pathLegend.collapsed';

const readCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

const writeCollapsed = (value: boolean) => {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0');
  } catch {
    // A preference only: without storage the legend simply opens expanded.
  }
};

const Line: React.FC<{ color: string; width: number; dash?: string }> = ({ color, width, dash }) => (
  <svg width="22" height="8" aria-hidden="true">
    <line x1="1" y1="4" x2="21" y2="4" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />
  </svg>
);

/**
 * The three path layers of an instance diagram, in the canvas corner:
 * collapsible (remembered per browser) and with the "Show full diagram"
 * toggle that turns the dimming of what was never reached off.
 */
export const PathLegend: React.FC<{
  source: PathView['source'];
  showFullDiagram: boolean;
  onToggleFullDiagram: () => void;
  /** Sits above the overview map when it is shown. */
  raised?: boolean;
}> = ({ source, showFullDiagram, onToggleFullDiagram, raised }) => {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => {
    setCollapsed((value) => {
      writeCollapsed(!value);
      return !value;
    });
  };

  return (
    // Bottom corner: the diagram is fitted to the top and must never sit under the legend.
    <Panel position="bottom-right" style={raised ? { marginBottom: 150 } : undefined}>
      <div
        role="group"
        aria-label="Path legend"
        className="w-48 rounded-xl border border-hairline bg-mocha/95 p-1.5 text-[11px] text-sand shadow-warm-md"
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            className="flex flex-1 items-center gap-1 rounded-lg px-1.5 py-1 font-semibold text-linen hover:bg-mocha-hover"
            title={collapsed ? 'Show the legend' : 'Hide the legend'}
          >
            Path
            {collapsed ? <ChevronDown className="h-3 w-3" aria-hidden="true" /> : <ChevronUp className="h-3 w-3" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={onToggleFullDiagram}
            aria-pressed={showFullDiagram}
            className={`flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors ${
              showFullDiagram ? 'bg-saffron/15 text-saffron' : 'hover:bg-mocha-hover hover:text-linen'
            }`}
            title={showFullDiagram ? 'Fade what the instance never reached' : 'Show the full diagram, without fading'}
          >
            {showFullDiagram ? <EyeOff className="h-3 w-3" aria-hidden="true" /> : <Eye className="h-3 w-3" aria-hidden="true" />}
            Full diagram
          </button>
        </div>
        {!collapsed && (
          <ul className="mt-1 space-y-1 px-1.5 pb-1">
            <li className="flex items-center gap-2">
              <Line color={EDGE_COLORS.path} width={PATH_STROKE.taken.width} />
              <span
                className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[8px] font-bold text-charcoal"
                style={{ background: EDGE_COLORS.path }}
                aria-hidden="true"
              >
                1
              </span>
              <span className="text-linen">Path taken, in order</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="flex w-[22px] justify-center" aria-hidden="true">
                <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: palette.amethyst }} />
              </span>
              <span className="text-linen">Where it is now</span>
            </li>
            <li className="flex items-center gap-2">
              <Line color={EDGE_COLORS.unreached} width={PATH_STROKE.unreached.width + 0.5} dash={PATH_STROKE.unreached.dash} />
              <span>Not reached</span>
            </li>
            {source === 'reconstructed' && (
              <li
                className="mt-1 rounded-md border border-saffron/40 bg-saffron/10 px-1.5 py-1 text-[10px] leading-snug text-saffron"
                title="The engine records every flow taken since 1.2. This instance ran before that, so the path is inferred from the steps it touched; parallel branches and loops may be ambiguous."
              >
                Path reconstructed — started before flows were recorded
              </li>
            )}
          </ul>
        )}
      </div>
    </Panel>
  );
};
