import { describe, expect, it } from 'vitest';
import {
  buildJsonTree, containersToLevel, copyableValue, isInside, joinPath, markMasks, MASK_MARK, REDACTION_MASK,
} from './jsonModel';
import { searchJsonTree } from './jsonSearch';
import { treeRows } from './jsonRows';
import { jsonLines, lineText, visibleJsonLines } from './jsonTokenize';

const sample = {
  applicant: { name: 'Dana', address: { city: 'Hamburg', geo: { lat: 53.5 } } },
  items: [{ sku: 'A-1' }, { sku: 'B-2' }, { sku: 'C-3' }],
  meta: { 'x-trace': 'abc', 2024: true },
  email: REDACTION_MASK,
  note: `Call ${REDACTION_MASK} after lunch`,
  upload: { fileId: 'f1', name: 'quote.pdf', contentType: 'application/pdf', size: 2048 },
  empty: {},
  none: null,
};

describe('jsonModel', () => {
  it('builds the exact path of every node', () => {
    const tree = buildJsonTree(sample);
    const paths = tree.all.map((node) => node.path);
    expect(paths).toContain('applicant.address.city');
    expect(paths).toContain('items[2].sku');
    expect(paths).toContain('meta["x-trace"]');
    expect(paths).toContain('meta["2024"]');
    expect(joinPath('', 'odd key')).toBe('["odd key"]');
  });

  it('types masks and file references, and counts values and depth', () => {
    const tree = buildJsonTree(sample);
    expect(tree.byPath.get('email')?.kind).toBe('redacted');
    expect(tree.byPath.get('upload')?.kind).toBe('file');
    expect(tree.byPath.get('upload')?.children).toBeUndefined();
    expect(tree.byPath.get('empty')?.children).toEqual([]);
    expect(tree.maxDepth).toBe(3);
    expect(tree.record).toBe(true);
    expect(tree.values).toBe(tree.all.filter((node) => !node.children).length);
  });

  it('keeps a single value as one root', () => {
    const tree = buildJsonTree([1, 2]);
    expect(tree.record).toBe(false);
    expect(tree.roots.map((node) => node.path)).toEqual(['value']);
    expect(tree.all.map((node) => node.path)).toEqual(['value', 'value[0]', 'value[1]']);
  });

  it('copies a string as text, anything else as JSON, and a mask as nothing', () => {
    const tree = buildJsonTree(sample);
    expect(copyableValue(tree.byPath.get('applicant.name')!)).toBe('Dana');
    expect(copyableValue(tree.byPath.get('items[0]')!)).toBe('{\n  "sku": "A-1"\n}');
    expect(copyableValue(tree.byPath.get('email')!)).toBeNull();
  });

  it('marks inline masks with one character', () => {
    expect(markMasks(`a${REDACTION_MASK}b`)).toBe(`a${MASK_MARK}b`);
    expect(isInside('items[2].sku', 'items')).toBe(true);
    expect(isInside('itemsX', 'items')).toBe(false);
    expect([...containersToLevel(buildJsonTree(sample), 1)]).toEqual(['applicant', 'items', 'meta', 'empty']);
  });
});

describe('jsonSearch', () => {
  it('finds keys and values, opens the ancestors, and never matches a mask', () => {
    const tree = buildJsonTree(sample);
    const search = searchJsonTree(tree, 'HAMBURG')!;
    expect(search.hits.map((node) => node.path)).toEqual(['applicant.address.city']);
    expect([...search.opened].map((id) => tree.all[id].path).sort()).toEqual(['applicant', 'applicant.address']);
    expect(searchJsonTree(tree, '**')!.hits).toEqual([]);
    expect(searchJsonTree(tree, 'quote')!.hits.map((node) => node.path)).toEqual(['upload']);
    expect(searchJsonTree(tree, '  ')).toBeNull();
  });

  it('shows only the matching branches, opened', () => {
    const tree = buildJsonTree(sample);
    const rows = treeRows(tree, {
      expanded: new Set(), openStrings: new Set(), search: searchJsonTree(tree, 'b-2'), charsPerLine: () => 80,
    });
    expect(rows.map((row) => row.node.path)).toEqual(['items', 'items[1]', 'items[1].sku']);
  });

  it('wraps an opened long string into lines without cutting a mask', () => {
    const long = 'x'.repeat(150) + REDACTION_MASK + 'y'.repeat(10);
    const tree = buildJsonTree({ long });
    const rows = treeRows(tree, { expanded: new Set(), openStrings: new Set(['long']), search: null, charsPerLine: () => 50 });
    const wrapped = rows.slice(1).map((row) => row.continuation).join('');
    expect(wrapped).toBe('x'.repeat(150) + MASK_MARK + 'y'.repeat(10));
    expect(wrapped).not.toContain('*');
  });
});

describe('jsonTokenize', () => {
  it('joins back to JSON.stringify(data, null, 2)', () => {
    for (const data of [sample, [1, { a: [] }], 'text', {}]) {
      expect(jsonLines(buildJsonTree(data)).map(lineText).join('\n')).toBe(JSON.stringify(data, null, 2));
    }
  });

  it('numbers lines and folds exactly a range, keeping the comma', () => {
    const tree = buildJsonTree(sample);
    const lines = jsonLines(tree);
    expect(lines.map((line) => line.number)).toEqual(lines.map((_, index) => index + 1));
    const open = lines.findIndex((line) => line.node?.path === 'items');
    const visible = visibleJsonLines(lines, new Set(['items']));
    const folded = visible.find((line) => line.node?.path === 'items')!;
    expect(folded.folded).toEqual({ count: 3, kind: 'array', comma: true });
    expect(visible.length).toBe(lines.length - (lines[open].foldEnd! - open));
    expect(visible[visible.indexOf(folded) + 1].number).toBe(lines[open].foldEnd! + 2);
  });

  it('keeps a container open while a search match is inside it', () => {
    const tree = buildJsonTree(sample);
    const lines = jsonLines(tree);
    const items = tree.byPath.get('items')!;
    expect(visibleJsonLines(lines, new Set(['items']), new Set([items.id])).length).toBe(lines.length);
  });
});
