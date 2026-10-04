# M3 — Agents that act: task specifications

- Milestone: M3 (2026-11-09 → 2026-11-27), release `1.1.0-rc.2`
- Roadmap: [`roadmap.md`](roadmap.md)
- Audience: human contributors and coding agents. Execute one task per branch/PR.
  Read `AGENTS.md` first; its runtime invariants override anything here.

Every task lists **Goal**, **Files**, **Changes**, **Acceptance tests**,
**Invariants**, and **Out of scope**, as in [`m2-task-specs.md`](m2-task-specs.md).
`ENGINE` means `engine/src/main/java/com/abada/engine`, `ENGINE_TEST` means
`engine/src/test/java/com/abada/engine`, `WORKER` means
`agent-worker/src/main/java/io/abada/agent`, `SDK` means
`sdk/java/src/main/java/io/abada/worker`.

## Starting point

What exists at the end of M2 and what M3 changes:

- APL agent `tools:` is a list of strings. The worker checks them against
  `ABADA_AGENT_ALLOWED_TOOLS` and names them in the system prompt; nothing
  executes a tool. M3 makes tools real, resolved and governed.
- An agent attempt is one model call. Its metadata (model, tokens, prompt hash,
  confidence) is one JSON column, `external_tasks.agent_metadata` (V15). M3
  adds a multi-turn loop with a durable per-step journal.
- Lease idempotency keys name the lease (E4). That is right for model calls and
  wrong for writes: a write must keep its key across leases.
- Project resources have kinds `FORM` and `RESOURCE` (V13). AI provider keys are
  encrypted with `AesEncryption` under `ABADA_ENCRYPTION_KEY` (V22).
- Tokens (E2), incidents (E3), boundaries and durable timeout jobs (E4) and the
  review primitive (E5) are the machinery M3 builds on. No new execution model.
- Studio polls (instance detail, incidents, worker health).
- No call-process. BPMN `callActivity` is rejected and stays rejected.
- The last migration is `V26__boundaries.sql`. The numbers below are
  provisional: take the next free number when the branch merges into `dev`.

## Order of work and dependencies

```
E7 tool registry ──► E8 tool loop ──► E9 journal ──► E10 approvals ──► E20 agent-proposed delegation
                                        │                                   ▲
                                        └──► E11 evidence and cost          │
E20a call-process (engine only, starts week 1) ─────────────────────────────┘
E13 routing agents (independent)        E12 Studio (last, consumes all)
```

| Week | Work |
| --- | --- |
| 11-09 | E7; E9 engine side (table, endpoint, rules); E20a call-process; E11 price table |
| 11-16 | E8; E9 worker resume; E10; E11 retention and redaction; E13 |
| 11-23 | E20b agent-proposed delegation; E12; exit demo; gate report |

Cut order (roadmap): E13, E12 SSE (keep polling), then E20b (keep E20a).
E9 and E10 are never cut.

## Contract decisions taken in this plan

These shape several tasks. Change them here before implementation starts,
not in a PR.

1. **The worker owns MCP; the engine owns policy.** The engine never opens a
   connection to a tool server. It resolves, snapshots and enforces policy on
   every journaled step; the worker cannot run a step the engine refused.
2. **Streamable HTTP only.** No `stdio` tool servers in 1.1: spawning local
   processes from a worker is a separate security review.
3. **Writes are keyed per step, not per lease.** The key is derived from the
   external task id, the attempt and the step sequence, so a resumed lease
   sends the same key.
4. **An unknown write outcome goes to a human.** If the worker crashed after
   starting a write and the tool does not accept an idempotency key, the write
   is never re-sent. The step becomes `OUTCOME_UNKNOWN` and opens an incident.
   External side effects stay at-least-once only where a key proves otherwise.
5. **Approvals bind the exact arguments.** The human approves a digest of the
   proposed call. Editing arguments in the approval is out of scope.
6. **Evidence defaults to `redacted`, with payloads encrypted.** Digests,
   tokens, cost, timings and actors are kept for the life of the instance.
   Payloads are purged after `retention_days`.
7. **Child process versions are pinned at deployment.** Redeploy the parent to
   pick up a new child version, as with every other definition change.
8. **Delegation is a tool.** An agent delegates by calling an engine-provided
   `delegate:<process>` tool inside its loop. Its external task waits, as for
   an approval, and the agent continues with the child's outputs as the tool
   result. No second suspension mechanism.

## E7 — Tool registry ✅ done

