# Abada 1.1.0 RC Roadmap — Google AI Lab Candidature

This roadmap follows the `1.0.0-rc.1` reliable OSS core. Its primary product
goal is to demonstrate agentic workflows as durable consumers of Abada's BPMN
runtime for the Google AI Lab candidature. It does not weaken the BPMN state
machine or move agent execution into transient, process-local memory.

Last reviewed: 2026-07-26.

## Release scope

The 1.1 RC work has two tracks:

1. **Agentic candidature:** the product and runtime integration needed to
   demonstrate controlled, observable and recoverable agentic workflows.
2. **Infrastructure certification debt:** a production-like cloud validation
   environment and delivery pipeline. This track does not block the first
   agentic prototype, but it must close before Abada claims a cloud-certified
   1.1 production topology.

The `1.0.0-rc.1` Compose family remains the supported evaluation and
development baseline until the infrastructure track is complete.

## Track A — Agentic candidature

### Runtime integration

- [ ] Define the versioned agent-work contract as an external-worker profile;
  agents must not advance BPMN state outside engine commands.
- [ ] Persist agent request, attempt, result, failure and cancellation
  metadata through the existing durable external-task and history contracts.
- [ ] Define deterministic idempotency and retry behavior for model calls,
  tool calls and worker completion.
- [ ] Preserve trace context across BPMN commands, agent execution and tool
  calls.
- [ ] Bound model/tool timeouts, retries, payload sizes and concurrency.

### Human control and policy

- [ ] Model human approval and escalation with supported BPMN user tasks.
- [ ] Define tool allowlists, credential boundaries and per-workflow policy
  inputs.
- [ ] Record model, prompt/template version, tool decisions, actor and trace
  identifiers without logging secrets or complete sensitive payloads.
- [ ] Make suspension and cancellation stop new agent work and produce
  deterministic late-completion behavior.

### Candidature demonstration

- [ ] Publish one runnable agentic workflow using the released Compose bundle.
- [ ] Demonstrate restart recovery while agent work is leased or awaiting
  human approval.
- [ ] Demonstrate technical failure, bounded retry, BPMN error and manual
  recovery.
- [ ] Provide repeatable evaluation cases for task success, policy adherence,
  tool selection and failure behavior.
- [ ] Document architecture, setup, security limits, cost controls and
  reproducible demo steps.

## Track B — Infrastructure certification debt

These items are intentionally deferred from the `1.0.0-rc.1` prerelease.
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

- [ ] The agentic candidature track has executable evidence and documented
  safety boundaries.
- [ ] Agent execution uses only durable public worker, event, variable,
  history, policy and telemetry contracts.
- [ ] The supported BPMN core retains its 1.0 correctness and compatibility
  evidence.
- [ ] Any incomplete infrastructure-certification item is called out in the
  release notes and deployment support matrix.
- [ ] A production-certified 1.1 claim is made only after every infrastructure
  certification item above is complete.
