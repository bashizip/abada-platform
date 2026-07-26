# Abada Reliable OSS Core Roadmap

This is the authoritative checklist for the Abada 1.0 reliable open-source
core. The pre-RC architecture and developer documentation foundation is
complete; the next milestone is **1.0 RC — Platform deployment, optional
telemetry, evidence and operations**.

Last reviewed: 2026-07-19.

## How to use this roadmap

- `[x]` means the implementation is present and its current automated checks
  pass.
- `[ ]` means the work or its required acceptance evidence is incomplete. An
  item remains unchecked when only a foundation or partial implementation
  exists.
- Close a release gate only when every required item in that gate is complete
  and the linked evidence is reproducible in CI.
- Update this file in the same pull request that completes or reopens an item.

## 0.9 — Durable runtime

### Schema and process definitions

- [x] Use Flyway migrations for the production schema and validate rather than
  generate the schema with Hibernate.
- [x] Store immutable process-definition versions instead of overwriting a
  deployed process key.
- [x] Persist definition checksums and deployment identifiers.
- [x] Prove fresh-schema Flyway migrations against PostgreSQL with
  Testcontainers.
- [x] Prove upgrades from every supported schema version against PostgreSQL
  with Testcontainers. Evidence:
  [`PostgresSchemaUpgradeTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresSchemaUpgradeTest.java).

### Authoritative execution state

- [x] Persist variables, execution tokens and parallel-gateway join state.
- [x] Add optimistic version columns to mutable runtime records.
- [x] Persist message and signal subscriptions.
- [x] Persist timer jobs with due time, lease data, attempts and retry data.
- [x] Persist external tasks with locking, completion and failure state.
- [x] Record append-only activity history.
- [x] Make user-task completion load locked task and process state from
  PostgreSQL and mutate only command-local objects. Evidence:
  [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java).
- [x] Remove runtime-wide mutable instance, task, subscription and scheduling
  maps; load authoritative state from PostgreSQL for each command.
  - [x] Remove the user-task map; query visible tasks from PostgreSQL and lock
    task rows for claim, completion and failure. Evidence:
    [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java).
  - [x] Remove the process-instance compatibility map and startup rehydration;
    lock process rows for mutations and return detached database snapshots for
    queries. Evidence:
    [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java).
- [x] Make every engine command a single atomic load, lock, validate, advance,
  persist, history and commit transaction. Controller mutations delegate to
  command services, timer execution uses one transaction per job, and failed
  advancement rolls state and history back together. Evidence:
  [`AtomicRuntimeCommandContractTest`](../../engine/src/test/java/com/abada/engine/core/AtomicRuntimeCommandContractTest.java),
  [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java) and
  [runtime state architecture](../architecture/runtime-state.md).
- [x] Retain only immutable parsed definition caches in memory, keyed by
  deployment/version ID. Resolve the latest version from PostgreSQL when
  starting an instance and keep existing instances pinned to their deployment.
  Evidence:
  [`ProcessDefinitionCacheTest`](../../engine/src/test/java/com/abada/engine/persistence/ProcessDefinitionCacheTest.java).
- [x] Bound public task and process-instance list reads with database-level
  pagination, deterministic ordering and batch process hydration. Evidence:
  [`TaskControllerTest`](../../engine/src/test/java/com/abada/engine/api/TaskControllerTest.java),
  [`ProcessControllerTest`](../../engine/src/test/java/com/abada/engine/api/ProcessControllerTest.java) and
  [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java).
- [x] Publish lifecycle events and optional webhooks through a transactional
  outbox with `SKIP LOCKED` leases, retry delay and stable delivery IDs.
  Evidence: [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java)
  and [runtime semantics](../reference/runtime-semantics.md).

### Supported BPMN behavior

- [x] Publish the current BPMN support matrix.
- [x] Reject known unsupported BPMN constructs during deployment.
- [x] Support the documented core constructs, including script tasks.
- [x] Back every row in the support matrix with executable conformance tests.
  Evidence: [BPMN support contract](../reference/bpmn-support.md).
- [x] Publish precise tested semantics for variables, retries, cancellation,
  suspension, tasks, gateways and catch events. Evidence:
  [runtime semantics contract](../reference/runtime-semantics.md).

### Recovery evidence

- [x] Exercise basic restart recovery in the current persistence test suite.
- [x] Run a full application-context restart against PostgreSQL and recover a
  deployed definition, active token, user task, variables and history before
  completing the workflow. Evidence:
  [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java).
- [x] Use PostgreSQL as the correctness reference for persistence, restart and
  concurrency acceptance; keep H2 as a convenience profile only. Evidence:
  [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java).
- [x] Test failure immediately before and after transaction commit, including
  atomic rollback and committed state after simulated response loss. Evidence:
  [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java).
- [x] Prove that a persisted user task, active token and variables recover
  without lost workflow progress.
- [x] Prove that durable subscriptions, timer jobs and external tasks recover
  after a full application restart without lost workflow progress. Evidence:
  [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java).

- [x] **0.9 release gate:** durable PostgreSQL execution, schema upgrades,
  atomic rollback, outbox delivery and restart recovery pass acceptance tests
  without relying on mutable in-memory state. Evidence: 101 passing backend
  tests, including 11 PostgreSQL restart/atomicity/outbox cases and five
  supported schema-upgrade paths.

## 0.10 — Cluster safety

### Work acquisition and recovery

- [x] Store lease owner, lease expiry, attempt count and retry data for durable
  jobs.
- [x] Recover expired job leases for reprocessing.
- [x] Support external-task fetch-and-lock, lock extension, completion and
  technical failure.
- [x] Atomically claim timers and external work across two or more replicas
  without duplicate state transitions. The supported core has no deferred
  asynchronous-continuation job type; synchronous continuations advance in
  their owning command transaction.
- [x] Use PostgreSQL `FOR UPDATE SKIP LOCKED` acquisition with V8 indexes and
  concurrent contention tests.
- [x] Recover work when a worker or engine replica dies while holding a lease.
- [x] Deliver transactional-outbox records with independent leases, retry and
  stable event IDs used as the consumer deduplication key.

### Idempotency and concurrent commands

- [x] Support idempotency keys for process starts and task completion.
- [x] Serialize concurrent completion of the same user task across two engine
  application contexts, with one committed transition and one completion
  history event. Evidence:
  [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java).
- [x] Define and implement idempotency for every public mutation command,
  message correlation and external-task completion.
- [x] Return deterministic results for duplicate and concurrently repeated
  requests.
- [x] Correlate durable message and signal subscriptions transactionally.
- [x] Prevent lost updates during concurrent completion, cancellation,
  correlation and timer firing.

### Multi-replica acceptance

- [x] Run two or more engine application contexts against one PostgreSQL
  Testcontainer in the Maven CI suite.
- [x] Concurrently claim timers, messages, signals, user tasks and external
  work.
- [x] Terminate a replica while it owns a timer lease, simulate failures before
  and after commits, and verify recovery.
- [x] Demonstrate exactly-once workflow state transitions while documenting
  at-least-once external side-effect semantics.
- [x] Pass replica failover and concurrent-correlation Testcontainers suites.

- [x] **0.10 release gate:** multi-replica acquisition, leases, idempotency,
  failover and concurrent-command correctness pass on PostgreSQL. Evidence:
  [`PostgresRestartRecoveryTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresRestartRecoveryTest.java),
  [`PostgresSchemaUpgradeTest`](../../engine/src/test/java/com/abada/engine/persistence/PostgresSchemaUpgradeTest.java),
  and [`MutationIdempotencyContractTest`](../../engine/src/test/java/com/abada/engine/api/MutationIdempotencyContractTest.java).

