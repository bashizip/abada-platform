# Launch kit

Drafts to adapt, not paste blindly. Re-check every claim against the current release notes
before posting. Items marked **[verify]** must be confirmed or removed.

**Updated for `1.1.0`** (gate signed 2026-10-14, [release notes](../release-notes/1.1.0-release-notes.md)).
`1.1.0` is the first release after the RC line, but it is still described as an
**evaluation release**: never call it "production-ready" or "GA" in launch copy.

## The 1.1.0 launch angle

**Headline:** *Abada 1.1.0 — AI processes that improve only with your approval.*

The story in three beats, each backed by the 1.1.0 release notes:

1. **It notices.** When people keep overruling an agent, Insight reports it per agent node
   (override rate, calibration gap, confidence drift, cost per case — at least 20 reviewed
   samples, no per-person statistics).
2. **It proposes and shows its evidence.** A proposed change can be replayed on the newest
   finished cases before anyone approves it, and a policy can require that replay.
3. **People decide, and can undo.** Nothing auto-applies; an approved change becomes a new
   immutable version, and one click rolls back to a previous one. Running instances stay on
   the version they started on.

Always pair beat 2 with its limit: *a replay is evidence, not a verdict — it does not run
tools, called processes, timers or messages, and instances started before 1.1.0 cannot be
replayed.*

## Positioning

**One line:** Abada is the open-source, self-hosted runtime where AI agents advise, rules
decide and humans approve — with PostgreSQL as the record of everything.

**Tagline:** Agents advise. Rules decide. Humans approve. PostgreSQL remembers.

**The problem:** Teams want AI inside real business processes (refunds, KYC, lead
triage, claims), but a model answer that writes straight to a system of record is not
acceptable in production. Agent frameworks run the model; they do not decide what the
answer is allowed to change, who approves it, or what the auditor sees afterwards.

**What Abada does differently (each backed by docs):**

| Claim | Evidence |
| --- | --- |
| The model runs outside the database transaction; its result enters state only through a validating engine command | `docs/architecture/runtime-state.md` |
| Output schema and confidence threshold are enforced by the engine; failures route to a person | `docs/reference/apl-node-reference.md` |
| MCP tools under read / write / approval-required policies; a person approves risky calls with exact arguments | `docs/release-notes/1.1.0-rc.2-release-notes.md` |
| Turns, tokens and spend are bounded and priced by the engine | same |
| Rules are sandboxed CEL, rejected at deployment when unsafe | `docs/reference/bpmn-support.md` |
| Processes are YAML (APL) you review in a pull request; BPMN 2.0 and Camunda 7 definitions import | `docs/reference/apl-specification.md`, docs "BPMN import and compatibility" |
| Self-hosted: your PostgreSQL, your OIDC, your model endpoint (any OpenAI-compatible gateway), telemetry off by default, and the running platform never contacts us (the Linux/macOS installer sends one anonymous, opt-out report: say so, link the privacy page) | `docs/reference/agent-worker.md`, README, `documentation/src/content/docs/user/privacy.mdx` |
| Insight reports override rate, calibration gap, confidence drift and cost per case for reviewed agents | `docs/release-notes/1.1.0-release-notes.md` (E14) |
| A proposed change can be replayed on recent real cases before approval; a policy can require it | same (E15) — tools are not run during a replay |
| Version history, source diff and one-click rollback; running instances keep their version | same (E16) |
| `for-each` runs a governed child process per list item, bounded by `max_items` and `max_parallel` | same (E21) |
| AGPL-3.0, no enterprise edition; worker SDK Apache-2.0 | `LICENSE`, `sdk/java/LICENSE` |

**Audiences and hooks**

| Audience | Hook | Where they are |
| --- | --- | --- |
| Java/Spring devs, Camunda 7 / Flowable users | A self-hosted, PostgreSQL-only engine that imports your Camunda 7 BPMN and adds governed AI | r/java, r/SpringBoot, JUGs, Baeldung/Java Weekly, Devoxx |
| AI / agent engineers | Guardrails that live in the engine, not the prompt — and agents that improve only through replayed, approved, reversible changes | r/LocalLLaMA, r/AI_Agents, AI Engineer meetups, HN |
| Platform / DevOps, self-hosters | One command, Docker only, your infra, no licence server | r/selfhosted, selfh.st, awesome-selfhosted |
| Architects in regulated industries | Audit trail of every model call, human approval, sovereignty | LinkedIn, banking/insurance tech meetups |
| African tech ecosystem | Sovereign, self-hosted AI built by an African engineer **[verify framing with maintainer]** | GDG, DevFest, ALX/Andela communities |

## Show HN

**Title (≤ 80 chars), pick one:**
- `Show HN: Abada – self-hosted runtime where AI agents advise and humans approve`
- `Show HN: Abada 1.1 – AI business processes that improve only with your approval`

**Body:**

