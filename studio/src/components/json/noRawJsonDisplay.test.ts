import { describe, expect, it } from 'vitest';

/**
 * Every piece of JSON the Studio shows goes through `JsonViewer` (M5 S11):
 * highlighted, searchable, and with masked values as badges. A `<pre>` with
 * `JSON.stringify` output, or a pretty-printed `JSON.stringify(…, null, 2)`
 * outside the places that edit or save JSON, fails this test.
 */
const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/components/json/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Files that pretty-print JSON for something other than display, and why. */
const PRETTY_PRINT_ALLOWED: Record<string, string> = {
  '/src/features/run/DeployDialog.tsx': 'fills the editable payload textarea',
  '/src/features/run/DryRunPanel.tsx': 'fills the editable payload textarea',
  '/src/components/PropertiesInspector.tsx': 'fills the editable output-schema textarea',
  '/src/components/FormPicker.tsx': 'saves a form resource',
  '/src/components/ProjectExplorer.tsx': 'saves a form resource',
  '/src/lib/starter/leadTriage.ts': 'writes the starter form resource',
  '/src/features/operations/instance/useInstanceData.ts': 'exports the execution trace as a file',
};

const PRE_BLOCK = /<pre\b[\s\S]*?<\/pre>/g;
const PRETTY_PRINT = /JSON\.stringify\([\s\S]*?,\s*null,\s*2\s*\)/g;
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

describe('JSON displays', () => {
  it('scans the Studio sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('never renders JSON.stringify output in a <pre>', () => {
    const offences = Object.entries(sources).flatMap(([file, text]) =>
      [...text.matchAll(PRE_BLOCK)]
        .filter((match) => match[0].includes('JSON.stringify('))
        .map((match) => `${file}:${lineOf(text, match.index ?? 0)}`));
    expect(offences, 'Show JSON with <JsonViewer> from src/components/json').toEqual([]);
  });

  it('pretty-prints JSON only to edit or save it', () => {
    const offences = Object.entries(sources)
      .filter(([file]) => !(file in PRETTY_PRINT_ALLOWED))
      .flatMap(([file, text]) => [...text.matchAll(PRETTY_PRINT)].map((match) => `${file}:${lineOf(text, match.index ?? 0)}`));
    expect(offences, 'Show JSON with <JsonViewer>; pretty-print only for editors and saved files').toEqual([]);
  });

  it('keeps the allowlist current', () => {
    const stale = Object.keys(PRETTY_PRINT_ALLOWED).filter((file) => !sources[file]?.match(PRETTY_PRINT));
    expect(stale).toEqual([]);
  });
});
