import { describe, expect, it } from 'vitest';
import { issueLine, issuesToLogs, sortIssues } from './issues';

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