**Goal.** A tool an agent may use is declared once per project with its
server, its contract and its policy. Deployment resolves it and freezes it into
the definition version, so changing the registry never changes a running
instance.

**Files.** `engine/src/main/resources/db/migration/V27__tool_registry.sql`,
`ENGINE/persistence/entity/{ProjectResourceEntity,ProcessDefinitionEntity}.java`,
`ENGINE/tools/{ToolServerDocument,ToolRegistryService,ToolBinding,ToolPolicy}.java` (new),
`ENGINE/parser/{AplParser,AplVariables}.java`, `ENGINE/core/model/AgentWorkDescriptor.java`,
`ENGINE/api/{ProjectResourceController,WorkerController}.java`,
`ENGINE/apl/AplContractService.java`, `engine/src/main/resources/apl/apl-v1.schema.json`,
`engine/src/main/resources/apl/tool-server-v1.schema.json` (new),
`SDK/{AgentWorkDescriptor,ToolBinding,AbadaWorkerClient}.java`,
`studio/src/lib/apl/types.generated.ts`, `studio/src/features/workspace/` (resource editor).

**Changes.**
- Resource kind `TOOL_SERVER` (V27 widens `ck_project_resource_kind`). Content
  is YAML validated against `tool-server-v1.schema.json`:
  ```yaml
  name: crm
  transport: streamable-http
  url: https://crm-mcp.internal/mcp
  credential: crm-mcp-token        # secret name, never the value
  tools:
    get_customer:   { policy: read }
    create_ticket:  { policy: write, idempotency: key }
    refund_payment: { policy: approval_required, idempotency: key, approvers: [finance] }
  ```
  `policy` is `read`, `write` or `approval_required`. A tool not listed is
  denied. `idempotency` is `key` (the server accepts an idempotency key) or
  `none`; it is required for `write` and `approval_required`.
- Tool-server credentials are stored like AI provider keys (encrypted,
  write-only API, rotated by re-saving) and served to authenticated workers by
  a credentials endpoint next to the AI provider one. Never in the definition,
  the descriptor, history or logs.
- APL: `tools:` entries are `<server>/<tool>` or
  `{ ref: <server>/<tool>, policy: <stricter> }`. A node may tighten a policy
  (`write` → `approval_required`), never loosen it. Bare names from rc.x are an
  `ABADA-APL-TOOL-001` warning (advisory only, never executed); they become an
  error at 1.1.0.
- Deployment resolves every ref against the project's `TOOL_SERVER` resources.
  An unknown server or tool, or a loosened policy, is an `ABADA-APL-TOOL-002`
  error at its node path. The resolved bindings (server URL, tool, effective
  policy, idempotency, approvers, resource id and revision) are stored in
  V27 `process_definitions.tool_bindings` and served in the agent descriptor
  as `toolBindings`. `POST /v1/apl/validate` resolves the same way.
- The worker allow-list (`ABADA_AGENT_ALLOWED_TOOLS`) becomes an allow-list of
  servers: deployment cannot widen what an operator allowed a worker to reach.
- Studio: a `TOOL_SERVER` editor with schema validation in the Resources tree.
  The agent tools picker is in E12.

**Acceptance tests.**
- `ToolRegistryServiceTest`: valid document; unknown fields, missing
  `idempotency` on a write, duplicate tool names and non-HTTPS URLs outside
  `dev` are rejected with paths.
- `AplParserTest` / `AplToolResolutionTest`: resolution of both forms; tightened
  policy kept; loosened policy, unknown server and unknown tool rejected; a bare
  name warns.
- `PostgresToolBindingImmutabilityTest`: deploy, start an instance, edit the
  resource (policy `read` → `write`), and the running instance's descriptor
  still carries the old binding; a new deployment picks up the change.
- `ToolCredentialApiTest`: the secret is never returned or logged; unauthorized
  roles get `403`; a worker without the server in its allow-list gets nothing.
- `PostgresSchemaUpgradeTest` (V1–V26 → V27), `AplSchemaConformanceTest`,
  `OpenApiContractTest`.

**Invariants.** Bindings are immutable per definition version. The engine
makes no network call to a tool server. Secrets live only in the encrypted
store.

