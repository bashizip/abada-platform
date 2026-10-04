# M2 — Real process shapes: task specifications

- Milestone: M2 (2026-10-19 → 2026-11-06), release `1.1.0-rc.1`
- Roadmap: [`roadmap.md`](roadmap.md)
- Audience: human contributors and coding agents. Execute one task per branch/PR.
  Read `AGENTS.md` first; its runtime invariants override anything here.

Every task lists **Goal**, **Files**, **Changes**, **Acceptance tests**,
**Invariants**, and **Out of scope**, as in [`m1-task-specs.md`](m1-task-specs.md).
`ENGINE` means `engine/src/main/java/com/abada/engine`, `ENGINE_TEST` means
`engine/src/test/java/com/abada/engine`.

## E1 — One APL contract ✅ done

**Goal.** APL is defined once, by the engine. Studio, automation and the E17
authoring work read the same machine-readable contract, and validation reports
every problem with its location instead of the first one.

**Files.** `engine/src/main/resources/apl/apl-v1.schema.json`,
`ENGINE/parser/{AplParser,AplSchema,AplVariables}.java`,
`ENGINE/apl/AplContractService.java`, `ENGINE/api/AplContractController.java`,
`ENGINE/security/SecurityConfig.java`, `ENGINE/dto/ProcessDefinitionDto.java`,
`studio/scripts/generate-apl-types.mts`, `studio/src/lib/apl/types.generated.ts`,
`studio/src/lib/{aplContract,agentModels}.ts`, `studio/src/lib/apl/issues.ts`,
`studio/src/features/designer/AplEditor.tsx`.

**Changes.**
- The JSON Schema (2020-12) is the structural contract: one `$defs` entry per
  node type, `additionalProperties: false`, the parser's bounds and defaults.
  The engine validates the root and then each node against its own type, so a
  wrong field yields one precise finding.
- Schema violations are `ABADA-APL-SCHEMA-001` **warnings** in 1.1.0-rc.x and
  become errors at 1.1.0. Semantic rejections stay `ABADA-APL-VALIDATION-001`
  errors.
- `AplParser` compiles each node independently and collects all errors, each
  with `elementId` and a JSON Pointer `path` (`BpmnValidationIssue.path`,
  additive). Policy (CEL) errors are anchored to their node.
- `metadata.variables` (deferred from T2): optional typed declarations. When
  present, an expression identifier that is neither declared nor written
  upstream is an `ABADA-APL-VARIABLE-001` warning. Decision-table `when`
  rules that read a non-input are always reported (they only see inputs at
  runtime).
- `GET /v1/apl/schema` (schema + allowed models + `x-abada-runtime`, ETag) and
  `POST /v1/apl/validate` (deployment pipeline, no persistence). Authenticated,
  no role.
- Spring builds `AplParser` from `abada.agent.allowed-models`.
- Studio types are generated from the schema and committed;
  `npm run verify:apl-types` fails the build on drift (replaces the
  `check-apl-parity` scraper). Studio validates through the engine and reads
  models and bounds from the served schema.

**Acceptance tests.**
- `AplSchemaConformanceTest`: schema node types equal `AplParser.SUPPORTED_TYPES`;
  every committed APL document (test fixtures, `examples/apl`, M1 demo) has zero
  schema findings; bounds agree with the parser at max and max+1; unknown fields
  and wrong types are warnings at the right path; errors in several nodes are
  all reported.
- `AplVariablesTest`: skipped without declarations; declared, upstream agent
  result and decision outputs resolve; downstream-only writes warn; non-input
  `when` warns; invalid declarations are errors.
- `AplContractControllerTest` (PostgreSQL Testcontainers): served models and
  ETag/304; validate returns every error with paths and writes no definition,
  history or outbox rows; the source is never logged; warnings keep a document
  valid and a deploy succeeds with them; >10 MiB is an issue; missing source
  is `400`.
- `SecurityAuthorizationContractTest`: missing, invalid, expired and forged
  proxy credentials get `401`; a user with no role may use both endpoints.
- `AplParserBeanTest`, `ProcessDefinitionDtoTest`, `OpenApiContractTest`.
- Studio: `parser.test.ts` (`else: <target>` shorthand), `issues.test.ts`,
  `aplContract.test.ts`; `npm run build` runs `verify:apl-types`.

**Invariants.** Validation never persists state or writes history. Warnings
never block deployment in the 1.1.0-rc line. The engine stays the authority;
Studio's model guard steps aside when the contract cannot be loaded.

**Out of scope.** Enforcing `metadata.variables` on start payloads; YAML line
and column numbers in issues; turning schema warnings into errors (1.1.0).