> Hi HN, I'm Patrick. I built Abada because every "AI in the business process" demo I saw
> let a model answer write directly to a system of record. That is fine for a demo and
> unacceptable for refunds, KYC or claims.
>
> Abada is a process engine (Java 21, Spring Boot, PostgreSQL only) where:
>
> - the model call runs outside the database transaction, as durable external work;
> - the engine — not the model, the worker or the UI — validates the answer against a
>   declared JSON schema and confidence threshold, and routes weak or malformed answers
>   to a person;
> - agents can use tools from your MCP servers under read / write / approval-required
>   policies; a person approves each risky call with its exact arguments, and a crash
>   never blindly repeats a write;
> - conditions and decision tables are sandboxed CEL; nothing about routing is guessed;
> - when people keep overruling an agent, the engine notices, proposes a small change,
>   lets you replay it on recent real cases first, and only applies it as a new version
>   after a person approves — with one-click rollback.
>
> Processes are written in YAML (we call it APL) so they can be reviewed in a pull request;
> BPMN 2.0 and Camunda 7 definitions can be imported.
>
> Try it with Docker: `curl -fsSL https://install.abadaplatform.com/install.sh | bash`
> (or clone the repo and run `./release/abada-platform up dev`). The running platform never
> contacts us; the installer sends one anonymous install report (version, OS, arch, outcome),
> off with `ABADA_USAGE_PING=0` — details: https://docs.abadaplatform.com/user/privacy/
>
> It is AGPL-3.0 with no enterprise edition; the worker SDK is Apache-2.0. 1.1.0 just
> shipped; it is still an evaluation release: the certified topology is self-hosted Compose
> with one or more engines on PostgreSQL, there has been no independent security review
> yet, and a replay does not run tools — it shows where the path would have differed.
>
> I would love feedback on the APL format and on the agent governance model — what would
> you need before letting an agent touch production data?
>
> Repo: https://github.com/bashizip/abada-platform · Docs: https://docs.abadaplatform.com

**Rules for the day:** post Tue–Thu, 8–9 am US Eastern. Do not ask anyone to upvote (HN
penalises it). Reply to every comment within the first 3 hours, technically and without
defensiveness. Have the FAQ below open.

## Reddit

- **r/selfhosted** — title: "Abada: self-hosted process engine for AI workflows with
  human approval (Docker, PostgreSQL, OIDC)". Lead with the install command, screenshots,
  resource needs (≈1 GB RAM idle for the whole dev stack, ≈2.4 GB of images — see *Measured footprint*), and "telemetry off by default" — plus the honest line that the installer sends one anonymous report you can opt out of (`ABADA_USAGE_PING=0` / `DO_NOT_TRACK=1`), with a link to the privacy page. This audience will read `install.sh`; say it before they find it.
- **r/java / r/SpringBoot** — lead with the engineering: transactional outbox, durable
  leases, PostgreSQL Testcontainers as the correctness reference, Camunda 7 import.
  Link the cornerstone post, not the homepage.
- **r/LocalLLaMA** — "Put a local model behind schema validation and human approval".
  Only post after testing an Ollama or vLLM OpenAI-compatible endpoint end to end **[verify]**.

Reddit etiquette: one subreddit per day, answer comments, read each subreddit's
self-promotion rule first, and be a participant there before and after.

## Product Hunt

- Name: Abada · Tagline: "AI business processes that improve only with your approval"
- Gallery: showcase GIF, Studio designer, approval task, audit trail, APL YAML.
- First comment: the "why" paragraph of the Show HN post.

## Newsletter pitch (email or submission form)

> Subject: Abada 1.1.0 — open-source runtime for governed AI business processes (self-hosted, Java)
>
> Hi <name>, Abada is an AGPL, self-hosted process engine where AI agents advise, rules
> decide and humans approve. The engine validates every model answer against a schema and
> confidence threshold before it can change process state, and agents' MCP tool calls run
> under approval policies. New in 1.1.0: when people keep overruling an agent, Abada
> proposes a change, replays it on recent real cases, and applies it only after approval,
> with one-click rollback. Java 21 / Spring Boot / PostgreSQL; BPMN and Camunda 7 import.
> Might fit <newsletter section>. Repo: https://github.com/bashizip/abada-platform —
> 2-minute install: https://docs.abadaplatform.com/user/quickstart/ . Thanks, Patrick

Targets: Java Weekly (Baeldung), This Week in Spring, JVM Weekly, Console.dev,
Changelog News, TLDR (AI / DevOps), Self-Host Weekly (selfh.st), DevOps'ish, AI newsletters.

## Objections FAQ (keep open during launch)