## 0.11 — Stable contracts and security

### Public API and worker protocol

- [x] Freeze a consistent `/api/v1` contract with pagination, filtering,
  stable DTOs and typed errors.
  - [x] Add bounded page/size queries and pagination metadata to public task
    and process-instance lists without changing their list-shaped JSON body.
- [x] Validate generated OpenAPI and API compatibility in CI. Evidence:
  [`OpenApiContractTest`](../../engine/src/test/java/com/abada/engine/api/OpenApiContractTest.java)
  and the machine-readable
  [API v1 manifest](../../engine/src/test/resources/contracts/api-v1-contract.json).
- [x] Add optional `Idempotency-Key` support to all applicable mutation
  endpoints.
- [x] Freeze a versioned worker protocol for fetch-and-lock, heartbeat, lock
  extension, completion, BPMN error, technical failure, retry and trace
  propagation. Evidence: [worker protocol v1](../reference/external-worker-protocol-v1.md)
  and [`ExternalTaskTest`](../../engine/src/test/java/com/abada/engine/api/ExternalTaskTest.java).

### Authentication, authorization and audit

- [x] Validate OIDC JWTs with Spring Security resource-server support.
- [x] Keep trusted proxy-header authentication as an explicit deployment mode.
- [x] Restrict CORS and avoid logging authorization headers and full sensitive
  payloads.