## E2 — Token entity ✅ done

**Goal.** A token is a durable row with a stable identity, so joins count
tokens, waiting work resumes the exact token, and loops (E3), boundaries (E4),
child processes (E20) and for-each (E21) have a model to build on.

**Files.** `engine/src/main/resources/db/migration/V23__process_tokens.sql`,
`ENGINE/core/{ProcessToken,ProcessInstance,AbadaEngine,EventManager,JobScheduler,TimerJobCommandService,ExternalTaskCommandService}.java`,
`ENGINE/persistence/entity/{ProcessTokenEntity,TaskEntity,ExternalTaskEntity,JobEntity,EventSubscriptionEntity}.java`,
`ENGINE/persistence/repository/ProcessTokenRepository.java`,
`ENGINE/api/{CockpitController,ProjectOperationsController}.java`.

**Changes.**
- `process_tokens` (id, instance, activity, state, parent, scope, loop counter,
  timestamps; cascade-deleted with the instance) and a nullable `token_id` on
  tasks, external tasks, jobs and event subscriptions. Portable SQL.
- States `ACTIVE`, `WAITING`, `ARRIVED`, `FORKED`, `EVENT_WAIT`, `COMPLETED`,
  `CONSUMED`, `CANCELLED`. A fork suspends its token and creates one child per
  branch; the closing join fires when every live child arrived, consumes them
  and resumes the forking token. An event gateway parks its token with one
  waiting child per catch event; the winner resumes the parent.
- Hops are bounded per token instead of a run-wide visited set: this fixes the
  dropped same-command join arrival and lets E3 revisit nodes.
- Waiting work records its token; completions resume by token id, falling back
  to the oldest token at the activity for pre-V23 rows.
- Pre-V23 instances are converted from the JSON columns on their first command.
  The JSON columns stay dual-written through the 1.1.0-rc line for rc.8 rollback.
- `activity-instances` returns token ids as execution ids.

**Acceptance tests.**
- `ProcessInstanceTokenTest`: same-command convergence runs the step after the
  join (fails on the rc.8 code); the forking token id survives its join; nested
  forks; an event race counts as one stream; two tokens at one activity resume
  by id; a branch ending before the join; cancel; legacy conversion and its
  mismatch warning.
- `PostgresTokenUpgradeTest`: rc.8-shaped instances (mid-join, event race, user
  task) on a real V22 database run to completion after Flyway applies V23; new
  work names its token and the legacy columns keep the rc.8 shape.
- `PostgresSchemaUpgradeTest`: upgrade from V1–V22 and a fresh database carry
  the token schema.
- Existing gateway, kitchen-sink, restart-recovery and two-replica suites green.

**Invariants.** Tokens are read and written only inside their instance's
locked command. No remote call runs while they are held.

**Out of scope.** Back-edges and the `uk_event_subscription (instance,
activity)` constraint that loops must relax (E3); incrementing `loop_counter`
(E3); dropping the legacy JSON columns (after 1.1.0); boundary events (E4).

## E3 — Bounded loops ✅ done

**Goal.** A process may return to an earlier step (agent drafts, human
rejects, agent revises) but never without a limit, so a modeling slip or a
disagreeing agent cannot loop forever.

**Files.** `engine/src/main/resources/db/migration/V24__bounded_loops.sql`,
`ENGINE/core/model/{LoopMeta,ParsedProcessDefinition}.java`,
`ENGINE/parser/{AplParser,BpmnParser,LoopRules,SupportedBpmnValidator}.java`,
`ENGINE/core/{ProcessInstance,ProcessToken,AbadaEngine,IncidentService,EventManager,TimerJobCommandService,ExternalTaskCommandService}.java`,
`ENGINE/api/{ProjectIncidentController,CockpitController}.java`,
`studio/src/lib/apl/parser.ts`, `studio/src/features/run/DryRunPanel.tsx`.

**Changes.**
- Language: the node a cycle returns to declares `loop: { max_iterations,
  on_exhausted }` (BPMN `abada:maxIterations`, `abada:onExhausted`). Back-edges
  are classified once on the parsed definition (O(V+E)); unbounded cycles,
  cycles to the start or to a parallel/inclusive gateway, and an
  `on_exhausted` that re-enters the loop are rejected at deployment only.
  BPMN loop and multi-instance markers are rejected.
- Runtime: `<step>_iteration` counts passes (forward entry = 1, back-edge +1),
  mirrored on the token's loop counter. Past the bound the token takes
  `on_exhausted`, or stops in the `INCIDENT` state and an incident opens.
  `LOOP_EXHAUSTED` history in both cases; cancel/fail resolve incidents.