| Question | Honest answer |
| --- | --- |
| Why AGPL? | So improvements to a hosted Abada stay open; there is no enterprise edition held back. Workers you write against the SDK are Apache-2.0, so your business code is not affected by the AGPL. Releases up to `1.0.0-rc.5` were MIT. |
| Why not Temporal? | Temporal is a durable code-execution platform; Abada is a process runtime with human tasks, BPMN import, decision tables and an engine-enforced contract for AI output. Different layer — see `comparison-draft.md`. |
| Why not n8n / Zapier? | Those are integration automation tools. Abada targets processes that need audit, human approval and transactional state in your own PostgreSQL. |
| Why not just LangGraph? | LangGraph orchestrates the model; Abada decides what the model's answer is allowed to change, persists the process durably and puts people in the loop. They can be combined: a LangGraph agent can be an external worker. **[verify example exists before saying so]** |
| Is it production ready? | 1.1.0 is an evaluation release. Certified: self-hosted Docker Compose, one or more engines on PostgreSQL. Not yet: public-cloud certification, independent security review. A [pilot runbook](../operations/pilot-runbook.md) exists for teams trying it on real processes. |
| Does the AI change my process by itself? | No. Insight only proposes; a person approves (after a replay if policy requires it), the change becomes a new immutable version, running instances keep their version, and rollback is one click. |
| What does a replay actually run? | The proposed process, in memory, on the newest finished cases: one model call per agent step, reviewer steps answered from what the original reviewer decided. Tools, called processes, timers and messages are not run. It has a bounded size and an optional budget. |
| Single maintainer? | Yes today. That is why contributors are wanted; the test suite, gate reports and AGENTS.md exist so others can contribute safely. |
| Does it phone home? | The running platform never contacts us. It reaches only what you configure or enable: your model providers (agent calls, a test call on save, their model list once a day), your MCP tool servers, your identity provider, and a public price catalog once a day (a plain GET with nothing from your installation; `ABADA_PRICE_CATALOG_ENABLED=false` turns it off). OpenTelemetry is off by default and, when on, goes only to your collector. The Linux/macOS installer sends one anonymous report when it finishes (version, OS, CPU architecture, Docker version, outcome; country from the IP, which is not stored). Opt out with `ABADA_USAGE_PING=0` or `DO_NOT_TRACK=1`; a clone-and-run install sends nothing. See the [privacy page](https://docs.abadaplatform.com/user/privacy/). |
| Which models? | Gemini, OpenAI, Anthropic, DeepSeek, OpenRouter or any OpenAI-compatible gateway. |
| Resource needs? | The full dev stack (8 containers incl. Keycloak and two PostgreSQL) uses about 1 GB of RAM at idle and well under 0.1 CPU core; the engine is ~560 MB of that. Images take about 2.4 GB of disk. Give Docker at least 4 GB. Measured on Apple silicon — see *Measured footprint*. |

## Talk abstract

**Title:** Governing AI agents with a durable state machine

**Abstract (≈150 words):** An LLM is a probabilistic advisor; a business process is a
deterministic, auditable commitment. Wiring one directly into the other is how agent
demos become production incidents. This talk shows an architecture that keeps them
apart: the model runs outside the database transaction as durable external work, and its
answer enters process state only through an engine command that validates it against a
declared schema and confidence threshold. Weak answers go to people; risky tool calls wait
for human approval with their exact arguments; decision rules stay in sandboxed CEL;
PostgreSQL holds every attempt as evidence. We will walk through the transactional outbox,
lease-based work acquisition, crash-safe tool writes and a live demo with the open-source
Abada runtime — and discuss what we got wrong along the way.

**Formats:** 45-min talk, 20-min short version, 3-hour hands-on lab (install → agent
process → approval → audit).

## Measured footprint

Measured 2026-10-14 with `docker stats` (5 samples, 6 s apart) on a warm, idle dev stack
(`./release/abada-platform up dev`, locally built `:local` images, up for 39 hours) on
Apple silicon, Docker Desktop with 10 CPUs and 7.75 GiB of memory.

| Container | Idle memory | Memory limit | Idle CPU | Image size |
| --- | --- | --- | --- | --- |
| Engine | 561 MiB | 2 GiB | 0.6–1.4 % | 639 MB |
| Keycloak (dev identity) | 297 MiB | 1 GiB | 0.2 % | 726 MB |
| Agent worker | 72 MiB | 512 MiB | 0.3–1.2 % | 298 MB |
| PostgreSQL (Abada) | 42 MiB | 1 GiB | 0.5–1.9 % | 380 MB (shared) |
| Traefik | 38 MiB | 256 MiB | 0 % | 225 MB |
| PostgreSQL (Keycloak) | 26 MiB | 512 MiB | 0–1.2 % | shared |
| Studio | 9 MiB | 256 MiB | 0 % | 82 MB |
| Docs | 9 MiB | 128 MiB | 0 % | 89 MB |
| **Total** | **≈1.05 GiB** | 5.6 GiB | **< 0.1 core** | **≈2.4 GB** |

What this does **not** show, so do not claim it yet:

- **Startup peak and load.** The JVMs (engine, Keycloak) use more memory while starting
  and under load; the limits above (5.6 GiB in total) are the ceiling the Compose files allow.
- **Published images.** The GHCR images used by the installer can differ in size from
  local builds; check them before quoting disk figures for the installer.
- **x86-64.** Only measured on Apple silicon.

Safe public wording: *"The whole dev stack idles at about 1 GB of RAM; give Docker 4 GB."*
