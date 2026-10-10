import * as yaml from 'yaml';
import { ProjectAPI, type ProjectTreeNode } from '@/api/projects';
import type { AgentToolRef } from '@/types';
import { toolRefOf } from '@/types';

/** A tool policy, from the least to the most restrictive. */
export type ToolPolicy = 'read' | 'write' | 'approval_required';
export const POLICY_ORDER: ToolPolicy[] = ['read', 'write', 'approval_required'];

/** One tool a project tool server offers, with the policy its document sets. */
export interface CatalogTool {
  ref: string;
  server: string;
  tool: string;
  policy: ToolPolicy;
  description?: string;
  approvers: string[];
}

/** The tools of a `TOOL_SERVER` document, or null when it is not one (it is checked on save by the engine). */
export function parseToolServer(text: string): CatalogTool[] | null {
  let document: unknown;
  try {
    document = yaml.parse(text);
  } catch {
    return null;
  }
  if (!document || typeof document !== 'object') return null;
  const { name, tools } = document as { name?: unknown; tools?: unknown };
  if (typeof name !== 'string' || !tools || typeof tools !== 'object') return null;
  return Object.entries(tools as Record<string, Record<string, unknown> | null>).flatMap(([tool, entry]) => {
    const policy = entry?.policy;
    if (!POLICY_ORDER.includes(policy as ToolPolicy)) return [];
    return [{
      ref: `${name}/${tool}`,
      server: name,
      tool,
      policy: policy as ToolPolicy,
      description: typeof entry?.description === 'string' ? entry.description : undefined,
      approvers: Array.isArray(entry?.approvers) ? (entry.approvers as unknown[]).map(String) : [],
    }];
  });
}

/** The same policy or a stricter one: a node may tighten a server's policy, never loosen it. */
export const tighterPolicies = (serverPolicy: ToolPolicy): ToolPolicy[] =>
  POLICY_ORDER.slice(POLICY_ORDER.indexOf(serverPolicy));

/** The node's entry for a ref, if bound. */
export const entryFor = (tools: AgentToolRef[], ref: string): AgentToolRef | undefined =>
  tools.find((entry) => toolRefOf(entry) === ref);

/** Binds or unbinds a ref, keeping the order of the others. */
export function bindTool(tools: AgentToolRef[], ref: string, bound: boolean): AgentToolRef[] {
  const others = tools.filter((entry) => toolRefOf(entry) !== ref);
  return bound ? [...others, ref] : others;
}

/**
 * Sets a bound tool's node policy and approvers. The short form `server/tool`
 * is kept when the node only uses the server's policy.
 */
export function setToolPolicy(tools: AgentToolRef[], tool: CatalogTool, policy: ToolPolicy,
  approvers: string[] = []): AgentToolRef[] {
  const effective = POLICY_ORDER.indexOf(policy) < POLICY_ORDER.indexOf(tool.policy) ? tool.policy : policy;
  const groups = effective === 'approval_required' ? approvers.filter((group) => group.trim()) : [];
  const entry: AgentToolRef = effective === tool.policy && groups.length === 0 ? tool.ref
    : { ref: tool.ref, ...(effective !== tool.policy ? { policy: effective } : {}),
      ...(groups.length ? { approvers: groups } : {}) } as AgentToolRef;
  return tools.map((current) => (toolRefOf(current) === tool.ref ? entry : current));
}

/** Why the engine would refuse the node's tool entry, or null. */
export function toolEntryProblem(entry: AgentToolRef, tool: CatalogTool | undefined): string | null {
  if (!tool) {
    return toolRefOf(entry).includes('/')
      ? `${toolRefOf(entry)} is not offered by this project's tool servers.`
      : `${toolRefOf(entry)} names no server: it is advisory and never runs.`;
  }
  const policy = typeof entry === 'string' ? tool.policy : (entry.policy ?? tool.policy);
  const approvers = typeof entry === 'string' ? [] : entry.approvers ?? [];
  if (policy === 'approval_required' && approvers.length === 0 && tool.approvers.length === 0) {
    return `Name who approves ${tool.ref}: its server lists no approvers.`;
  }
  return null;
}

const decode = (base64: string): string => new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));

const toolServerNodes = (nodes: ProjectTreeNode[]): ProjectTreeNode[] => nodes.flatMap((node) => [
  ...(node.kind === 'RESOURCE' && node.status === 'TOOL_SERVER' ? [node] : []),
  ...toolServerNodes(node.children ?? []),
]);

/** Every tool the project's tool servers offer. Documents that do not parse are skipped. */
export async function loadToolCatalog(projectId: string): Promise<CatalogTool[]> {
  const servers = toolServerNodes(await ProjectAPI.tree(projectId));
  const documents = await Promise.all(servers.map((node) => ProjectAPI.getResource(projectId, node.id)
    .then((resource) => parseToolServer(decode(resource.contentBase64)) ?? [])
    .catch(() => [] as CatalogTool[])));
  return documents.flat().sort((a, b) => a.ref.localeCompare(b.ref));
}
