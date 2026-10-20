import React, { useLayoutEffect, useRef, useState } from 'react';
import { m } from 'motion/react';
import { transition, useReducedMotion } from '@/lib/motion';
import { navTabFor, type NavTab, type StudioView } from '@/lib/studioViews';


const TABS: { id: NavTab; label: React.ReactNode }[] = [
  { id: 'designer', label: 'Canvas' },
  { id: 'inbox', label: 'Task Inbox' },
  { id: 'operations', label: 'Operations' },
  { id: 'insight', label: 'Insight' },
  { id: 'administration', label: 'Admin' },
];

interface ViewNavProps {
  currentView: StudioView;
  onViewChange?: (view: NavTab) => void;
  showAdmin: boolean;
}

/**
 * The header's view switcher. The highlight slides from the previous tab to
 * the new one (transform only); under reduced motion it moves without travel.
 */
export const ViewNav: React.FC<ViewNavProps> = ({ currentView, onViewChange, showAdmin }) => {
  const active = navTabFor(currentView);
  const reduced = useReducedMotion();
  const buttons = useRef(new Map<NavTab, HTMLButtonElement>());
  const [pill, setPill] = useState<{ x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const button = buttons.current.get(active);
      setPill(button ? { x: button.offsetLeft, width: button.offsetWidth } : null);
    };
    measure();
    // Labels change width when fonts load or the window resizes.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    buttons.current.forEach((button) => observer?.observe(button));
    return () => observer?.disconnect();
  }, [active, showAdmin]);
  const measured = !!pill && pill.width > 0;

  return (
    <nav aria-label="Studio views" className="relative flex items-center bg-charcoal rounded-xl border border-hairline p-1 shrink-0">
      {measured && (
        <m.span aria-hidden="true" data-testid="nav-highlight"
          className="absolute left-0 top-1 bottom-1 rounded-lg bg-mocha border border-hairline will-change-transform"
          initial={false}
          animate={{ x: pill!.x, width: pill!.width }}
          transition={reduced ? { duration: 0 } : transition('base')} />
      )}
      {TABS.filter((tab) => tab.id !== 'administration' || showAdmin).map((tab) => (
        <button
          key={tab.id}
          ref={(node) => { if (node) buttons.current.set(tab.id, node); else buttons.current.delete(tab.id); }}
          type="button"
          data-cuelume-select
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={() => onViewChange?.(tab.id)}
          className={`relative z-10 text-xs px-2.5 xl:px-4 py-1.5 rounded-lg transition-colors duration-[var(--duration-base)] font-medium whitespace-nowrap border ${
            tab.id === 'administration' ? 'ml-1' : ''} ${
            active === tab.id
              // The sliding highlight paints the background; before it is measured the tab paints its own.
              ? `text-linen ${measured ? 'border-transparent' : 'bg-mocha border-hairline'}`
              : 'text-sand hover:text-linen border-transparent'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
};
