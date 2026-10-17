import { describe, expect, it } from 'vitest';

/**
 * Operations reads its colours from the design tokens (`bg-charcoal`,
 * `text-sand`, `palette.saffron`), never from raw hex literals, so the redesign
 * in later M5 tasks can change the palette in one place.
 */
const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

describe('features/operations colours', () => {
  it('scans the operations sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });

  it('uses design tokens instead of raw hex colours', () => {
    const offences = Object.entries(sources).flatMap(([file, text]) =>
      text.split('\n').flatMap((line, index) =>
        [...line.matchAll(HEX_COLOUR)].map((match) => `${file}:${index + 1} ${match[0]}`)));
    expect(offences, 'Use a token from src/index.css (@theme) or src/lib/tokens.ts').toEqual([]);
  });
});
