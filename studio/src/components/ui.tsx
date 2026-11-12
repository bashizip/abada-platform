import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AnimatePresence, LazyMotion, MotionConfig, m, type HTMLMotionProps } from 'motion/react';
import { backdrop, duration, enterExit, modal, slideFrom, stateChange, useMotionVariants, useReducedMotion } from '@/lib/motion';

export const TooltipProvider = Tooltip.Provider;

const loadMotionFeatures = () => import('@/lib/motionFeatures').then((module) => module.default);

/**
 * Wraps the Studio once: `m` components get their features lazily, and the
 * user's reduced-motion preference turns movement into fades everywhere.
 */
export const MotionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MotionConfig reducedMotion="user">
    <LazyMotion features={loadMotionFeatures} strict>{children}</LazyMotion>
  </MotionConfig>
);

/**
 * Accessible hover tooltip. `side`/`sideOffset` control placement; content is
 * descriptive text shown on hover/focus (keyboard users reach it via focus).
 */
export const UITooltip: React.FC<{
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  children: React.ReactNode;
}> = ({ content, side = 'top', sideOffset = 8, children }) => (
  <Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        side={side}
        sideOffset={sideOffset}
        className="z-[100] select-none rounded-md border border-hairline bg-charcoal px-2.5 py-1.5 text-[11px] leading-snug text-linen shadow-warm-lg max-w-[280px]"
      >
        {content}
        <Tooltip.Arrow className="fill-charcoal" />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
);

interface IconButtonProps {
  icon: React.ReactNode;
  label: string;
  tooltip: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}

/**
 * Icon-only secondary control. Text is strictly reserved for primary CTAs;
 * every icon gets a hover tooltip carrying the contextual detail.
 */
