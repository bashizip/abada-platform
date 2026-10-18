import { describe, expect, it } from 'vitest';
import { issueLine, issueNodeId, issuesByNode, issuesToLogs, metadataIssuesAt, processIssues, sortIssues } from './issues';

const SOURCE = [
  'version: abada.io/v1',          // 0
  'metadata:',                     // 1
  '  key: demo',                   // 2
  '  name: Demo',                  // 3
  'flow:',                         // 4
  '  entry: start',                // 5
  '  nodes:',                      // 6
  '    - id: start',               // 7
  '      type: webhook',           // 8
  '      next: score',             // 9
  '    - id: score',               // 10
  '      type: agent',             // 11
  '      temperature: 3',          // 12
  '      next: done',              // 13
  '    - { id: done, type: end }', // 14
].join('\n');

describe('issueLine', () => {
  it('points at the field inside the node named by the issue', () => {
    expect(issueLine(SOURCE, { elementId: 'score', path: '/flow/nodes/1/temperature' })).toBe(12);
  });

  it('does not borrow the same field from a later node', () => {
    expect(issueLine(SOURCE, { elementId: 'start', path: '/flow/nodes/0/temperature' })).toBe(7);
  });

  it('finds flow-style nodes', () => {
    expect(issueLine(SOURCE, { elementId: 'done', path: '/flow/nodes/2' })).toBe(14);
  });

  it('falls back to the path field for document-level issues', () => {
    expect(issueLine(SOURCE, { path: '/metadata/key' })).toBe(2);
    expect(issueLine(SOURCE, { path: '/' })).toBe(-1);
  });
});

describe('sortIssues', () => {
  it('lists errors before warnings', () => {
    const sorted = sortIssues([
      { code: 'W', severity: 'WARNING', message: 'w' },
      { code: 'E', severity: 'ERROR', message: 'e' },
    ]);
    expect(sorted.map((issue) => issue.code)).toEqual(['E', 'W']);
  });
});

describe('issuesToLogs', () => {
  it('titles entries by their canvas node and keeps document issues on system', () => {
    const logs = issuesToLogs([
      { code: 'ABADA-APL-SCHEMA-001', severity: 'WARNING', message: 'unknown field', path: '/flow/nodes/1/retries', elementId: 'work' },
      { code: 'ABADA-APL-VALIDATION-001', severity: 'ERROR', message: 'metadata.name is required', path: '/metadata/name' },
    ], [{ id: 'work', title: 'Sync CRM', type: 'engine-task' }], '10:00');

    expect(logs.map((log) => [log.status, log.nodeId, log.nodeTitle])).toEqual([
      ['error', 'system', 'APL Validation'],
      ['warning', 'work', 'Sync CRM'],
    ]);
    expect(logs[1].message).toBe('unknown field (ABADA-APL-SCHEMA-001, /flow/nodes/1/retries)');
  });
});

describe('issues by node', () => {
  it('finds the node by element id, else by the node index in the path', () => {
    const ids = ['start', 'draft', 'review'];
    expect(issueNodeId({ elementId: 'review', path: '/flow/nodes/2' }, ids)).toBe('review');
    expect(issueNodeId({ elementId: 'review_e0', path: '/flow/nodes/1/loop' }, ids)).toBe('draft');
    expect(issueNodeId({ path: '/metadata/name' }, ids)).toBeNull();
    const grouped = issuesByNode([
      { code: 'W', severity: 'WARNING', message: 'w', path: '/flow/nodes/1/model' },
      { code: 'E', severity: 'ERROR', message: 'e', elementId: 'draft' },
    ], ids);
    expect(grouped.get('draft')?.map((issue) => issue.code)).toEqual(['E', 'W']);
  });
});

describe('process issues', () => {
  const issues = [
    { code: 'W', severity: 'WARNING' as const, message: 'w', path: '/flow/nodes/1/model' },
    { code: 'V', severity: 'ERROR' as const, message: 'dup', path: '/metadata/variables/2/name' },
    { code: 'K', severity: 'ERROR' as const, message: 'key', path: '/metadata/key' },
    { code: 'E', severity: 'ERROR' as const, message: 'entry', path: '/flow/entry' },
  ];

  it('keeps the issues about no node, errors first', () => {
    expect(processIssues(issues, ['start', 'draft']).map((issue) => issue.code)).toEqual(['V', 'K', 'E']);
  });

  it('matches a metadata field and everything under it, not a field sharing its prefix', () => {
    expect(metadataIssuesAt(issues, 'variables').map((issue) => issue.code)).toEqual(['V']);
    expect(metadataIssuesAt(issues, 'variables', 2).map((issue) => issue.code)).toEqual(['V']);
    expect(metadataIssuesAt(issues, 'variables', 1)).toEqual([]);
    expect(metadataIssuesAt([{ code: 'X', severity: 'ERROR', message: 'x', path: '/metadata/keys' }], 'key')).toEqual([]);
  });
});