**Out of scope.** `stdio` transport; tool discovery from Studio (listing a
server's tools live); per-tool rate limits; sharing tool servers across
projects.

**As built.** Tests: `ToolServerDocumentTest`, `AplToolReferenceTest`
(parser forms and the advisory warning), `PostgresToolRegistryTest`
(PostgreSQL: save-time validation and unique server names, resolution errors
at their paths, validate with a `projectId`, frozen bindings across a resource
edit, write-only credentials and lease-holder issuance),
`SecurityAuthorizationContractTest` (credential endpoints: missing, forged,
invalid and expired credentials, human administrators and operators refused,
non-members get `404`), `PostgresSchemaUpgradeTest` (V1–V26 → V27, fresh),
`PostgresTokenUpgradeTest`, SDK `AbadaWorkerClientTest`, worker
`AgentWorkerMainTest`, Studio `parser.test.ts`.

**Deviations from the plan.**
- `ToolBinding` and `ToolPolicy` live in `ENGINE/core/model` next to the
  descriptor; the `tools` package holds `ToolServerDocument`,
  `ToolRegistryService` and `ToolCredentialService`.
- Credentials are issued per task, not per worker:
  `GET /v1/external-tasks/{id}/tool-credentials/{server}?workerId=` answers
  only the worker holding that task's live lease, and only for a server the
  task is bound to. Managed with `PUT/GET/DELETE
  /v1/projects/{projectId}/tool-credentials/{name}` (V27 `tool_credentials`).
- A redeploy of an unchanged source whose resolved bindings changed creates a
  new version; the checksum alone no longer decides.
- `ABADA_AGENT_ALLOWED_TOOLS` keeps its name: a `<server>/<tool>` reference is
  allowed when its server (or the exact reference) is listed.
- `POST /v1/apl/validate` resolves tools only when the request names a
  `projectId` (deployment always resolves).
- Studio: `TOOL_SERVER` is a kind in the new-file dialog of the project
  explorer, with the engine's validation errors shown on save; a dedicated
  editor, the tools picker, and replacing the inspector's placeholder tool
  list move to E12.

## E8 — Tool loop in the worker

**Goal.** An agent can call its resolved tools over several turns and stops
inside declared limits. Its final answer still goes through the engine's
output contract.

**Files.** `WORKER/{AgentGateway,AbstractAgentGateway,OpenAiCompatibleGateway,GoogleGeminiGateway,AgentWorkerMain}.java`,
`WORKER/loop/{AgentLoop,LoopBudget,ToolExecutor}.java` (new),
`WORKER/mcp/{McpToolClient,McpSessionPool}.java` (new), `agent-worker/pom.xml`,
`ENGINE/parser/AplParser.java`, `engine/src/main/resources/apl/apl-v1.schema.json`,
`SDK/AgentWorkDescriptor.java`.

**Changes.**
- APL agent limits: `max_turns` (default 8, maximum 32), `max_tokens_total`
  (default 50 000), `budget_usd` (optional). Served in the descriptor.
- Gateways gain native tool calling for the OpenAI-compatible and Gemini
  families. One turn = one model call plus the tool calls it requested.
- MCP client over streamable HTTP. Use the official MCP Java SDK if it fits
  Java 21 without pulling a second HTTP stack; otherwise a minimal JSON-RPC
  client covering `initialize`, `tools/list` and `tools/call`. Record the
  choice and its licence in the PR.
- Before the first call the worker runs `tools/list` and compares each bound
  tool's input schema with the server's. A missing tool or changed schema is a
  non-retryable `TOOL_CONTRACT_MISMATCH` failure (routable by `on_error`).
- Only bound tools are offered to the model. A call to anything else,
  including a tool named in a tool result, is refused and reported to the model
  as an error turn.
- Tool results are data. They are size-capped (64 KiB each, configurable),
  wrapped as tool output and never merged into the system prompt. They cannot
  change bindings, policy or limits.
- Every model call and tool call is journaled through E9 before and after it
  runs. The loop runs only steps the engine accepted.
- Hitting a limit fails the attempt with `AGENT_BUDGET_EXHAUSTED`
  (non-retryable, routable). `budget_usd` uses the E11 prices served in the
  descriptor; an unpriced model with a budget fails closed.

**Acceptance tests.**
- `AgentLoopTest` (stub model + stub MCP server): read-tool round trip; stop at
  `max_turns`, at `max_tokens_total` and at `budget_usd`; an unbound tool
  request is refused; an oversized result is truncated and marked.
- `McpToolClientTest`: initialize, list, call, server errors, timeouts as
  availability errors; schema mismatch fails closed.
- `PromptInjectionTest`: a tool result that asks the model to call an unbound
  tool, or to change the result variable, has no effect.
- Existing `AgentWorkerRunnerTest` and fallback/deferral tests green: a
  rate-limited turn defers the attempt and keeps the journal.

**Invariants.** The model runs outside every engine transaction. The final
result is still validated by `AgentOutputValidator`; the worker decides nothing.

**Out of scope.** Parallel tool calls in one turn (run them in order);
streaming model output; MCP resources, prompts and sampling.

## E9 — Journaled steps ✱ never cut (engine side ✅ done; worker resume with E8)

**Goal.** Every model and tool call is a durable step. After a crash or a lost
lease the agent resumes after the last committed step: a completed model turn
is not paid for twice and a write is not sent twice.

**Files.** `engine/src/main/resources/db/migration/V28__agent_steps.sql`,
`ENGINE/persistence/entity/AgentStepEntity.java`,
`ENGINE/persistence/repository/AgentStepRepository.java`,
`ENGINE/core/agent/{AgentStepService,StepPolicy}.java` (new),
`ENGINE/core/ExternalTaskCommandService.java`, `ENGINE/api/ExternalTaskController.java`,
`ENGINE/dto/{AgentStepRequest,AgentStepDto}.java`,
`SDK/{AbadaWorkerClient,LockedExternalTask,AgentStep}.java`,
`WORKER/loop/AgentLoop.java`, `docs/reference/external-worker-protocol-v1.md`.

**Changes.**
- V28 `agent_steps`: id, external task, instance, token, activity, attempt,
  sequence (unique per task and attempt), kind (`MODEL_CALL`, `TOOL_CALL`,
  `DELEGATION`), tool ref, effective policy, state (`STARTED`, `COMPLETED`,
  `FAILED`, `PROPOSED`, `APPROVED`, `REJECTED`, `OUTCOME_UNKNOWN`),
  idempotency key, request digest, result digest, encrypted payload columns
  (E11), model, prompt version, tokens, cost, actor, timestamps. Index on
  `(external_task_id, attempt, sequence)`.
- `POST /v1/external-tasks/{id}/steps` (protocol v1, additive). Only the lease
  holder may call it. The engine, in one short transaction that locks the
  external-task row and never the instance:
  - accepts sequence `last + 1`, or replays an identical request (same digest)
    idempotently, and returns `409` otherwise;
  - refuses a tool outside the definition's bindings, a policy breach
    (`approval_required` without an approved step), and anything past
    `max_turns`, `max_tokens_total` or `budget_usd`. The engine is
    authoritative here; the worker's checks in E8 are only an early stop;
  - computes the write key as
    `sha256(externalTaskId:attempt:sequence)`, returns it, and the worker sends
    it with the tool call;
  - returns `410` once the work is retired (cancel, timeout boundary).
- `fetch-and-lock` returns the attempt's committed steps (digests and
  results, never another attempt's payloads). The worker rebuilds the
  conversation from them and continues:
  - completed steps are reused, not re-run;
  - a `STARTED` read step is re-run;
  - a `STARTED` write with `idempotency: key` is re-sent with the same key;
  - a `STARTED` write with `idempotency: none` is not re-sent. It becomes
    `OUTCOME_UNKNOWN` and an `TOOL_OUTCOME_UNKNOWN` incident opens on the
    token; retrying the incident asks the operator to confirm the outcome
    first.
- A new attempt after a counted failure starts a new conversation. Completed
  writes from earlier attempts are given to the model as already done; an
  identical write (same tool and argument digest) returns the recorded result.
- Limits: 256 steps per external task; 1 MiB per step payload.

**Acceptance tests.**
- `PostgresAgentStepJournalTest`: sequence gaps and divergent replays `409`;
  identical replay is idempotent; a non-holder `403`; retired work `410`;
  budget, turn and policy refusals; two replicas posting the same step
  produce one row.
- `PostgresAgentResumeTest` (the exit-demo core): kill the worker after the
  write was journaled `STARTED`, then after it `COMPLETED`; kill the engine
  between both; the stub tool server records exactly one effective write in
  every case; no completed model turn is re-billed.
- `UnknownOutcomeTest`: an `idempotency: none` write interrupted mid-call is not
  re-sent and opens the incident; retry requires a confirmed outcome.
- `PostgresSchemaUpgradeTest` (→ V28), `PostgresTokenUpgradeTest`, protocol
  contract tests, SDK `AbadaWorkerClientTest` (steps on lock; unknown fields).

**Invariants.** Recording a step never advances the process and never holds
the instance lock. Steps are append-only; only their state moves forward.
No remote call inside the step transaction.

**Out of scope.** Journaling for non-agent external workers (the SDK exposes
the endpoint, the first-party worker is the only user in 1.1); compensation of
completed writes.

**As built (engine side).** V28 adds `external_tasks.attempt` and
`agent_steps`; `AgentStepService` records steps under the external-task row
lock only, and fetch-and-lock returns `attempt`, `steps` and `priorWrites`.
Tests: `PostgresAgentStepJournalTest` (PostgreSQL: sequence, replay and
lease-holder rules; tool policies; a keyed write resumed across a lost lease
and an engine restart takes effect once; an unkeyed interrupted write opens
`TOOL_OUTCOME_UNKNOWN` and resumes only after the operator confirms its
outcome; a later attempt reuses an identical completed write; retired work
`410`; concurrent identical posts journal one row; payloads encrypted at
rest), `SecurityAuthorizationContractTest` (steps endpoint), the schema and
token upgrade tests (→ V28), SDK `AbadaWorkerClientTest`, Studio
`IncidentsPanel.test.tsx`.

**Deviations from the plan.**
- The engine, not the worker, marks an interrupted unkeyed write
  `OUTCOME_UNKNOWN`, when the task would be locked again; the task stops
  (`FAILED`) and is never handed out. Retrying the incident takes
  `toolOutcome: PERFORMED | NOT_PERFORMED` and resumes the same attempt; a job
  retry is refused while such a step is open. Studio offers **It happened** /
  **It did not happen** on the incident.
- Model calls and read tools may be journaled already finished in one call;
  writes must be journaled `STARTED` first (`WRITE_AHEAD_REQUIRED`).
- An identical write (same tool, same request digest) in a later attempt is
  answered from the journal with `reused: true` instead of being re-sent.
- Refusals use typed codes: `AGENT_STEP_REJECTED` with `details.reason`, and
  `WORK_RETIRED` (`410`).
- `max_turns`, `max_tokens_total` and `budget_usd` are refused at step time
  when E8 adds them to APL (and E11 the prices); E9 enforces the step and
  payload limits and the tool policy.
- Step payloads are AES-GCM encrypted from the start; the evidence policy
  (redaction modes, retention) is E11.
- The worker side (rebuilding the conversation from `steps`) lands with the
  E8 loop, which is the first worker code that journals steps.

## E10 — Approval-required tools ✱ never cut

**Goal.** When an agent wants to use an `approval_required` tool, the agent
stops, a person sees exactly what it proposes, and the write happens only
after that person approves.

**Files.** `engine/src/main/resources/db/migration/V29__tool_approvals.sql`,
`ENGINE/core/agent/{AgentStepService,ToolApprovalService}.java`,
`ENGINE/core/{ExternalTaskCommandService,TaskManager,AbadaEngine}.java`,
`ENGINE/persistence/entity/{TaskEntity,ExternalTaskEntity}.java`,
`ENGINE/api/{TaskController,ProjectTaskController}.java`,
`ENGINE/dto/{TaskDetailsDto,ToolApprovalDto}.java`,
`studio/src/features/inbox/{TaskInbox.tsx,ToolApprovalCard.tsx}`, `studio/src/api/engine.ts`.

**Changes.**
- The worker posts the proposed call as a `PROPOSED` step. In the same command
  the engine sets the external task to `AWAITING_APPROVAL` (no lease, not
  acquirable), creates a human task of kind `TOOL_APPROVAL` linked to the step
  (V29: `tasks.kind`, `tasks.agent_step_id`), with candidate groups from the
  binding's `approvers` (default: the node's `escalate_to`, else deployment
  fails with `ABADA-APL-TOOL-003`), and emits `TOOL_APPROVAL_REQUESTED` through
  the outbox. The worker returns the slot.
