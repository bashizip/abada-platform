# Abada 1.1.0 RC Roadmap — Agentic Workflows and Infrastructure Certification

This roadmap follows the `1.0.0-rc.2` reliable OSS core. Its primary product
goal is to demonstrate agentic workflows as durable consumers of Abada's
shared APL/BPMN runtime state machine. It does not weaken that state machine or move agent execution
into transient, process-local memory.

Last reviewed: 2026-08-09.

## Release scope

The 1.1 RC work has two tracks:

1. **Agentic workflow integration:** the product and runtime integration
   needed to deliver controlled, observable and recoverable agentic workflows.
2. **Infrastructure certification debt:** a production-like cloud validation
   environment and delivery pipeline. This track does not block the first
   agentic prototype, but it must close before Abada claims a cloud-certified
   1.1 production topology.

The `1.0.0-rc.2` Compose family remains the supported evaluation and
development baseline until the infrastructure track is complete.

## Track A — Agentic workflow integration

### Current product checkpoint — make the loop observable end to end

This checkpoint is the only active Studio priority before deeper security and
administration work. It preserves the final product split: authors can explore
locally, while every live execution is an explicit, durable engine action.

- [x] Temporarily grant the bundled development user Alice global
  `abada-admin`, while project creation continues to make her Owner,
  Maintainer, Operator and Viewer of projects she creates. This is a local
  unblocker, not the production authorization model.
- [x] Rename and separate the authoring actions: **Dry Run** is local, mocked
  and non-persistent; **Deploy & Start** saves APL, deploys an immutable
  definition and creates a real project-scoped instance. Both expose explicit
  tooltips and the latter warns when the exact revision was not dry-run.
- [x] Restore **Review AI Optimization** as the Insight proposal review entry
  point. Loading, no-proposal and backend-error states remain in that surface;
  they never fall back to the audit stream.
- [x] Make project instances selectable and open them as a read-only canvas
  projection, polling project-scoped active activities and durable history.
- [x] Carry the immutable deployment identifier on process-instance responses
  so Studio loads the exact deployed APL version instead of the newest version
  sharing the process key.
- [x] Animate local Dry Run tokens node by node, pausing for mocked agent
  output, gateway choice and human completion. For live instances, animate
  only engine-reported active tokens and preserve completed/waiting/failed
  facts; Studio must never fake engine progress.
- [ ] Deliver the first real `abada:agent` external worker and persist model
  attempts/results through the durable worker and history contracts.
- [ ] Add restart/retry/cancellation evidence for the worker, then surface
  model/tool metadata in the same live instance view.
- [ ] Only after the runnable agentic loop is proven, resume multi-role
  hardening, administrator UI and `ADMIN_ROOT` bootstrap work below.

### Runtime integration

- [x] Define the versioned `abada.agent/v1` contract as an external-worker profile;
  agents must not advance BPMN state outside engine commands.
- [ ] Persist agent request, attempt, result, failure and cancellation
  metadata through the existing durable external-task and history contracts.
- [x] Define deterministic idempotency and retry behavior for model calls,
  tool calls and worker completion.
- [x] Preserve trace context across engine commands and agent execution;
  tool-call spans remain pending until executable adapters ship.
- [x] Bound model timeouts, retries and worker concurrency; tool payload and
  executable-adapter limits remain pending.

### Human control and policy

- [ ] Model human approval and escalation with supported BPMN user tasks.
- [x] Define tool allowlists, credential boundaries and per-workflow policy
  inputs.
- [ ] Record model, prompt/template version, tool decisions, actor and trace
  identifiers without logging secrets or complete sensitive payloads.
- [ ] Make suspension and cancellation stop new agent work and produce
  deterministic late-completion behavior.

### Reference demonstration

- [ ] Publish one runnable agentic workflow using the released Compose bundle.
- [ ] Demonstrate restart recovery while agent work is leased or awaiting
  human approval.
- [ ] Demonstrate technical failure, bounded retry, BPMN error and manual
  recovery.
- [ ] Provide repeatable evaluation cases for task success, policy adherence,
  tool selection and failure behavior.
- [ ] Document architecture, setup, security limits, cost controls and
  reproducible demo steps.

### Autonomous Insight Loop and Studio governance

- [x] Write terminal facts transactionally to PostgreSQL and analyze durable,
  non-overlapping windows without a mandatory streaming/OLAP stack.
- [x] Generate and parse-check APL proposals outside database transactions.
- [x] Snapshot target checksum and approval policy; prevent duplicate open
  proposals and mark stale targets `SUPERSEDED`.
- [x] Support one-review-per-actor, mandatory rejection comments, and
  sequential/parallel one-group-per-approval policies with no auto-apply.
- [x] Connect Studio visual diff, approve/reject actions, and policy settings
  to the backend API.
- [x] Replace the independent BPMN-generation service with project-scoped,
  OpenAI-compatible native APL authoring, authoritative `AplParser`
  validation/repair, deterministic fallback and explicit Apply/Discard review.
- [ ] Add production performance evidence for fact write overhead and analyzer
  windows at the published scale target.

### Project envelope and Studio workspace

- [x] Make PostgreSQL projects the authoritative container for multiple
  project-local process keys, definitions and instances; migrate legacy data
  to the deterministic Default project.
- [x] Add observed OIDC principals, fixed Owner/Maintainer/Operator/Reviewer/
  Viewer memberships, last-owner protection and global `project:create`.
