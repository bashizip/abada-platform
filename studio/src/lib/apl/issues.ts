import type { AplValidationIssue } from '@/api/apl';
import type { SimulationLog, WorkflowNode } from '@/types';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Zero-based line of the YAML source an engine issue points at: the node that
 * declares `id: <elementId>` (block or flow style), refined to the field named
 * by the issue path when that field appears inside the node; otherwise the
 * first line declaring the path's last field. Returns -1 when nothing matches.
 */
export const issueLine = (source: string, issue: Pick<AplValidationIssue, 'elementId' | 'path'>): number => {
  const lines = source.split('\n');
  const field = (issue.path ?? '').split('/').filter((segment) => segment && !/^\d+$/.test(segment)).pop();
  const fieldPattern = field ? new RegExp(`(^|[\\s{,-])${escape(field)}\\s*:`) : null;

  if (issue.elementId) {
    const idPattern = new RegExp(`(^|[\\s{,-])id\\s*:\\s*["']?${escape(issue.elementId)}["']?\\s*($|[,}])`);
    const nodeLine = lines.findIndex((line) => idPattern.test(line));
    if (nodeLine >= 0) {
      if (!fieldPattern || field === 'id' || fieldPattern.test(lines[nodeLine])) return nodeLine;
      const indent = (lines[nodeLine].match(/^\s*-?\s*/) ?? [''])[0].length;
      for (let index = nodeLine + 1; index < lines.length; index++) {
        const line = lines[index];
        if (/^\s*-\s/.test(line) && line.search(/\S/) < indent) break; // next node
        if (line.trim() && line.search(/\S/) < indent - 2) break; // left the node
        if (fieldPattern.test(line)) return index;
      }
      return nodeLine;
    }
  }
  return fieldPattern ? lines.findIndex((line) => fieldPattern.test(line)) : -1;
};

/** Errors first, then warnings, keeping the engine's order within each. */
export const sortIssues = (issues: AplValidationIssue[]): AplValidationIssue[] =>
  [...issues].sort((left, right) => (left.severity === 'ERROR' ? 0 : 1) - (right.severity === 'ERROR' ? 0 : 1));

/** Simulation-log entries for engine issues, titled by the canvas node they name. */
export const issuesToLogs = (
  issues: AplValidationIssue[],
  nodes: Pick<WorkflowNode, 'id' | 'title' | 'type'>[],
  timestamp = new Date().toLocaleTimeString(),
): SimulationLog[] =>
  sortIssues(issues).map((issue, index) => {
    const node = issue.elementId ? nodes.find((candidate) => candidate.id === issue.elementId) : undefined;
    return {
      id: `apl-issue-${Date.now()}-${index}`,
      timestamp,
      nodeId: node?.id ?? 'system',
      nodeTitle: node?.title ?? 'APL Validation',
      nodeType: node?.type ?? 'event',
      status: issue.severity === 'ERROR' ? 'error' : 'warning',
      message: issue.path && issue.path !== '/' ? `${issue.message} (${issue.code}, ${issue.path})` : `${issue.message} (${issue.code})`,
    };
  });

/**
 * The canvas node an engine issue is about: its `elementId` when that is a
 * node, else the node at the issue path's `/flow/nodes/<index>`.
 */
export const issueNodeId = (
  issue: Pick<AplValidationIssue, 'elementId' | 'path'>,
  nodeIds: string[],
): string | null => {
  if (issue.elementId && nodeIds.includes(issue.elementId)) return issue.elementId;
  const match = /^\/flow\/nodes\/(\d+)(\/|$)/.exec(issue.path ?? '');
  return match ? nodeIds[Number(match[1])] ?? null : null;
};

/** Engine issues grouped by the node they are about; issues about no node are left out. */
export const issuesByNode = (issues: AplValidationIssue[], nodeIds: string[]): Map<string, AplValidationIssue[]> => {
  const grouped = new Map<string, AplValidationIssue[]>();
  for (const issue of sortIssues(issues)) {
    const nodeId = issueNodeId(issue, nodeIds);
    if (nodeId) grouped.set(nodeId, [...(grouped.get(nodeId) ?? []), issue]);
  }
  return grouped;
};
