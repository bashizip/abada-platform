import { describe, expect, it } from 'vitest';

/** The JSON viewer reads its colours from the design tokens (M5 S1), never from raw hex literals. */
const sources = import.meta.glob(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

describe('components/json colours', () => {
  it('uses design tokens instead of raw hex colours', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    const offences = Object.entries(sources).flatMap(([file, text]) =>
      text.split('\n').flatMap((line, index) =>
        [...line.matchAll(HEX_COLOUR)].map((match) => `${file}:${index + 1} ${match[0]}`)));
    expect(offences, 'Use a token from src/index.css (@theme) or src/lib/tokens.ts').toEqual([]);
  });
});