- [x] Record actor, action, timestamps, workflow identifiers and trace data in
  activity history.
- [x] Enforce and test permissions for deployment, process control, task
  actions, operations access and external workers. Evidence:
  [security and RBAC contract](../reference/security-and-rbac.md).
- [x] Test forged proxy headers, invalid and expired JWTs, role boundaries,
  CORS, sensitive logging and unauthorized cross-user task actions.
  Evidence:
  [`SecurityAuthorizationContractTest`](../../engine/src/test/java/com/abada/engine/security/SecurityAuthorizationContractTest.java),
  [`ProxyHeaderAuthenticationFilterTest`](../../engine/src/test/java/com/abada/engine/security/ProxyHeaderAuthenticationFilterTest.java),
  and [`TaskControllerTest`](../../engine/src/test/java/com/abada/engine/api/TaskControllerTest.java).

### Clients and product integration

- [x] Publish a Java external-worker SDK against the frozen protocol. Source
  and executable tests: [`sdk/java`](../../sdk/java/).
- [x] Align Tenda with the guaranteed task APIs.
- [x] Align Orun with durable history, incidents, jobs and instance state.

- [x] **0.11 release gate:** REST and worker contracts are frozen; OIDC, RBAC,
  security tests, the Java SDK and frontends are aligned. Evidence is recorded
  in the [0.11 release notes](../release-notes/0.11.0-alpha-release-notes.md).

## 1.0 — BPMN dialects and compatibility profiles

Specification: [BPMN dialects and compatibility](../specifications/bpmn-dialects-and-compatibility.md).

This is a release-blocking 1.0 feature. The repository-grounded delivery plan
is [BPMN dialect implementation plan](bpmn-dialects-implementation-plan.md).

### Canonical model and parsing

- [x] Define vendor-neutral `ProcessExpression` and `UserTaskAssignment`
  models and use them from `TaskMeta` and runtime task creation.
- [x] Detect the `standard-bpmn-2.0`, `abada-native-1`, and `camunda-7`
  profiles explicitly.
- [x] Route user-task assignment through a deterministic extension-parser
  registry; runtime code must not execute vendor XML semantics.
- [x] Keep existing Camunda assignee/candidate definitions operational with
  Abada expression semantics reported transparently.
- [x] Parse standard BPMN `potentialOwner`/`humanPerformer` expressions for the
  documented `user:<id>` and `group:<id>` subset.
- [x] Parse both compact and nested `abada:assignment` forms under the stable
  `https://abada.io/schema/bpmn` namespace.

### Validation, execution and persistence

- [x] Reject conflicting assignment representations, malformed expressions,
  invalid strategies and unsupported execution-relevant directives with
  stable `ABADA-BPMN-*` codes.
- [x] Secure XML parsing against XXE, entity expansion, remote schema loading
  and unbounded deployment input.
- [x] Evaluate assignment expressions once at task creation; normalize and
  deterministically deduplicate candidate identities.
- [x] Preserve candidates when assigned, reject claiming assigned tasks, and
  retain current claim authorization semantics.
- [x] Add authorized unclaim behavior and assignment audit events where the
  existing task API permits a backward-compatible extension.
- [x] Keep deployment validation, definition persistence, history and cache
  registration atomic.
- [x] Add a Flyway migration for definition format/profile/namespace/compiler/
  report metadata and task assignment strategy; preserve all existing rows.
- [x] Prove fresh and V1–V6 PostgreSQL upgrades through the new schema.

### Reports, migration and public contracts

- [x] Produce programmatic compatibility reports with detected profiles,
  mappings and structured validation issues.
- [x] Extend the existing multipart deployment API with optional profiles and
  strict mode without breaking current clients; return compatibility data.
- [x] Provide deterministic Camunda 7 → Abada-native migration while
  preserving the original input and failing on uncertain execution semantics.
- [x] Provide `abada bpmn migrate` CLI behavior and machine-readable/reporting
  output without introducing a separate repository module.
