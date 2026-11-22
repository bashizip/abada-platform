# SDK track — task specifications

The tasks of the SDK track. The roadmap lists them; this file holds what each
one means. Added and decided on 2026-11-22: L1 and L2 ship in 1.2.x next to
M6, with dates set when 1.2.0 ships; L3–L7 follow in that order, and the
release each one ships in is set when L2 has shipped.

---

## Why

Abada ships one SDK, in Java (`sdk/java`, Apache-2.0), and it covers only the
worker side. The engine is Java, but the people who write workers are not all
Java teams, and the people who write AI agents mostly are not: agent code is
written first in Python. The applications that start processes and handle
human tasks are written in whatever the organisation already runs, and in
Abada's target market (banks, telcos, public sector) that is often C#. A team
that must rewrite its agent in Java, or hand-write HTTP calls from its .NET
application, usually does not adopt Abada. SDKs in the languages those teams
already use remove that step.

It is also cheap compared with engine work. External-worker protocol v1
(`docs/reference/external-worker-protocol-v1.md`) and REST API v1
(`docs/reference/api-v1.md`) are plain REST and JSON, frozen, only ever
extended with optional fields, and described by the OpenAPI document the
engine generates at `/api/v3/api-docs`, checked in CI by
`OpenApiContractTest` against `api-v1-contract.json`. The Java worker SDK is a
thin client (about 800 lines): it does not hide a large runtime that every
other language would have to copy.

## Language order (decided 2026-11-22)

