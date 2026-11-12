import React from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Braces, GitBranch, History, MousePointerClick, X } from 'lucide-react';
import { slideFrom, useMotionVariants } from '@/lib/motion';

export type DrawerTab = 'step' | 'variables' | 'lineage' | 'versions';

const TABS: { id: DrawerTab; label: string; icon: React.ElementType }[] = [
  { id: 'step', label: 'Step', icon: MousePointerClick },
  { id: 'variables', label: 'Variables', icon: Braces },
  { id: 'lineage', label: 'Lineage', icon: GitBranch },
  { id: 'versions', label: 'Versions', icon: History },
];

/**
 * The details of the run in a drawer that rises over the lower part of the
 * canvas: the selected step, variables, lineage and versions. The tab strip
 * stays on the canvas; a tab opens the drawer, the same tab or Esc closes it.
 */
export const InstanceDrawer: React.FC<{
  tab: DrawerTab | null;
  onTabChange: (tab: DrawerTab | null) => void;
  variableCount?: number;
  title: React.ReactNode;
  children: React.ReactNode;
}> = ({ tab, onTabChange, variableCount, title, children }) => {
  const variants = useMotionVariants(slideFrom('bottom'));
  return (
    <>
      <AnimatePresence>
        {tab && (
          <m.section key="drawer" variants={variants} initial="initial" animate="enter" exit="exit"
            id="instance-drawer" role="tabpanel" aria-label={TABS.find((item) => item.id === tab)?.label}
            className="absolute inset-x-0 bottom-0 z-[var(--elevation-panel)] flex h-[46%] min-h-[220px] flex-col border-t border-hairline-strong bg-mocha-deep shadow-warm-lg">
            <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-3">
              <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-linen">{title}</h2>
              <button type="button" onClick={() => onTabChange(null)} title="Close (Esc)"
                className="flex items-center gap-1.5 rounded-control px-2 py-1 text-[11px] text-sand hover:bg-mocha-hover hover:text-linen">
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-14">{children}</div>
          </m.section>
        )}
      </AnimatePresence>
      <div role="tablist" aria-label="Instance details"
        className="absolute bottom-3 left-1/2 z-[var(--elevation-panel)] flex -translate-x-1/2 gap-1 rounded-card border border-hairline bg-mocha-deep/95 p-1 shadow-warm-md">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} aria-controls={tab === item.id ? 'instance-drawer' : undefined}
            onClick={() => onTabChange(tab === item.id ? null : item.id)}
            className={`flex items-center gap-1.5 rounded-control px-2.5 py-1 text-[11.5px] font-semibold transition-colors duration-150 ${tab === item.id
              ? 'bg-mocha-hover text-linen' : 'text-sand hover:text-linen'}`}>
            <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
            {item.label}
            {item.id === 'variables' && variableCount !== undefined && (
              <span className="text-[10px] tabular-nums text-amethyst-light">{variableCount}</span>
            )}
          </button>
        ))}
      </div>
    </>
  );
};
