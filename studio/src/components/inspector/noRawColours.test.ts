import { describe, expect, it } from 'vitest';

/**
 * The properties panel, the palette and the node drawings read their colours
 * from the design tokens (`bg-charcoal`, `palette.saffron`), never from raw hex
 * literals (M5 S1, S7).
 */
const sources = import.meta.glob([
  '/src/components/inspector/**/*.{ts,tsx}',
  '/src/components/PropertiesInspector.tsx',
  '/src/components/NodePalette.tsx',
  '/src/features/designer/nodes/*.{ts,tsx}',
  '/src/features/operations/DecisionRuleSummary.tsx',
  '!/src/**/*.test.{ts,tsx}',
], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

describe('properties panel and palette colours', () => {
  it('scans the panel, palette and node sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(15);
  });

  it('uses design tokens instead of raw hex colours', () => {
    const offences = Object.entries(sources).flatMap(([file, text]) =>
      text.split('\n').flatMap((line, index) =>
        [...line.matchAll(HEX_COLOUR)].map((match) => `${file}:${index + 1} ${match[0]}`)));
    expect(offences, 'Use a token from src/index.css (@theme) or src/lib/tokens.ts').toEqual([]);
  });
});
