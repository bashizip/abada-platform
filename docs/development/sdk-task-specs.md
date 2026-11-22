# Worker SDK track — task specifications

The tasks of the worker SDK track. The roadmap lists them; this file holds
what each one means. Added on 2026-11-22 and **not yet scheduled**: a
milestone takes these tasks when it is planned, and the release each SDK
ships in is set then.

---

## Why

Abada ships one worker SDK, in Java (`sdk/java`, Apache-2.0). The engine is
Java, but the people who write workers are not all Java teams, and the people
who write AI agents mostly are not: agent code today is written first in
Python, then in TypeScript. A team that must rewrite its agent in Java to
govern it with Abada usually does not adopt Abada. SDKs in the languages those
teams already use remove that step.

It is also cheap compared with engine work. External-worker protocol v1
(`docs/reference/external-worker-protocol-v1.md`) is plain REST and JSON under
`/api/v1/external-tasks`, frozen, only ever extended with optional fields,
and described by the OpenAPI document the engine generates at
`/api/v3/api-docs`. The Java SDK is a thin client (about 800 lines): it does
not hide a large runtime that every other language would have to copy.

## Proposed order (to confirm)

| Order | Language | Why this place |
| --- | --- | --- |
| 1 | Python | The language of AI agents and of most data and ML teams; the shortest path from an existing agent to a governed Abada worker |
| 2 | TypeScript / JavaScript | The second language of agent frameworks and the language of web and integration teams; also what Studio is written in |
| 3 | Go | Platform and SRE teams (the incident-response demo audience), and Kubernetes-native tooling (M7) |
| 4 | .NET (C#) | Banks, insurers and public administrations on Microsoft stacks, which are Abada's target users |

The order is a proposal. Two changes are plausible: .NET before Go if the
design-partner conversations are mostly with banks and public sector on
Microsoft stacks, and stopping after Python and TypeScript until there is
demand for the others.

## Rules for every SDK (apply to L2–L5)

1. **Parity with Java, not more.** Each SDK covers what the Java SDK covers at
   the time: fetch-and-lock (project-scoped and project-agnostic), heartbeat
   and extend-lock, complete, technical failure (with `deferred` and
   `errorCode`), BPMN error, worker self-registration (`PUT /v1/workers/me`),
   AI and tool credentials, the `abada.agent/v1` descriptor, the agent step
   journal and file download within the lease. A feature added to protocol v1
   is added to every SDK in the same release, or the SDK documents that it
   lacks it.
2. **Same safety behaviour.** Reject a missing or unknown protocol version
   (`X-Abada-Worker-Protocol-Version`) and an unknown agent `profileVersion`;
   ignore unknown JSON fields; send an `Idempotency-Key` on every mutation and
   let the caller reuse it on retry; surface typed errors (`403` ownership,
   `409 CONCURRENT_MODIFICATION`, expired lease) instead of strings; never log
   credentials, variables or file bytes.
3. **Transport from the contract, ergonomics by hand.** The HTTP layer may be
   generated from the OpenAPI document; the public API is written by hand and
   idiomatic for the language (async where the language expects it, context or
   cancellation tokens for shutdown).
4. **Bearer authentication and trace context** as in Java: a token supplier
   called per request, W3C `traceparent` / `tracestate` passed through.
5. **Apache-2.0**, with its own `LICENSE`, so workers built on it carry no
   AGPL obligations.
6. **Versioned with the engine** (`1.x.y` like `io.abada:abada-worker-client`)
   and published by the release workflow, never by hand.
7. **No telemetry.** An SDK contacts only the engine it is given.

---

## L1 — Protocol conformance kit

**Goal.** One test suite, independent of language, that proves an SDK speaks
protocol v1 correctly against a real engine.

- Publish the OpenAPI document as a release asset. Extend
  `engine/src/test/resources/contracts/api-v1-contract.json` so the frozen
  surface also lists the operations it does not cover today: agent steps
  (`POST /v1/external-tasks/{id}/steps`) and tool credentials
  (`GET /v1/external-tasks/{id}/tool-credentials/{server}`).
- A scenario set run against an engine started with Testcontainers or Compose:
  lock and complete; heartbeat keeps the lease, an expired lease cannot
  complete; another `workerId` gets `403`; same `Idempotency-Key` with the same
  body is replayed, with another body is rejected; `409` retried safely;
  failure with retries, with `deferred: true` (attempt not consumed) and with
  `errorCode` (routed, never retried); BPMN error; unknown response fields
  ignored; unknown protocol version rejected; agent task with step journal and
  resume after the last committed step; tool credential only under a live
  lease; file download refused after the lease.
- Each SDK provides a small driver (a CLI or test harness) the suite calls, so
  the scenarios are written once.
- The Java SDK passes it first; that run becomes a CI job.

**Done when** the Java SDK passes the suite in CI and a deliberately broken
driver fails it.

## L2 — Python SDK

`sdk/python`, published to PyPI. Supported Python versions: the ones upstream
still supports at release time.

- A synchronous client and an `asyncio` client with the same methods.
- Typed models for locked tasks, the agent work descriptor, steps, limits,
  file references and credentials (dataclasses or Pydantic, decided at the
  start of the task; Pydantic is the more common choice in agent code but is a
  dependency).
- An example: an existing Python agent turned into a governed `abada:agent`
  worker that journals each model and tool call as a step, reports
  low-confidence output for engine routing and respects `budget_usd`.
- Passes L1.

## L3 — TypeScript / JavaScript SDK

`sdk/typescript`, published to npm. Node.js current LTS first, ESM with type
declarations, `fetch` from the platform (no HTTP dependency). Deno and Bun are
checked in CI only if they pass without code changes. Same surface and example
as L2. Passes L1.

## L4 — Go SDK

`sdk/go`, a Go module. Every call takes a `context.Context`. On
cancellation, a worker-loop helper stops heartbeating and lets unfinished
leases expire instead of reporting results it did not produce; it always stops
a task's heartbeat before reporting that task's result, as the protocol
requires. Standard library HTTP only. Passes L1.

## L5 — .NET SDK

`sdk/dotnet`, published to NuGet, C#. Targets the current .NET LTS;
`async`/`await` with `CancellationToken`; `HttpClient` through
`IHttpClientFactory` so it fits ASP.NET Core and worker-service hosts. Passes
L1.

## L6 — Release and documentation

- The release workflow builds, tests (L1) and publishes every SDK with the
  engine version; a failed SDK blocks the release like a failed engine test.
- A quick-start per language in the user guide (`documentation/`), and a
  table of SDKs and their status in the README.
- The README, the site and the claims register name an SDK only once it has
  shipped (AGENTS.md rule 5: evidence over claims).

## Open questions

1. Is the language order right, and should Go and .NET be planned now or only
   on demand?
2. Worker SDKs only, or also a client for the rest of REST API v1 (start an
   instance, complete a human task, query history)? This file proposes worker
   SDKs first; an API client can be generated from the same OpenAPI document
   later.
3. Monorepo (`sdk/<language>` in this repository, released together) or one
   repository per SDK? This file assumes the monorepo, like `sdk/java`.
4. Package names: `abada-worker` on PyPI, `@abada/worker` on npm and
   `Abada.Worker` on NuGet need to be checked for availability and reserved.
5. Which milestone takes L1 and L2: a 1.2.x release next to M6, or after M7?
