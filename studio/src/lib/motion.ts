/**
 * The Studio motion vocabulary. Every animation reads its timing from here so
 * the whole Studio moves the same way (M5 S1):
 *
 * - Motion carries meaning: a state change, where something came from or went,
 *   or what is live. No decorative loops except a live indicator.
 * - Nothing takes longer than 400 ms, except the playback dwell (`calm`).
 * - `prefers-reduced-motion` turns movement into a plain fade; it never hides
 *   a state change.
 *
 * The CSS custom properties `--duration-*` and `--ease-*` in `index.css` carry
 * the same values for CSS transitions.
 */
import type { Transition, Variants } from 'motion/react';
import { useReducedMotion as useMotionReducedMotion } from 'motion/react';

/** Durations in milliseconds. */
export const duration = {
  /** Hover, press, small state flips. */
  fast: 150,
  /** Enter/exit of panels, dialogs, toasts and list items. */
  base: 240,
  /** Playback dwell per visible step; the only value above the 400 ms ceiling. */
  calm: 700,
} as const;

/** The ceiling for any interface animation other than the playback dwell. */
export const MAX_UI_DURATION_MS = 400;

/** Cubic-bezier easings: `standard` for most movement, `emphasised` to draw the eye. */
export const easing = {
  standard: [0.2, 0, 0, 1],
  emphasised: [0.3, 0, 0, 1.2],
} as const satisfies Record<string, readonly [number, number, number, number]>;

const seconds = (ms: number) => ms / 1000;

/** A ready-made `motion` transition from the tokens. */
export function transition(
  speed: Exclude<keyof typeof duration, 'calm'> = 'base',
  ease: keyof typeof easing = 'standard',
): Transition {
  return { duration: seconds(duration[speed]), ease: [...easing[ease]] };
}

/** Elements arriving and leaving: a short rise with a fade. */
export const enterExit: Variants = {
  initial: { opacity: 0, y: 4 },
  enter: { opacity: 1, y: 0, transition: transition('base') },
  exit: { opacity: 0, y: 4, transition: transition('fast') },
};

/**
 * Route changes: the new view fades in. Opacity only, so no transform creates
 * a containing block for the view's fixed-position overlays mid-transition.
 */
export const page: Variants = {
  initial: { opacity: 0 },
  enter: { opacity: 1, transition: transition('fast') },
  exit: { opacity: 0, transition: transition('fast') },
};

/**
 * Switching between the Studio's top-level views: the new view fades in while
 * travelling a short way from the side of the tab it was reached from
 * (`direction` 1 = a tab to the right, -1 = to the left, 0 = in place). A
 * translation only, settling at `transform: none`, so the view's fixed-position
 * overlays are positioned normally once it has arrived.
 */
export function viewSwitch(direction: -1 | 0 | 1): Variants {
  return {
    initial: { opacity: 0, x: VIEW_TRAVEL_PX * direction },
    enter: { opacity: 1, x: 0, transition: transition('base') },
    exit: { opacity: 0, transition: transition('fast') },
  };
}

/** How far a view travels as it arrives: enough to read as direction, not as a slide. */
export const VIEW_TRAVEL_PX = 12;

/** Dialogs: scale up slightly from where the eye already is. */
export const modal: Variants = {
  initial: { opacity: 0, scale: 0.97 },
  enter: { opacity: 1, scale: 1, transition: transition('base', 'emphasised') },
  exit: { opacity: 0, scale: 0.98, transition: transition('fast') },
};

/** Backdrops only fade. */
export const backdrop: Variants = {
  initial: { opacity: 0 },
  enter: { opacity: 1, transition: transition('base') },
  exit: { opacity: 0, transition: transition('fast') },
};

/** Toasts slide in from the edge they live on and leave the same way. */
export const toast: Variants = {
  initial: { opacity: 0, x: 24 },
  enter: { opacity: 1, x: 0, transition: transition('base', 'emphasised') },
  exit: { opacity: 0, x: 24, transition: transition('fast') },
};

/** Side panels and drawers slide in from their own edge. */
export function slideFrom(side: 'left' | 'right' | 'bottom'): Variants {
  if (side === 'bottom') {
    return {
      initial: { opacity: 0, y: 24 },
      enter: { opacity: 1, y: 0, transition: transition('base') },
      exit: { opacity: 0, y: 24, transition: transition('fast') },
    };
  }
  const offset = side === 'left' ? -16 : 16;
  return {
    initial: { opacity: 0, x: offset },
    enter: { opacity: 1, x: 0, transition: transition('base') },
    exit: { opacity: 0, x: offset, transition: transition('fast') },
  };
}

/** A list whose items arrive one after another; pair with `listItem`. */
export const listStagger: Variants = {
  initial: {},
  enter: { transition: { staggerChildren: 0.03, delayChildren: 0.02 } },
  exit: {},
};

export const listItem: Variants = enterExit;

/** One brief pulse when a value or state changes (never a loop). */
export const stateChange: Variants = {
  initial: { scale: 1 },
  enter: { scale: [1, 1.08, 1], transition: transition('base', 'emphasised') },
};

/**
 * Layout shifts (reordering, resizing) move with the standard curve. Needs the
 * `domMax` features; see `motionFeatures.ts` before relying on it.
 */
export const layoutShift: Transition = transition('base');

/** Strips movement from a variant set, keeping opacity, for reduced motion. */
export function withoutMovement(variants: Variants): Variants {
  const still: Variants = {};
  for (const [name, target] of Object.entries(variants)) {
    if (typeof target === 'function') {
      still[name] = target;
      continue;
    }
    const { x: _x, y: _y, scale: _scale, rotate: _rotate, ...rest } = target as Record<string, unknown>;
    still[name] = rest as Variants[string];
  }
  return still;
}

/**
 * True when the user asked the system for reduced motion. Wraps the `motion`
 * hook so callers always get a boolean (it returns null before it knows).
 */
export function useReducedMotion(): boolean {
  return useMotionReducedMotion() === true;
}

/** The variants to use for this user: unchanged, or fade-only under reduced motion. */
export function useMotionVariants(variants: Variants): Variants {
  const reduced = useReducedMotion();
  return reduced ? withoutMovement(variants) : variants;
}