- The approval task reuses the E5 decision primitive with fixed outcomes
  `approve` and `reject` (reject comment required). It shows the tool, its
  server, the agent's identity and the arguments rendered under the evidence
  policy, plus the argument digest the decision binds to.
- Deciding locks the external task, then the step. Approve: the step becomes
  `APPROVED` with actor and time, and the work is acquirable again. Reject: the
  step becomes `REJECTED` and the agent resumes with the rejection and comment
  as the tool result. Both are history entries with actor, action, trace id.
- On resume the worker executes only the approved arguments; the engine
  refuses a `TOOL_CALL` whose digest differs from the approved one.
- The token stays parked on the agent node throughout. Its `on_timeout`
  boundary and cancel still work and retire the approval task.
  `approval_sla_hours` on the binding escalates like E4's SLA.
- Authorization: approvers must hold the group; the project role that may run
  the process is not enough. An approval cannot be decided by a worker
  credential.

**Acceptance tests.**
- `PostgresToolApprovalTest`: proposal → task in the right groups → approve →
  exactly one write; reject → the agent revises → completes; an engine restart
  while waiting; a timeout boundary while waiting retires the task; cancel
  retires it; a changed argument after approval is refused.
- `ToolApprovalSecurityTest`: a user outside the group `404`s, a worker token
  `403`s, expired and forged credentials `401`.