export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  tooltip,
  onClick,
  active = false,
  disabled = false,
  danger = false,
  className = '',
}) => (
  <UITooltip content={tooltip}>
    <button
      type="button"
      aria-label={label}
      title=""
      data-cuelume-tap
      data-cuelume-emphasis="subtle"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all ${
        active
          ? 'border-amethyst/50 bg-amethyst/20 text-linen'
          : danger
            ? 'border-desert-rose/40 text-desert-rose hover:bg-mocha-hover'
            : 'border-hairline bg-charcoal text-sand hover:text-linen hover:bg-mocha-hover'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
    >
      {icon}
    </button>
  </UITooltip>
);

/**
 * Modal dialog with the Studio look: dimmed backdrop, Escape and backdrop
 * click close it, and focus moves to the close button when it opens.
 */
export const Dialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'md' | 'lg';
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ open, onClose, title, subtitle, icon, size = 'md', footer, children }) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const panelVariants = useMotionVariants(modal);
  return (
    <AnimatePresence>
      {open && (
        <m.div key="dialog" variants={backdrop} initial="initial" animate="enter" exit="exit"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
          <m.div
            variants={panelVariants}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            onClick={(event) => event.stopPropagation()}
            className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl border border-hairline bg-mocha shadow-warm-xl ${size === 'lg' ? 'max-w-3xl' : 'max-w-md'}`}
          >
            <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
              {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-linen">{title}</h2>
                {subtitle && <p className="mt-0.5 text-[11px] text-sand">{subtitle}</p>}
              </div>
              <button ref={closeButton} type="button" onClick={onClose} aria-label="Close"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-hairline text-sand hover:bg-mocha-hover hover:text-linen">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">{footer}</div>}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
};

/**
 * The dimmed layer behind a bespoke modal. It fades in and, when the modal is
 * rendered inside `AnimatePresence`, fades out before it unmounts.
 */
export const MotionBackdrop: React.FC<HTMLMotionProps<'div'>> = (props) => (
  <m.div variants={backdrop} initial="initial" animate="enter" exit="exit" {...props} />
);

/** The panel of a bespoke modal; follows its `MotionBackdrop` in and out. */
export const MotionPanel: React.FC<HTMLMotionProps<'div'>> = (props) => {
  const variants = useMotionVariants(modal);
  return <m.div variants={variants} {...props} />;
};

/**
 * Placeholder for content that is loading. The shimmer stops under reduced
 * motion (the block stays, so the layout does not jump when data arrives).
 */
export const Skeleton: React.FC<{ className?: string; lines?: number; label?: string }> = ({
  className = 'h-3 w-full',
  lines = 1,
  label = 'Loading',
}) => (
  <div role="status" aria-label={label} aria-busy="true" className="flex flex-col gap-2">
    {Array.from({ length: lines }, (_, index) => (
      <div key={index}
        className={`rounded-md bg-mocha animate-shimmer motion-reduce:animate-none ${className} ${
          lines > 1 && index === lines - 1 ? 'max-w-[70%]' : ''}`} />
    ))}
  </div>
);

/** What a view shows when it has nothing to list: what is missing and what to do next. */
export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ icon, title, description, action, className = '' }) => {
  const variants = useMotionVariants(enterExit);
  return (
    <m.div variants={variants} initial="initial" animate="enter"
      className={`flex flex-col items-center justify-center gap-2 px-6 py-10 text-center ${className}`}>
      {icon && <span className="text-moss" aria-hidden="true">{icon}</span>}
      <p className="text-sm font-semibold text-linen">{title}</p>
      {description && <p className="max-w-sm text-[11px] leading-relaxed text-sand">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </m.div>
  );
};

export type StatusTone = 'neutral' | 'running' | 'success' | 'warning' | 'danger' | 'info';

const STATUS_TONES: Record<StatusTone, string> = {
  neutral: 'border-hairline bg-charcoal text-sand',
  running: 'border-amethyst/40 bg-amethyst/15 text-amethyst-light',
  success: 'border-sage-green/40 bg-sage-green/15 text-sage-green',
  warning: 'border-saffron/40 bg-saffron/15 text-saffron',
  danger: 'border-desert-rose/40 bg-desert-rose/15 text-desert-rose',
  info: 'border-mineral-teal/40 bg-mineral-teal/15 text-mineral-teal',
};

const STATUS_DOTS: Record<StatusTone, string> = {
  neutral: 'bg-sand',
  running: 'bg-amethyst',
  success: 'bg-sage-green',
  warning: 'bg-saffron',
  danger: 'bg-desert-rose',
  info: 'bg-mineral-teal',
};

/**
 * A compact state label. When the state changes the pill pulses once, so the
 * change is noticed; `live` adds the one allowed loop, a breathing dot for
 * something that is happening now.
 */
export const StatusPill: React.FC<{
  tone: StatusTone;
  label: string;
  live?: boolean;
  className?: string;
}> = ({ tone, label, live = false, className = '' }) => {
  const reduced = useReducedMotion();
  const first = useRef(true);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setPulse((count) => count + 1);
  }, [tone, label]);
  return (
    <m.span
      key={pulse}
      data-tone={tone}
      variants={stateChange}
      initial="initial"
      animate={pulse > 0 && !reduced ? 'enter' : 'initial'}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONES[tone]} ${className}`}
    >
      <span aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOTS[tone]} ${live ? 'abada-live-outline' : ''}`} />
      {label}
    </m.span>
  );
};

/**
 * A panel that slides in from the edge over the page, for details that belong
 * to what the user is looking at. Escape and the backdrop close it.
 */
export const Drawer: React.FC<{
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  side?: 'left' | 'right';
  width?: number;
  children: React.ReactNode;
}> = ({ open, onClose, title, side = 'right', width = 420, children }) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  const panelVariants = useMotionVariants(slideFrom(side));
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <m.div key="drawer" variants={backdrop} initial="initial" animate="enter" exit="exit"
          className="fixed inset-0 z-[var(--elevation-drawer)] bg-black/50" onClick={onClose}>
          <m.aside
            variants={panelVariants}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            onClick={(event) => event.stopPropagation()}
            style={{ width }}
            className={`absolute top-0 flex h-full max-w-full flex-col border-hairline bg-mocha shadow-warm-lg ${
              side === 'right' ? 'right-0 border-l' : 'left-0 border-r'}`}
          >
            <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-linen">{title}</h2>
              <button ref={closeButton} type="button" onClick={onClose} aria-label="Close"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-hairline text-sand hover:bg-mocha-hover hover:text-linen">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
          </m.aside>
        </m.div>
      )}
    </AnimatePresence>
  );
};

/** Ease-out cubic, close to the `standard` curve, for frame-driven tweens. */
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * A number that counts to its new value instead of jumping, so a change in a
 * counter reads as a change. Instant under reduced motion and on first render.
 */
export const AnimatedNumber: React.FC<{
  value: number;
  format?: (value: number) => string;
  className?: string;
}> = ({ value, format = (n) => Math.round(n).toLocaleString(), className }) => {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const from = shownRef.current;
    if (reduced || from === value || typeof requestAnimationFrame !== 'function') {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / duration.base);
      const next = from + (value - from) * easeOut(progress);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return <span className={`tabular-nums ${className ?? ''}`}>{format(shown)}</span>;
};