- [x] Add bounded parsing/deployment/migration metrics and structured logs.

### Evidence and documentation

- [x] Add unit tests for all parsers, expressions, normalization, conflicts,
  unknown directives, reports, serialization and migration.
- [x] Prove standard, Abada-native and Camunda fixtures create equivalent
  persisted task assignments.
- [x] Prove native and migrated round trips preserve canonical assignments.
- [x] Add malformed/unsafe XML and atomic failed-deployment tests.
- [x] Publish the required ADR, native extension, Camunda profile,
  compatibility profile, migration and assignment-semantics documentation.
- [x] Add runnable examples and map every acceptance criterion to executable
  evidence.

- [x] **BPMN compatibility release gate:** every normative acceptance criterion
  is implemented and verified, or explicitly documented as blocked with
  concrete technical evidence.

## Pre-1.0 RC — Documentation foundation

- [x] Build a versioned documentation application with Astro 7 and Starlight
  0.41 on the repository's Node.js 24 toolchain.
- [x] Support structured MDX content and executable Mermaid diagrams.
- [x] Publish a curated architecture guide covering components, database
  authority, atomic commands, cluster execution, security and BPMN dialects.
- [x] Publish a developer guide covering repository structure, local setup,
  backend/API/database changes, testing and documentation contribution.
- [x] Link every guide to the authoritative repository contracts and make
  documentation checks part of CI.
- [x] Keep the end-user guide explicitly deferred until the architecture and
  developer contracts stabilize. The user guide is activated by the platform
  deployment milestone below.
- [x] **Documentation foundation gate:** type checking, production build,
  dependency audit and internal-link validation pass reproducibly.

## 1.0 RC — Evidence and operations

Every candidate must complete the
[1.0 RC publication gates](1.0-rc-publication-gates.md). Roadmap completion
shows that a capability exists; it does not replace candidate-specific
publication evidence.

### Platform deployment and optional telemetry

- [x] Publish one authoritative Compose family: shared core, development,
  production and optional telemetry overlays. Evidence: `compose.yaml`,
  `compose.dev.yaml`, `compose.prod.yaml`, `compose.telemetry.yaml` and
  [`validate-platform-deployment.sh`](../../scripts/test/validate-platform-deployment.sh).
- [ ] Certify PostgreSQL-backed development with bundled local Keycloak and
  direct OIDC validation; keep H2 outside the platform certification matrix.
  The executable workflow/restart check is
  [`smoke-dev-platform.sh`](../../scripts/test/smoke-dev-platform.sh). Live
  cloud evidence is deferred to the
  [1.1 RC infrastructure track](roadmap-to-1.1.0-rc.md).
- [ ] Certify PostgreSQL-backed production with external OIDC, required
  secrets/domains/origins, TLS ingress and no publicly exposed database. The
  configuration and negative preflight contract passes; reference-host live
  certification is deferred to the
  [1.1 RC infrastructure track](roadmap-to-1.1.0-rc.md).
- [x] Make telemetry disabled by default with no exporters, collector
  dependency or telemetry-related readiness failure. Evidence:
  [`TelemetryModeConfigurationTest`](../../engine/src/test/java/com/abada/engine/observability/TelemetryModeConfigurationTest.java),
  [`TelemetryExportHealthIndicatorTest`](../../engine/src/test/java/com/abada/engine/observability/TelemetryExportHealthIndicatorTest.java)
  and the telemetry-free Compose contract check.
- [ ] Certify the bundled metrics, traces and logs overlay and an external
  OTLP mode; prove collector failure cannot roll workflow state back. The
  executable checks are
  [`smoke-telemetry-platform.sh`](../../scripts/test/smoke-telemetry-platform.sh)
  and [`smoke-external-otlp.sh`](../../scripts/test/smoke-external-otlp.sh);
  live cloud certification is deferred to the
  [1.1 RC infrastructure track](roadmap-to-1.1.0-rc.md).
- [x] Serve runtime API and OIDC configuration from immutable Tenda and Orun
  images and fail startup on incomplete configuration. Evidence: runtime
  `/config.js` entrypoints and deployment contract tests.
- [x] Publish a versioned, checksummed release bundle with no build contexts
  or repository-relative missing assets. Evidence:
  [`build-bundle.sh`](../../release/build-bundle.sh).