- Studio `ToolApprovalCard.test.tsx`, `decision.test.ts`.

**Invariants.** Nothing writes without an approved step. The human task is
not a process node and does not move the token. Approval and the write are
separate commands; the write happens in the worker, outside any transaction.

**Out of scope.** Editing arguments before approving; multi-approver
sign-off; approving a whole class of calls in advance.

## E11 — Evidence and cost

**Goal.** An auditor can read what every agent did and what it cost, and a
security officer can be sure the evidence store neither leaks secrets nor
grows forever.

**Files.** `engine/src/main/resources/db/migration/V30__evidence_and_prices.sql`,
`ENGINE/core/agent/{EvidencePolicy,EvidenceRedactor,AgentStepService}.java`,
`ENGINE/core/{JobScheduler}.java` (retention job kind),
`ENGINE/llm/{ModelPriceService,ModelPrice}.java` (new),
`ENGINE/api/{ModelPriceController,ProjectOperationsController,CockpitController}.java`,
`ENGINE/observability/` (cost meter), `ENGINE/security/AesEncryption.java`,
`studio/src/features/admin/ModelPrices.tsx`, `studio/src/features/operations/instanceTelemetry.tsx`.

**Changes.**
- Evidence policy per project with a stricter-only node override:
  `evidence: { payloads: none | redacted | full, retention_days }`. Default
  `redacted`, 30 days. `redacted` removes `SecretRedactor` patterns and the
  variable paths declared `sensitive: true` in `metadata.variables`.