- V24: `incidents` table and endpoints; `INCIDENT` token state; the
  `(instance, activity)` subscription uniqueness is dropped and waits are
  re-armed per token every pass; timers complete before advancing; a
  successful agent pass clears stale raw output and error code.
- Studio keeps `loop` and every APL key it does not edit; the dry run honours
  loop bounds and stops following every outcome route.

**Acceptance tests.**
- `AplLoopRuntimeTest` (PostgreSQL): rework loop approved after a restart
  mid-loop; third rejection routes to `on_exhausted`; incident without a
  route, resolved by cancel; message wait and self-looping timer re-armed.
- `AplParserTest`, `BpmnLoopDeploymentTest`, `ProcessInstanceTokenTest`
  (bound without wait states, incident state, forward re-entry resets),
  `AplSchemaConformanceTest` (bound parity), `PostgresSchemaUpgradeTest`
  (V1–V23 → V24), `PostgresTokenUpgradeTest` (rc.8 simulation undoes V24).
- Studio `parser.test.ts` (loop round trip, verbatim keys, no resurrection of
  removed fields), `elkLayout.test.ts` with the rework fixture.

**Hardening (same milestone).** Passes are counted per token and loop step
(V25 `process_tokens.loop_counts`; fork children inherit their parent's
counts); open incidents can be retried by operators (`POST
.../incidents/{id}/retry`, recorded as `INCIDENT_RETRIED`); a message wait
without `correlationKey` opens a `MISSING_CORRELATION_KEY` incident instead of
hanging silently.

**Out of scope.** Studio loop editing (E6); raising a loop bound at runtime.

## E4 — Boundaries, service levels and model fallback ✅ done

**Goal.** A waiting step never stalls silently: it leaves through a declared
route when its work fails for good or takes too long, a human task's service
level is enforced, and a rate-limited model neither burns the attempt budget
nor stops the process.

**Files.** `engine/src/main/resources/db/migration/V26__boundaries.sql`,
`ENGINE/core/model/{BoundaryMeta,SequenceFlow,ParsedProcessDefinition,TaskMeta,AgentWorkDescriptor}.java`,
`ENGINE/parser/{AplParser,AplVariables,BpmnParser,SupportedBpmnValidator}.java`,
`ENGINE/core/{ProcessInstance,AbadaEngine,ExternalTaskCommandService,TimerJobCommandService,JobScheduler,TaskManager,IncidentService}.java`,
`ENGINE/api/{CockpitController,ProjectIncidentController,JobController,ProjectJobController}.java`,
`agent-worker/.../{AgentWorkerMain,AbstractAgentGateway,AgentGateway}.java`,
`sdk/java/.../{AbadaWorkerClient,AgentWorkDescriptor,AgentAttemptMetadata}.java`,
`studio/src/lib/apl/parser.ts`, `studio/src/lib/run/instanceDetail.ts`.

**Changes.**
- Language: `on_timeout: { after, then }` on agent, engine-task and
  human-input; `on_error` also on human-input and catching the last failed
  attempt (`WORK_FAILED`); `sla_hours` read (alias `slaHours`) with
  `escalate_to`; agent `fallback_models` (≤3, allow-listed). BPMN interrupting
  timer and error boundary events on user and external service tasks;
  `abada:slaHours` / `abada:escalateTo`.
- Model: routes are `BoundaryMeta` plus boundary flows on the task; the
  synthetic `<id>__outcome` gateway is gone (suffix still reserved). The
  runtime takes a boundary flow only when the boundary fires.
- Runtime: one command fires a boundary — retire the token's work, write
  `<id>_outcome`/`<id>_error_code`, move the token, record `BOUNDARY_TAKEN`.
  Timeout and SLA are durable job kinds created when a token parks at a task
  and cancelled when it leaves. SLA escalation keeps the task open, adds
  `escalate_to` groups, sets `escalatedAt`, emits `TASK_SLA_BREACHED`.
  Unrouted last failures open `WORK_FAILED` incidents; retrying reopens the
  work, optionally on another allowed model with a recorded reason
  (`external_tasks.model_override`). Cancel/fail retire all unfinished work.
  Work rows are locked before the instance row.
- Worker: 429/quota/408/5xx/timeout/unreachable are availability errors;
  fallback models are tried in order inside one lease; when all are
  unavailable the failure is a deferral (`deferred: true`, Retry-After) that
  keeps the attempt budget; the engine grows and caps the delay and turns the
  deferral into a failed attempt after `abada.agent.max-deferrals`.
  Idempotency keys name the lease. The SDK ignores unknown fields.
