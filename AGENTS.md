# AGENTS.md

This file gives human and automated contributors the repository-wide working
agreement for Abada. It applies to the whole repository. A more specific
`AGENTS.md` in a subdirectory may add or override instructions for that area.

## Project and release scope

Abada is an open-source, self-hosted BPMN orchestration platform. The 1.0 goal
is a dependable PostgreSQL-backed core with a documented and executable BPMN
subset. Agentic workflows are future consumers of this core; do not bypass or
weaken the BPMN state machine to add agent features.

The current release line is 1.0.0-rc.x. Its certified production topology is
one or more engine instances backed by PostgreSQL. Database-authoritative
execution, restart recovery, atomic mutation commands, versioned definitions,
durable jobs/subscriptions, transactional outbox delivery, cluster-safe work
acquisition, stable API/worker contracts and backend RBAC are in scope.

Use these documents as the authoritative product contract:

- `docs/development/roadmap.md` — the only active roadmap (1.0.0-rc.6 → 1.1.0),
  with task specifications in `docs/development/m1-task-specs.md`. Older
  roadmaps are superseded and kept for history only.
- `docs/development/1.0-rc-publication-gates.md` — mandatory per-candidate
  publication evidence and GO/NO-GO sign-off.
- `docs/reference/bpmn-support.md` — supported and rejected BPMN constructs.
- `docs/reference/runtime-semantics.md` — command, retry, event, variable,
  cancellation, and suspension semantics.
- `docs/reference/deployment-support.md` — certified deployment matrix.
- `docs/architecture/runtime-state.md` — persistence and transaction model.
- `docs/release-notes/` — version-specific upgrade notes and limitations.

When implementation and documentation disagree, do not silently broaden a
claim. Fix the implementation or narrow the claim and update the relevant
contract and test in the same change.

## Repository layout

| Path | Purpose | Stack |
| --- | --- | --- |
| `engine/` | BPMN runtime, persistence, REST API and security | Java 21, Spring Boot 3.5, Maven |
| `studio/` | Operator UI (designer, tasks, operations, insight) | React 19, TypeScript, Vite |
| `tenda/` | End-user task application (reference only) | React 18, TypeScript, Vite |
| `orun/` | Operations and workflow-state application (reference only) | React 19, TypeScript, Vite |
| `documentation/` | Curated user, architecture and developer guide | Astro 7, Starlight 0.41, MDX, Mermaid |
| `docker/` | Traefik, Keycloak and observability configuration | Docker Compose |
| `scripts/` | Development, production and test helpers | Shell |
| `docs/` | Architecture, operations, references and release notes | Markdown |
| `release/` | Release deployment composition | Docker Compose |

The backend code is under `engine/src/main/java/com/abada/engine/`:

- `api/`: public REST controllers and DTOs.
- `core/`: workflow commands and execution behavior.
- `parser/`: BPMN parsing and deployment validation.
- `persistence/`: JPA entities and repositories.
- `security/`: OIDC, trusted-proxy mode and permissions.
- `observability/`: metrics and tracing.

## Required toolchain

- Java 21. Use `engine/mvnw`; a globally installed Maven is not required.
- Node.js 24.18.x and npm 11 or newer. `.nvmrc` is authoritative.
- Docker Desktop/Engine for PostgreSQL Testcontainers and image validation.
- Docker Compose v2 (`docker compose`).

Do not upgrade Java or Spring Boot as a side effect of unrelated work. Keep
dependency upgrades focused and explain compatibility-impacting changes.

## Build and test commands

Run commands from the named component directory unless stated otherwise.

### Engine

```bash
cd engine
./mvnw test
./mvnw clean package
```

The full backend suite requires a working Docker daemon because PostgreSQL is
the correctness reference through Testcontainers. H2 is a local convenience,
not evidence for persistence, migration, locking, or concurrency guarantees.

For local development:

```bash
cd engine
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```

For the production artifact:

```bash
cd engine
docker build -f Dockerfile.prod.engine -t abada-engine:local .
```

### Studio

```bash
cd studio
npm ci
npm audit --audit-level=low
npm run lint
npm test
npm run build
```

### Documentation

```bash
cd documentation
npm ci
npm audit --audit-level=low
npm run check
npm run build
```

Starlight validates internal links during the production build. A missing
deployment `site` URL and Mermaid's client bundle may produce non-blocking
sitemap and chunk-size warnings; content, type, link or diagram failures are
blocking.

### Compose validation

```bash
docker compose --env-file release/.env.dev.example -f compose.yaml -f compose.dev.yaml config --quiet
./scripts/test/validate-platform-deployment.sh
```

The contract test validates dev/prod with telemetry disabled, bundled and
external, required-variable failure, frontend runtime configuration and the
self-contained release archive. Documented environment files must produce no
Compose warnings.

## Runtime invariants

PostgreSQL is authoritative in production. Preserve these invariants:

1. A mutation command loads the required records, locks mutable state,
   validates the command, advances the process, persists state/work/history,
   and commits as one transaction.
2. Failed commands roll back workflow state, work records, history, and outbox
   records together.
3. Mutable process instances, tokens, tasks, subscriptions, timers, jobs, and
   variables must not depend on runtime-wide in-memory maps. In-memory caching
   is limited to immutable parsed definitions keyed by definition version.
4. Process definitions are immutable and versioned. Redeployment must not
   change the semantics of already-running instances.
5. Timers and external work use durable leases and retry metadata. Work
   acquisition must be transactional and safe against duplicate state
   transitions.
