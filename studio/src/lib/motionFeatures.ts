/**
 * The `motion` feature bundle (animations, exit, gestures). Loaded lazily by
 * `MotionProvider` so it stays out of the first paint; `m` components render
 * immediately and start animating once it arrives.
 *
 * `domAnimation` has no layout animations: the `layout` prop is inert. Moving
 * to `domMax` costs about 12 kB gzip and must be weighed against the M5
 * bundle budget by the task that needs it.
 */
import { domAnimation } from 'motion/react';

export default domAnimation;