| Order | Task | Language | Why this place |
| --- | --- | --- | --- |
| 1 | L2 | Python | The language of AI agents and of most data and ML teams; the shortest path from an existing agent to a governed Abada worker |
| 2 | L3 | .NET (C#) | Banks, insurers and public administrations on Microsoft stacks, which are Abada's target users |
| 3 | L4 | TypeScript / JavaScript | The second language of agent frameworks and of web and integration teams; also what Studio is written in |
| 4 | L5 | Go | Platform and SRE teams (the incident-response demo audience) and Kubernetes-native tooling (M7) |

L6 then gives Java the API client, so every language offers both parts.

## Two parts in every SDK

1. **Worker client** — external-worker protocol v1, for code that does work
   for the engine: fetch-and-lock (project-scoped and project-agnostic),
   heartbeat and extend-lock, complete, technical failure (with `deferred` and
   `errorCode`), BPMN error, worker self-registration (`PUT /v1/workers/me`),
   AI and tool credentials, the `abada.agent/v1` descriptor, the agent step
   journal and file download within the lease. Parity with the Java worker
   SDK.
2. **API client** — the application side of REST API v1, for code that drives
   processes: deploy a definition (`/v1/processes/deploy`), start an instance
   (`/v1/processes/start`), send messages and signals (`/v1/events/*`), list
   and read instances, their variables, activity instances and history;
   suspend, resume and cancel; list, read, claim, unclaim and complete human
   tasks, record review decisions, upload a file to a task; list and retry
   incidents and jobs; validate APL (`/v1/apl/validate`).

   Out of scope for the API client: Studio-only and administration endpoints
   (authoring documents and folders, AI providers, model prices, insight
   configuration and proposal review, platform administration). They change
   with Studio and are not a stable integration surface yet; they can be added
   later, one area at a time, if users ask.

## Rules for every SDK (apply to L2–L6)

1. **Parity across languages.** A feature added to protocol v1 or to the
   API-client surface is added to every shipped SDK in the same release, or
   the SDK documents that it lacks it.
2. **Same safety behaviour.** Reject a missing or unknown protocol version
   (`X-Abada-Worker-Protocol-Version`) and an unknown agent `profileVersion`;
   ignore unknown JSON fields; send an `Idempotency-Key` on every mutation and
   let the caller reuse it on retry; surface the typed error envelope
   (`403` ownership, `409 CONCURRENT_MODIFICATION`, expired lease, validation
   errors) as typed exceptions or errors, not strings; never log credentials,
   variables or file bytes.
3. **Transport from the contract, ergonomics by hand.** The HTTP layer may be
   generated from the OpenAPI document; the public API is written by hand and
   idiomatic for the language (async where the language expects it, context or
   cancellation tokens for shutdown, iterators over paginated lists).
4. **Bearer authentication and trace context** as in Java: a token supplier
   called per request (worker credential for the worker client, a user or
   service-account OIDC token for the API client), W3C `traceparent` /
   `tracestate` passed through.
5. **Apache-2.0**, with its own `LICENSE`, so code built on it carries no AGPL
   obligations.
6. **Versioned with the engine** (`1.x.y` like `io.abada:abada-worker-client`)
   and published by the release workflow, never by hand.
7. **No telemetry.** An SDK contacts only the engine it is given.

---

## L1 — Conformance kit

**Goal.** One test suite, independent of language, that proves an SDK speaks
protocol v1 and REST API v1 correctly against a real engine.

- Publish the OpenAPI document as a release asset. Extend
  `engine/src/test/resources/contracts/api-v1-contract.json` so the frozen
  surface also lists the worker operations it does not cover today: agent
  steps (`POST /v1/external-tasks/{id}/steps`) and tool credentials
  (`GET /v1/external-tasks/{id}/tool-credentials/{server}`).
- Worker scenarios, against an engine started with Testcontainers or Compose:
  lock and complete; heartbeat keeps the lease, an expired lease cannot
  complete; another `workerId` gets `403`; same `Idempotency-Key` with the same
  body is replayed, with another body is rejected; `409` retried safely;
  failure with retries, with `deferred: true` (attempt not consumed) and with
  `errorCode` (routed, never retried); BPMN error; unknown response fields
  ignored; unknown protocol version rejected; agent task with step journal and
  resume after the last committed step; tool credential only under a live
  lease; file download refused after the lease.
- API scenarios: deploy an APL definition, start an instance with variables,
  correlate a message and broadcast a signal, read the instance, its variables
  and history, claim and complete a human task with a review decision, an
  invalid request returns the typed error envelope, a paginated list is read
  to the end, an incident is listed and retried.
- Each SDK provides a small driver (a CLI or test harness) the suite calls, so
  the scenarios are written once.
- The Java worker SDK passes the worker scenarios first; that run becomes a CI
  job. The API scenarios are proven first by L2.

**Done when** the Java worker SDK passes the worker scenarios in CI and a
deliberately broken driver fails them.

## L2 — Python SDK

`sdk/python`, published to PyPI. Supported Python versions: the ones upstream
still supports at release time.

- Worker and API clients, each synchronous and `asyncio`, with the same
  methods.
- Typed models for locked tasks, the agent work descriptor, steps, limits,
  file references, credentials, instances, tasks and errors (dataclasses or
  Pydantic, decided at the start of the task; Pydantic is the more common
  choice in agent code but is a dependency).
- Two examples: an existing Python agent turned into a governed `abada:agent`
  worker that journals each model and tool call as a step, reports
  low-confidence output for engine routing and respects `budget_usd`; and a
  small application that starts an instance and completes its human task.
- Passes L1.

## L3 — .NET SDK

`sdk/dotnet`, published to NuGet, C#. Targets the current .NET LTS.

- Worker and API clients; `async`/`await` with `CancellationToken` on every
  call; `HttpClient` through `IHttpClientFactory` and registration helpers for
  dependency injection, so it fits ASP.NET Core and worker-service hosts.
- A hosted-service helper for workers that stops heartbeats and leaves
  unfinished leases to expire on shutdown.
- Same examples as L2. Passes L1.

## L4 — TypeScript / JavaScript SDK

`sdk/typescript`, published to npm. Node.js current LTS first, ESM with type
declarations, `fetch` from the platform (no HTTP dependency). Deno and Bun are
checked in CI only if they pass without code changes. Worker and API clients,
same examples as L2. Passes L1.

## L5 — Go SDK

`sdk/go`, a Go module. Worker and API clients; every call takes a
`context.Context`. On cancellation, a worker-loop helper stops heartbeating
and lets unfinished leases expire instead of reporting results it did not
produce; it always stops a task's heartbeat before reporting that task's
result, as the protocol requires. Standard library HTTP only. Passes L1.

## L6 — Java API client

`sdk/java` gains the API client next to the existing worker client (a second
artifact or a second package in the same artifact, decided at the start of the
task), so Java offers both parts like every other language. The worker client
does not change. Passes the API scenarios of L1.

## L7 — Release and documentation

- The release workflow builds, tests (L1) and publishes every SDK with the
  engine version; a failed SDK blocks the release like a failed engine test.
- A quick-start per language in the user guide (`documentation/`), for both
  the worker and the API client, and a table of SDKs and their status in the
  README.
- The README, the site and the claims register name an SDK only once it has
  shipped (AGENTS.md rule 5: evidence over claims).

## Open questions

1. Monorepo (`sdk/<language>` in this repository, released together) or one
   repository per SDK? This file assumes the monorepo, like `sdk/java`.
2. Package names: `abada` or `abada-sdk` on PyPI, `Abada.Sdk` on NuGet and
   `@abada/sdk` on npm need to be checked for availability and reserved
   before L2 starts.