6. Lifecycle events and webhooks originate from the transactional outbox.
   Consumers must be able to deduplicate by event identifier.
7. External side effects are at-least-once unless an explicit idempotency
   contract proves otherwise. Do not describe them as globally exactly-once.

Use optimistic version columns and database locks deliberately. Avoid adding a
remote call inside a workflow-state transaction unless the runtime contract
explicitly requires it and failure behavior is tested.

## Database and migrations

- Production schemas are owned by Flyway migrations in
  `engine/src/main/resources/db/migration/`.
- Never use Hibernate schema generation for production; `ddl-auto=validate`
  is the production setting.
- Never edit a released migration. Add the next numbered migration.
- Schema changes require PostgreSQL Testcontainers coverage for both a fresh
  database and upgrades from every supported prior schema version.
- Add indexes for new acquisition or query paths and verify their locking and
  concurrency behavior under PostgreSQL.
- Avoid destructive migrations without documented backup, rollback, and
  upgrade guidance.

## BPMN behavior

The support matrix is a tested subset, not a claim of full BPMN compliance.
When changing BPMN behavior:

- Add or update a deployment-validation test.
- Add an executable process model under `engine/src/test/resources/bpmn/`.
- Test successful execution, invalid input, rollback, persistence, and restart
  recovery where applicable.
- Update `docs/reference/bpmn-support.md` and runtime semantics.
- Reject unsupported constructs during deployment instead of accepting an
  ambiguous model.

## API and security contracts

- Keep public engine endpoints under the versioned `/api/v1` namespace. The
  0.11 contract is frozen; verify compatibility against the machine-readable
  contract and document any intentional breaking change before implementation.
- Preserve typed errors, consistent pagination/filtering, DTO compatibility
  and generated OpenAPI accuracy as tracked by the roadmap.
- Mutation endpoints should support deterministic idempotency where defined.
- Production authentication is direct OIDC JWT validation. Trusted proxy
  headers are an explicit deployment mode and must not be safe-by-assumption.
- Enforce permissions for deployments, process control, tasks, operations and
  external workers at the backend, not only in the UI.
- Never log authorization headers, tokens, secrets, or complete sensitive
  payloads. Keep CORS origins explicit in production.
- Append actor, action, timestamps, process/activity identifiers and trace ID
  to audit history for security-relevant mutations.

Any authentication, authorization, CORS, audit, or sensitive-logging change
requires negative tests, including invalid/expired JWTs, forged proxy headers,
role boundaries, and unauthorized task access as applicable.

## Code and change conventions

- Keep changes small and context-oriented. Preserve unrelated user changes in
  a dirty worktree.
- Prefer existing Spring, React and repository patterns over new frameworks.
- Java uses package naming under `com.abada.engine`, constructor injection,
  typed DTOs, and explicit transaction boundaries.
- React code uses functional components, hooks and strict TypeScript. Keep API
  assumptions in shared clients/types rather than duplicating them in views.
- Do not commit generated build output, local databases, logs, secrets, `.env`
  files, or IDE metadata.
- Use Conventional Commit-style messages such as `feat(runtime): ...`,
  `fix(api): ...`, `test(release): ...`, and `docs(architecture): ...`.
- Make separate atomic commits when runtime behavior, tests/documentation, and
  release packaging are independently reviewable.

## Verification expectations

Test in proportion to the change:

| Change | Minimum verification |
| --- | --- |
| Backend logic/API | Relevant tests plus `./mvnw test` |
| Persistence/migration/locking | PostgreSQL Testcontainers, fresh migration, supported upgrade paths, rollback/restart tests |
| Studio | `npm run lint`, `npm test` and `npm run build` |
| Documentation | `npm audit --audit-level=low`, `npm run check` and `npm run build` |
| Docker/Compose | Image build and `docker compose ... config --quiet` |
| Public contract | API compatibility/OpenAPI checks and documentation update |
| Release metadata | Full backend/frontend checks, executable JAR, image build, release notes and deployment matrix review |

Report exactly which checks ran, their result, and any warnings. Do not call a
release ready when required evidence was skipped or when a critical correctness
defect remains.

## Release discipline

- `dev` is the integration branch. Keep it synchronized intentionally; do not
  rewrite shared history.
- Do not push, tag, merge, publish images, or create a GitHub release unless the
  user explicitly requests that external action.
- The Maven project version, OpenAPI/observability version, Compose image tags,
  README status, roadmap gate, and release notes must agree.
- Multi-replica production claims apply only to the PostgreSQL topology covered
  by the 0.10 concurrent-acquisition, lease-recovery, failover and
  duplicate-request tests. External side effects remain at-least-once.
- Before publication, verify an executable Spring Boot JAR, record its SHA-256,
  build the production image, validate release Compose, and confirm a clean
  worktree at the intended commit.

## Documentation maintenance

Architecture documentation is part of the implementation. Update it whenever
state ownership, transaction boundaries, failure recovery, API contracts,
security modes, deployment guarantees, or operational procedures change.
Place superseded design material under `docs/archive/`; do not leave multiple
documents claiming to be the authoritative roadmap.

The curated Starlight site under `documentation/` explains and connects the
authoritative contracts under `docs/`; it does not replace them. Use MDX for
structured components and Mermaid only where a diagram materially clarifies a
relationship or sequence. Keep the user guide deferred until its roadmap
milestone is explicitly started.

@RTK.md