- Payloads (model messages, tool arguments and results) are encrypted with
  `AesEncryption`; digests, tokens, cost, timings, model, prompt version and
  actors are plain and are kept with the instance.
- A durable `EVIDENCE_PURGE` job clears payloads past retention and records a
  `EVIDENCE_PURGED` history entry. Digests stay, so the audit chain survives.
- Reading payloads needs a new `agent-evidence:read` permission, separate from
  operations view. Every payload read is audited.
- V30 `model_prices` (provider, model, input and output price per million
  tokens, currency `USD`, effective from). Admin API and Studio Admin page.
  The engine computes each step's cost when it is recorded, from the tokens
  and the price in effect, never from a worker-reported amount. An unknown
  price stores `null` and an `unpriced` flag, never 0.
- Instance cost and token totals on the instance detail and list; a
  `abada_agent_cost_usd_total` counter tagged by process key and model only.
- Prices for the node's models are served in the descriptor for E8's budget.

**Acceptance tests.**
- `EvidencePolicyTest`: each mode; stricter-only override; a secret in a tool
  result never reaches the table in clear (inspect the raw column).
- `PostgresEvidenceRetentionTest`: purge after retention, digests kept, purge
  survives a restart and runs once across two replicas.
- `ModelPriceTest`: price changes apply only from their effective time;
  unpriced steps; instance sum.
- `EvidenceAccessSecurityTest`: operations viewers see digests not payloads;
  reads are audited; negative auth cases.
- `PostgresSchemaUpgradeTest` (→ V30).

**Invariants.** No prompt, secret or sensitive value in logs, history or
outbox payloads. Key rotation re-encrypts step payloads like provider keys.

**Out of scope.** Cost alerts and quotas per project (M4 E14 signals);
non-USD currencies; exporting evidence bundles.

## E12 — Studio: live events and agent-step inspector

**Goal.** An operator watches an agent work in real time and can see every
turn, tool call, approval, cost and delegation without reading logs.

