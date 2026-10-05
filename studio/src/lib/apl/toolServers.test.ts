import { describe, expect, it, vi } from 'vitest';
import { bindTool, parseToolServer, setToolPolicy, tighterPolicies, toolEntryProblem } from './toolServers';

vi.mock('@/api/projects', () => ({ ProjectAPI: {} }));

const document = `
name: payments
transport: streamable-http
url: https://payments.internal/mcp
tools:
  lookup: { policy: read, description: Find an order }
  refund: { policy: approval_required, idempotency: key, approvers: [finance] }
  notify: { policy: write, idempotency: none }
  broken: { policy: delete }
`;

describe('tool server catalog', () => {
  const tools = parseToolServer(document)!;
  const lookup = tools.find((tool) => tool.tool === 'lookup')!;
  const notify = tools.find((tool) => tool.tool === 'notify')!;

  it('lists the tools with their server policy and skips unknown policies', () => {
    expect(tools.map((tool) => [tool.ref, tool.policy])).toEqual([
      ['payments/lookup', 'read'], ['payments/refund', 'approval_required'], ['payments/notify', 'write']]);
    expect(lookup.description).toBe('Find an order');
    expect(tools[1].approvers).toEqual(['finance']);
    expect(parseToolServer('not: [a, tool, server')).toBeNull();
  });

  it('only tightens a policy and keeps the short form when nothing changes', () => {
    expect(tighterPolicies('write')).toEqual(['write', 'approval_required']);
    let bound = bindTool(['crm/get'], 'payments/notify', true);
    expect(bound).toEqual(['crm/get', 'payments/notify']);
    bound = setToolPolicy(bound, notify, 'approval_required', ['support']);
    expect(bound[1]).toEqual({ ref: 'payments/notify', policy: 'approval_required', approvers: ['support'] });
    bound = setToolPolicy(bound, notify, 'read');      // loosening is not possible
    expect(bound[1]).toBe('payments/notify');
    expect(bindTool(bound, 'payments/notify', false)).toEqual(['crm/get']);
  });

  it('names what the engine would refuse', () => {
    expect(toolEntryProblem({ ref: 'payments/notify', policy: 'approval_required' }, notify)).toContain('approves');
    expect(toolEntryProblem('payments/refund', tools[1])).toBeNull();
    expect(toolEntryProblem('web_search', undefined)).toContain('advisory');
    expect(toolEntryProblem('crm/gone', undefined)).toContain('not offered');
  });
});
