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