**Files.** `ENGINE/api/ProjectEventStreamController.java` (new),
`ENGINE/core/OutboxStreamService.java` (new), `ENGINE/security/SecurityConfig.java`,
`studio/src/api/eventStream.ts` (new), `studio/src/hooks/useLiveInstanceOverlay.ts`,
`studio/src/features/operations/{InstanceDetailView,AgentStepInspector,LineageBreadcrumbs}.tsx`,
`studio/src/components/inspector/AgentToolsEditor.tsx`.

**Changes.**
- `GET /v1/projects/{projectId}/events/stream` (Server-Sent Events). Each
  replica tails committed outbox rows by id, so any replica serves any client;
  `Last-Event-ID` resumes; a heartbeat every 15 s; events filtered by project
  permission and carrying ids only, never payloads.
- Studio subscribes where it polls today and falls back to polling when the
  stream fails. Polling stays the default if SSE is cut.
- Agent-step inspector on the instance detail: turns and tool calls in order,
  policy badges, approval state and decider, `OUTCOME_UNKNOWN` highlighted,
  tokens and cost per step and in total, payloads behind
  `agent-evidence:read`.
- Designer: agent tools picker from the project's tool servers (policy shown,
  tighten only), limits (`max_turns`, `max_tokens_total`, `budget_usd`),
  `routes` (E13), `delegates` (E20b), call-process node (E20a).

**Acceptance tests.** `ProjectEventStreamTest` (resume from id, permission
filter, two replicas, no payload); Studio `eventStream.test.ts` (reconnect,
fallback), `AgentStepInspector.test.tsx`, `parser.test.ts` round trips for
every new APL field; browser check of the exit demo in Studio.

**Out of scope.** SSE for tasks and inbox; replaying an agent run in the UI.

## E13 — Routing agents

**Goal.** An agent may choose the next step, but only among routes the process
declares, and the engine checks the choice.

**Files.** `ENGINE/core/model/{BoundaryMeta,AgentRouteMeta}.java`,
`ENGINE/parser/{AplParser,AplVariables}.java`,
`ENGINE/core/agent/AgentOutputValidator.java`, `ENGINE/core/ExternalTaskCommandService.java`,
`engine/src/main/resources/apl/apl-v1.schema.json`, `studio/src/lib/apl/{parser,routes}.ts`.

**Changes.**
- APL: `routes: { <name>: { next, description, when? } }` on an agent node
  (2–8 routes, no node-level `next`). Each compiles to a boundary of kind
  `ROUTE`, so back-edges and loop bounds apply.
- The engine adds a required `route` enum to the node's output contract. An
  undeclared route is invalid output (`on_invalid_output`); low confidence
  goes to `on_low_confidence` as before. An optional CEL `when` is evaluated by
  the engine and can veto a route (then `on_invalid_output`).
- `<id>_route` is written and `ROUTE_TAKEN` recorded with the confidence.

**Acceptance tests.** `AplParserTest` (bounds, `next` conflict, CEL check),
`AplRoutingRuntimeTest` (PostgreSQL: each route, undeclared route, vetoed
route, low confidence, back-edge with a loop bound), Studio `routes.test.ts`.

**Out of scope.** Multiple routes at once (fork by agent).

## E20 — Governed delegation

**Goal.** A process can start a governed child process and continue with its
result. An agent can propose that delegation, but only to declared targets,
with checked inputs and, when required, a human's approval. Lineage is visible
and a crash neither duplicates nor orphans a child.

Split into **E20a call-process** (never cut within E20) and **E20b
agent-proposed delegation** (cut before E9/E10).

**Files.** `engine/src/main/resources/db/migration/V31__call_process.sql`,
`ENGINE/core/model/{CallProcessMeta,DelegationMeta}.java`,
`ENGINE/parser/{AplParser,AplVariables,DeploymentValidator}.java`,
`ENGINE/core/{AbadaEngine,ProcessInstance,JobScheduler,TimerJobCommandService}.java`,
`ENGINE/core/delegation/{CallProcessService,ChildCompletionJob}.java` (new),
`ENGINE/persistence/entity/ProcessInstanceEntity.java`,
`ENGINE/api/{ProcessController,CockpitController}.java` (lineage),
`WORKER/loop/AgentLoop.java`, `studio/src/features/operations/LineageBreadcrumbs.tsx`.

**Changes (E20a call-process).**
- APL node `call-process`: `process: <key>`, `inputs: { child_var: <CEL> }`,
  `outputs: { parent_var: child_var }` (default-deny: nothing else returns),
  `on_error`, `on_timeout`. The child version is resolved and pinned at
  deployment. Inputs are checked against the child's `metadata.variables`
  types at deployment where static, at runtime otherwise.