- [x] Keep approval lanes independent from capability roles; do not grant
  Reviewer to creators and do not let global administration satisfy a lane.
- [x] Persist Studio APL documents with stable `metadata.key`, optimistic
  autosave revisions, immutable-version deployment and reversible archive.
- [x] Scope project definitions, starts, instance operations/history,
  job/incident reads and retries, user-task lists/statistics, event correlation
  and Insight facts/findings/proposals/policies.
- [x] Require secured service workers to provide a project and hold both the
  global worker authority and an explicit project/topic binding.
- [x] Add Studio **New project**, **Open project**, project switching, multiple
  process documents and Owner-managed roles/review lanes.
- [ ] Add PostgreSQL multi-project contention and negative-authorization
  evidence for every job/incident query, plus a project model for any future
  outbox administration surface, before declaring full operator-console
  isolation.
- [ ] Add realtime co-editing, Git synchronization and project bundle
  import/export only as separately designed follow-up capabilities.

### Identity administration and root bootstrap

- [ ] Add a dedicated Studio **Administration → Users & roles** workspace,
  visible only to platform administrators, for creating, inviting, disabling
  and reactivating human users and for inspecting service principals.
- [ ] Introduce an identity-provider administration adapter. Bundled Keycloak
  is the first supported writable provider; externally managed OIDC providers
  must explicitly advertise whether user creation and role assignment are
  supported. Abada must not become a second password database.
- [ ] Separate global platform roles from project memberships. Operational
  administrators may grant platform capabilities such as project creation,
  deployment and operations, then assign project Owner/Maintainer/Operator/
  Reviewer/Viewer roles through the existing project boundary.
- [ ] Preserve governance separation: neither `ADMIN_ROOT` nor an operational
  administrator may manufacture an Insight approval, satisfy a review lane or
  silently grant themselves a business-review vote.
- [ ] Add a one-time `ADMIN_ROOT` bootstrap identity, provisioned only through
  an installation secret or local bootstrap command. Its sole normal-purpose
  workflow is to create or promote the first operational platform
  administrator.
- [ ] Automatically close the bootstrap path after the first operational
  administrator is active. Re-enabling `ADMIN_ROOT` must require an explicit
  local break-glass procedure, short expiry and credential rotation; it must
  never be exposed as a routine Studio login.
- [ ] Require step-up authentication for administrator creation, global-role
  changes, user disablement and root recovery. Record immutable audit events
  containing actor, target, before/after roles, reason, timestamp and trace ID,
  without storing credentials or tokens.
- [ ] Enforce last-operational-admin protection, optimistic concurrency,
  idempotent invitations and atomic user/role mutations. A failed identity-
  provider operation must not leave PostgreSQL governance state claiming a
  role that the provider did not grant.
- [ ] Add negative tests for root reuse after bootstrap, forged administrator
  claims, self-escalation, last-admin removal, cross-project escalation,
  unauthorized user discovery and rollback when the identity provider fails.
- [ ] Document installation bootstrap, first-admin handoff, administrator
  rotation, account recovery, external-OIDC limitations and emergency root
  revocation before declaring the administration interface production-ready.

## Track B — Infrastructure certification debt

These items are intentionally deferred from the `1.0.0-rc.2` release
candidate.
Unchecked items mean that the corresponding public-cloud or production
certification claim must not be made.

### Validation environment

- [ ] Provision infrastructure as code for two Linux application VMs behind
  public DNS/TLS and a load balancer.
- [ ] Use an independent PostgreSQL service or database host with a separate
  restore target.
- [ ] Integrate an externally managed OIDC provider; bundled Keycloak remains
  development-only.
- [ ] Restrict database and telemetry services from public networks and
  verify exposure externally.
- [ ] Store backups outside the application hosts and define tested RPO/RTO
  targets.

### CI/CD and supply chain

- [ ] Build, scan and publish immutable commit-addressed images in GitHub
  Actions.
- [ ] Attach SBOM and build-provenance attestations and record image digests
  in the candidate report.
- [ ] Authenticate deployments with short-lived GitHub Actions OIDC
  credentials rather than permanent cloud credentials.
- [ ] Protect the release-validation environment with branch/tag restrictions
  and release approval.
- [ ] Generate the release archive, checksums, evidence report and deployment
  record from the exact candidate commit.

### Live certification

- [ ] Run production telemetry-disabled, bundled and external-OTLP profiles
  against public TLS and external OIDC.
- [ ] Terminate and replace one engine host while another replica continues
  without duplicate or lost workflow progress.
- [ ] Verify telemetry correlation and Collector, Alloy, Loki and Jaeger
  failure isolation.
- [ ] Verify production backup/restore and a multi-replica rolling upgrade.
- [ ] Run empty-directory Linux/macOS quickstarts and Windows PowerShell CI.
- [ ] Complete candidate image scanning, independent security review and
  engineering, security, operations and documentation approvals.

## 1.1 RC acceptance

- [ ] The agentic workflow track has executable evidence and documented
  safety boundaries.
- [ ] Agent execution uses only durable public worker, event, variable,
  history, policy and telemetry contracts.
- [ ] The supported BPMN core retains its 1.0 correctness and compatibility
  evidence.
- [ ] Any incomplete infrastructure-certification item is called out in the
  release notes and deployment support matrix.
- [ ] A production-certified 1.1 claim is made only after every infrastructure
  certification item above is complete.
