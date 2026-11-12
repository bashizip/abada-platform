#!/usr/bin/env node
/**
 * A deterministic OpenAI-compatible model for the AI draft workspace e2e run (M5 S12).
 *
 * The engine's authoring service calls it exactly as it calls a real provider
 * (ABADA_LLM_BASE_URL=http://127.0.0.1:<port>/v1), so the run exercises the real
 * CREATE validation and the real REFINE patch mode. Answers are keyed by the request:
 *
 *   CREATE "invoice …"                       → an invoice approval process
 *   REFINE "… manager …"                     → a condition on the amount and a manager approval
 *   REFINE "… supplier …"                    → a supplier notification before the rejected end
 *   REFINE "… two-step …"                    → the finance review renamed (an applied process refined again)
 *   anything else                            → an answer the engine rejects (to show the failed state)
 *
 * Usage: node e2e/stub-authoring-llm.mjs [port]   (default 5612)
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? process.env.STUB_LLM_PORT ?? 5612);

const createProcess = (key, name) => `version: abada.io/v1
metadata:
  key: ${key}
  name: ${JSON.stringify(name)}
  variables:
    - name: amount
      type: number
      required: true
flow:
  entry: received
  nodes:
    - id: received
      type: webhook
      description: Invoice received
      next: review
    - id: review
      type: human-input
      description: Finance review
      assignees: [finance]
      outcomes:
        approve: { next: paid }
        reject: { next: rejected }
    - id: paid
      type: end
      description: Invoice paid
    - id: rejected
      type: end
      description: Invoice rejected
`;

const managerPatch = {
  summary: 'Added a condition on the amount after the finance review and a manager approval above 10,000 EUR.',
  operations: [
    { op: 'addNode', after: 'review', node: {
      id: 'amount_check', type: 'condition', description: 'Amount above 10,000?',
      rules: [{ if: '${amount > 10000}', then: 'manager' }, { else: 'paid', then: 'paid' }],
    } },
    { op: 'addNode', after: 'amount_check', node: {
      id: 'manager', type: 'human-input', description: 'Manager approval', assignees: ['finance-managers'],
      outcomes: { approve: { next: 'paid' }, reject: { next: 'rejected' } },
    } },
    { op: 'updateNode', id: 'review', set: { outcomes: { approve: { next: 'amount_check' }, reject: { next: 'rejected' } } } },
  ],
};

const supplierPatch = {
  summary: 'Added a supplier notification before the rejected end.',
  operations: [
    { op: 'addNode', after: 'manager', node: {
      id: 'notify_supplier', type: 'engine-task', description: 'Notify the supplier', service: 'supplier.notify', next: 'rejected',
    } },
    { op: 'updateNode', id: 'review', set: { outcomes: { approve: { next: 'amount_check' }, reject: { next: 'notify_supplier' } } } },
    { op: 'updateNode', id: 'manager', set: { outcomes: { approve: { next: 'paid' }, reject: { next: 'notify_supplier' } } } },
  ],
};

const renamePatch = {
  summary: 'Renamed the finance review.',
  operations: [{ op: 'updateNode', id: 'review', set: { description: 'Finance review (two-step)' } }],
};

function answer(messages) {
  const user = messages.filter((m) => m.role === 'user').map((m) => String(m.content)).join('\n');
  if (user.startsWith('Request:')) {
    const request = user.slice('Request:'.length).split('\n\n')[0].toLowerCase();
    if (request.includes('manager')) return JSON.stringify(managerPatch);
    if (request.includes('supplier')) return JSON.stringify(supplierPatch);
    if (request.includes('two-step')) return JSON.stringify(renamePatch);
    return '{"operations": [{"op": "removeNode", "id": "no_such_node"}]}';
  }
  // CREATE (or its repair): the engine states the key and name the process must use.
  const key = /metadata\.key must (?:be|remain) exactly "([^"]+)"/.exec(user)?.[1] ?? 'invoice_approval';
  const name = /metadata\.name exactly "((?:[^"\\]|\\.)*)"/.exec(user)?.[1] ?? 'Invoice approval';
  return createProcess(key, name.replace(/\\"/g, '"'));
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url?.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'stub-authoring' }] }));
    return;
  }
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const request = JSON.parse(body || '{}');
    const content = answer(request.messages ?? []);
    console.log(`[stub-llm] ${new Date().toISOString()} answered ${content.length} chars`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: `stub-${Date.now()}`, object: 'chat.completion', model: request.model ?? 'stub-authoring',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }));
  });
}).listen(port, '127.0.0.1', () => console.log(`[stub-llm] listening on http://127.0.0.1:${port}/v1`));