- V31: `process_instances.parent_instance_id`, `parent_token_id`,
  `root_instance_id`, `depth`, `started_by` (JSON agent identity or null);
  index on parent and root. `max_depth` is a global setting (default 4) with
  a stricter per-node override.
- Start: in the parent's command the token parks `WAITING` and the child
  instance is created in the same transaction. Lock order is always parent
  before child.
- Completion: the child's final command enqueues a durable
  `CHILD_COMPLETED` job keyed by the parent token. The job locks the parent,
  maps outputs and moves the token; it is idempotent by parent token id. A
  failed child fires the parent's `on_error` or opens a `CHILD_FAILED`
  incident.
- Cancel and fail cascade to running children through the same job path.
  Parent timeouts cancel the child.
- History: `CHILD_STARTED` / `CHILD_COMPLETED` on both sides with both ids.
  `GET .../instances/{id}/lineage` returns ancestors and children.

**Changes (E20b agent-proposed delegation).**
- Agent `delegates: [{ process, approval: required | none }]`. Each becomes an
  engine-provided tool `delegate:<process>` in the E8 loop, with the child's
  declared variables as its input schema.
- The worker journals a `DELEGATION` step. The engine checks the declared
  target, validates the inputs against the schema, checks depth, applies
  `approval: required` through E10, then starts the child as in E20a with
  `started_by` set. The external task waits as in E10.
- When the child completes, its outputs become the step's result, the work is
  acquirable again and the agent continues.
- Agent identity (node id, definition version, prompt version, model) is on
  every step, every delegation and the child's `started_by`.

**Acceptance tests.**
- `AplCallProcessParserTest`: unknown process, unpinnable version, cycles
  between definitions, depth, undeclared outputs.
- `PostgresCallProcessTest`: happy path; child failure → `on_error` and
  incident; parent cancel cascades; parent timeout cancels the child; depth
  limit.
- `PostgresCallProcessCrashTest` (exit-demo core): kill the engine after the
  child is created, after it completes and before the parent resumes, and
  during the resume job; exactly one child, the parent resumes once, no
  orphan.
- `PostgresAgentDelegationTest`: undeclared target refused; invalid inputs
  refused; approval required → approve → child → agent resumes with the
  result; lineage and `started_by` correct.
- `PostgresSchemaUpgradeTest` (→ V31), `OpenApiContractTest`.

**Invariants.** Parent and child are separate instances with their own locks
and versions; nothing is shared in memory. Delegation never bypasses the
child's deployment, RBAC or contract.

**Out of scope.** BPMN `callActivity` import; calling a process in another
project; dynamic (expression-chosen) targets; E21 for-each.

## Cross-cutting work

- **Documentation** in the same PRs: `apl-specification.md`,
  `apl-node-reference.md` (tools, limits, routes, call-process, delegates,
  evidence), `runtime-semantics.md` (steps, resume, unknown outcomes,
  approvals, child lifecycle), `external-worker-protocol-v1.md` (steps,
  approvals, credentials), `runtime-state.md` (new tables and lock order), a
  security note on tool credentials and evidence, and the Starlight guide.
- **Examples:** `examples/apl/m3-refund-agent.yaml` (read tool, approval-required
  write, delegation to `m3-fraud-check.yaml`) plus a stub MCP server under
  `scripts/dev/` for the demo and tests.
- **Protocol:** all worker protocol changes are additive v1 fields and
  endpoints; the SDK keeps ignoring unknown fields.

## Exit demo (1.1.0-rc.2)

On the PostgreSQL topology, with two engine replicas and the stub MCP server:

1. Deploy `m3-refund-agent`. The triage agent reads the customer and order
   through MCP read tools (`agent_steps` show them, with cost).
2. It delegates the fraud check to `m3-fraud-check`; lineage shows in Studio;
   the parent agent continues with the child's verdict.
3. It proposes `refund_payment`; an approval task appears for `finance`
   showing the arguments.
4. Kill the worker after the approval and while the write is in flight; kill
   one engine replica during the child.
5. Approve; the refund runs **once** (stub server counter = 1); the instance
   completes; per-instance cost is visible; audit shows agent identity on
   every step and the approver on the write.

Evidence goes in `1.1.0-rc.2-gate-report-<date>.md` under the publication
gates.
