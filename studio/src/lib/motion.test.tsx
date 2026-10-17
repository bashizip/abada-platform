import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/render';

const reducedMotion = vi.hoisted(() => ({ value: null as boolean | null }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => reducedMotion.value,
}));

import {
  MAX_UI_DURATION_MS, backdrop, duration, enterExit, modal, page, slideFrom, toast,
  useMotionVariants, useReducedMotion, withoutMovement,
} from './motion';

function Probe({ onRender }: { onRender: (reduced: boolean, variants: ReturnType<typeof useMotionVariants>) => void }) {
  onRender(useReducedMotion(), useMotionVariants(enterExit));
  return null;
}

const probe = () => {
  let seen: { reduced: boolean; variants: ReturnType<typeof useMotionVariants> } | undefined;
  render(<Probe onRender={(reduced, variants) => { seen = { reduced, variants }; }} />);
  return seen!;
};

describe('motion tokens', () => {
  afterEach(() => { reducedMotion.value = null; });

  it('keeps every interface duration under the 400 ms ceiling; only the dwell is longer', () => {
    expect(duration).toEqual({ fast: 150, base: 240, calm: 700 });
    expect(duration.fast).toBeLessThanOrEqual(MAX_UI_DURATION_MS);
    expect(duration.base).toBeLessThanOrEqual(MAX_UI_DURATION_MS);
    for (const variants of [enterExit, modal, backdrop, toast, page, slideFrom('left'), slideFrom('right')]) {
      for (const target of Object.values(variants)) {
        const seconds = (target as { transition?: { duration?: number } }).transition?.duration ?? 0;
        expect(seconds * 1000).toBeLessThanOrEqual(MAX_UI_DURATION_MS);
      }
    }
  });

  it('removes movement but keeps the fade for reduced motion', () => {
    const still = withoutMovement(enterExit);
    expect(still.initial).toEqual({ opacity: 0 });
    expect(still.enter).toMatchObject({ opacity: 1 });
    expect(still.enter).not.toHaveProperty('y');
    expect(withoutMovement(modal).initial).toEqual({ opacity: 0 });
  });

  it('treats an unknown preference as full motion', () => {
    reducedMotion.value = null;
    const { reduced, variants } = probe();
    expect(reduced).toBe(false);
    expect(variants).toBe(enterExit);
  });

  it('honours a reduced-motion preference with fade-only variants', () => {
    reducedMotion.value = true;
    const { reduced, variants } = probe();
    expect(reduced).toBe(true);
    expect(variants.initial).toEqual({ opacity: 0 });
    expect(variants.exit).not.toHaveProperty('y');
  });

  it('keeps the variants unchanged when motion is allowed', () => {
    reducedMotion.value = false;
    expect(probe()).toEqual({ reduced: false, variants: enterExit });
  });
});