- Studio: `on_timeout`, `fallback_models`, `escalate_to` round-trip; timeout
  edges; boundary history lights the route taken; no default `sla_hours`.

**Acceptance tests.**
- `AplBoundaryRuntimeTest` (PostgreSQL): agent timeout retires the task and
  rejects the late completion; completion cancels the timeout; SLA escalates
  in place and reaches the outbox; human timeout; last failure takes
  `on_error`; unrouted failure → incident → retry on another model with audit
  and an allow-list/reason check; deferrals keep the budget, grow and are
  bounded; a pending timeout survives a restart and fires once; cancel
  retires all work.
- `AplParserTest`, `SupportedBpmnValidatorTest`, `AgentWorkerResilienceTest`
  (cancel retires leased work), `PostgresRestartRecoveryTest` (cancel vs
  correlation without deadlock), `PostgresSchemaUpgradeTest` (V1–V25 → V26),
  `PostgresTokenUpgradeTest` (rc.8 simulation undoes V26).
- Worker `AgentWorkerRunnerTest` (fallback order, deferral, no fallback on
  other errors, per-lease keys), `AgentWorkerMainTest` (Retry-After, 503);
  SDK `AbadaWorkerClientTest` (unknown fields, deferral flag); Studio
  `parser.test.ts`, `instanceDetail.test.ts`, `edgeGeometry.test.ts`.

**Deviation from the plan.** An SLA breach does not switch the task to the
`ESCALATED` status: claiming, completing and every task query work on
`AVAILABLE`/`CLAIMED`, so escalation is a marker (`escalatedAt`) on a task
that stays workable.

**Out of scope.** Studio editing of boundaries and fallbacks (E6);
non-interrupting timers and an `on_sla_breach` branch; per-model cost (E11).

## E5 — Human review primitive ✅ done

**Goal.** A reviewer's decision is part of the process contract: the task
declares its outcomes, the engine accepts only those, a rejection carries a
comment, and the next step (typically the agent revising its draft) receives
that comment.

**Files.** `ENGINE/core/model/{OutcomeMeta,TaskMeta,BoundaryMeta,ParsedProcessDefinition}.java`,
`ENGINE/parser/{AplParser,AplVariables,BpmnParser}.java`, `ENGINE/core/AbadaEngine.java`,
`ENGINE/api/{TaskController,ProjectTaskController}.java`,
`ENGINE/dto/{TaskDecisionRequest,TaskOutcomeDto,TaskDetailsDto}.java`,
`engine/src/main/resources/apl/apl-v1.schema.json`,
`studio/src/features/inbox/{TaskInbox.tsx,decision.ts}`, `studio/src/api/engine.ts`,
`studio/src/lib/apl/parser.ts`, `studio/src/features/run/DryRunPanel.tsx`.

**Changes.**
- Language: `outcomes: { <name>: { next, comment: required|optional } }` on
  human-input (2–6 outcomes, no node-level `next`); each outcome compiles to a
  boundary of kind `OUTCOME`, so back-edges and loop bounds apply. BPMN:
  `abada:outcomes` and `abada:commentRequired` on a user task, routed by an
  ordinary gateway on `<id>_outcome`.
- Runtime: `decideTask` shares the completion command (same locks and
  authorization); it validates outcome, comment (required, ≤4 000 chars) and
  engine-owned variables, writes `<id>_outcome` / `<id>_comment` (null clears
  a previous pass), then leaves through the outcome boundary or advances
  (BPMN). `completeTask` refuses tasks with outcomes. `TASK_COMPLETED`
  records outcome and comment length, never the text; completion logs list
  variable names only.
- API: `POST .../tasks/{taskId}/decision` (project and default), idempotent
  with a comment digest in the fingerprint; `outcomes` on the task detail.
- Studio: outcome buttons plus a comment box in the inbox (client-side rules
  mirror the engine), outcome edges, history lights the chosen outcome, dry
  run offers routes as explicit choices.

**Acceptance tests.** `AplReviewRuntimeTest` (PostgreSQL): reject with a
comment → the revised draft's inputs carry it across an engine restart →
approve clears it; invalid decisions change nothing; the third rejection
escalates. `TaskDecisionApiTest` (detail outcomes, idempotent decision, 400s,
404 for strangers, default-project endpoint), `AplParserTest`,
`SupportedBpmnValidatorTest`, `OpenApiContractTest`; Studio `decision.test.ts`,
`parser.test.ts`, `instanceDetail.test.ts`.

**Out of scope.** Multi-reviewer and double sign-off; Studio editing of
outcomes (E6); outcomes in insight facts.