- [x] Provide a Linux/macOS quickstart plus a production preflight that
  validates configuration before startup.
- [ ] Execute the PowerShell quickstart and preflight in Windows CI. Deferred
  to the [1.1 RC infrastructure track](roadmap-to-1.1.0-rc.md).
- [ ] Test development/production with telemetry off/on from clean Docker
  state, including authentication, BPMN deployment, task completion, engine
  restart and persisted progress. Development CI jobs are defined; production
  reference-host evidence is deferred to the
  [1.1 RC infrastructure track](roadmap-to-1.1.0-rc.md).
- [ ] Publish the user guide: choose a mode, quickstart, first workflow,
  development, production/OIDC, telemetry, scaling, backup/restore, upgrades
  and troubleshooting. The complete source passes Astro checks/build; Vercel
  publication waits for every documented live deployment command to pass.
- [x] **1.0 RC Compose distribution gate:** development and production
  Compose configurations, negative preflight cases, runtime frontend
  configuration and the self-contained release archive pass the executable
  deployment contract. `1.0.0-rc.1` is a published evaluation release
  candidate, not a public-cloud production certification; live certification
  moves to 1.1.
- [x] Require release image manifests for `linux/amd64` and `linux/arm64`;
  verify both platforms after each image is pushed. The original
  `1.0.0-rc.1` images remain an immutable amd64-only exception handled by an
  explicit launcher compatibility mode on ARM64 hosts.

### Conformance and quality

- [ ] Publish executable conformance results for every supported BPMN
  construct and semantic guarantee.
- [ ] Run parser, engine unit, PostgreSQL integration, frontend lint/build and
  API compatibility checks on every pull request.
- [x] Enforce zero known npm dependency vulnerabilities for Tenda and Orun in
  CI with a low-severity audit gate.
- [ ] Complete an independent security review with no unresolved critical
  findings.
- [ ] Reach zero unresolved critical correctness defects.

### Upgrades and operations

- [ ] Test migrations from every supported minor version.
- [ ] Test a supported rolling upgrade across multiple replicas.
- [ ] Publish and verify backup and restore instructions. The guide and
  [`verify-backup-restore.sh`](../../scripts/test/verify-backup-restore.sh) are
  implemented; production-profile execution evidence remains outstanding.
- [ ] Publish incident, recovery and operational runbooks.
- [ ] Provide one reproducible quickstart and one production reference
  deployment.
- [ ] Provide runnable sample workflows for the supported BPMN subset.

### Reproducible performance

- [ ] Publish throughput and latency benchmarks.
- [ ] Document benchmark hardware, PostgreSQL configuration, workflow model
  shape and concurrency.
- [ ] Define and pass release performance thresholds.

- [ ] **1.0 RC release gate:** conformance, upgrades, security, benchmarks and
  operational evidence are published and reproducible.

## 1.0 — Release acceptance

- [ ] Terminate engine replicas without duplicate or lost workflow progress.
- [ ] Repeat API requests and worker completions with deterministic outcomes.
- [ ] Correlate messages concurrently without duplicate or lost progress.
- [ ] Perform supported rolling upgrades without duplicate or lost progress.
- [ ] Verify that the same PostgreSQL database passes the complete acceptance
  suite for all scenarios above.
- [ ] **1.0 release gate:** all acceptance evidence is green and no critical
  correctness defect remains unresolved.

## Deferred until after 1.0

These items do not count toward the 1.0 completion percentage: hosted SaaS,
multi-tenancy, billing, Kubernetes packaging, DMN, CMMN, TypeScript and Python
worker SDKs, an embeddable Java engine/Maven artifact, public agent runtime, AI
memory and policy-engine work. Future agentic features should consume the
durable worker, event, variable, policy and telemetry contracts without
bypassing the BPMN state machine.

The next planned milestone is the
[1.1.0 RC roadmap](roadmap-to-1.1.0-rc.md). Its agentic workflow track may
begin on the validated Compose baseline; public-cloud deployment, multi-host
failover, rolling-upgrade and supply-chain certification remain a separately
visible infrastructure-debt track.

The bundled RC telemetry profile uses Grafana Alloy for log collection. It
preserves the named-log-volume and trace-correlation contract without retaining
the end-of-life Promtail agent.

See [BPMN support](../reference/bpmn-support.md) and
[deployment support](../reference/deployment-support.md) for the current
guarantees.
