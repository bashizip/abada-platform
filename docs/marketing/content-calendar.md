# Content calendar

Publish long posts on your own domain first (canonical URL), then cross-post to dev.to,
Hashnode, Medium and as a LinkedIn article with `canonical_url` set. Every piece ends with
the one-line install command and a link to the repo.

## Cornerstone posts

### 1. Agents advise, rules decide: why the model must run outside the transaction
- The failure mode: model answer → direct write → incident. A concrete refund example.
- Why a model call inside a DB transaction is wrong (latency, locks, retries, cost).
- Abada's pattern: durable external work → validating engine command → state change.
- Schema + confidence threshold + `on_low_confidence` / `on_invalid_output` routes (APL snippet from the README).
- What PostgreSQL keeps as evidence for each attempt.
- Audience: AI engineers, architects. Channels: HN, r/programming, LinkedIn.

### 2. Coming from Camunda 7: a self-hosted path (PostgreSQL, plus RustFS for task files from 1.2) with governed AI
- Context for Camunda 7 Community Edition users planning a move **[verify current Camunda 7 CE status and dates before publishing]**.
- What imports today (Camunda 7 profile, `camunda:topic`, `camunda:class` allow-list, `formKey`) and what is rejected (subprocesses, multi-instance, …) — straight from `docs/reference/bpmn-support.md`. Honesty here builds trust.
- Walkthrough: import `examples/bpmn/camunda-7-assignment.bpmn`, run it, add an agent step.
- Audience: Java/Spring. Channels: r/java, Java Weekly, JUGs.

### 3. Human approval for MCP tool calls, with the exact arguments
- Read / write / approval-required policies; what the approver sees.
- Crash safety: why a write is never blindly repeated.
- Bounded turns, tokens and spend priced by the engine.
- Based on the "agent that acts" tutorial.
- Audience: AI/agent engineers. Channels: r/AI_Agents, MCP communities, HN.

### 4. APL: a process language you can review in a pull request
- Why YAML over BPMN XML for day-to-day authoring; BPMN stays importable.
- Bounded loops by construction, loud failures instead of guesses.
- Diff of a real process change in a PR; Studio round trip.
- Audience: developers, platform teams. Channels: dev.to, Hashnode, r/programming.

### 5. Replay before approval: letting an AI process improve without letting it change itself (1.1.0)
- The trap: "self-improving agents" that rewrite their own prompts in production.
- What Abada does instead: override-rate and drift signals → a proposed change → replay on the newest finished cases → a person approves → a new immutable version → one-click rollback.
- Be explicit about the limits (replay is evidence, not a verdict; tools are not run; pre-1.1.0 instances cannot be replayed). Honesty is the hook for HN.
- Demo: the M4 exit scenario from the roadmap (override-rate finding → replay on 20 cases → approve from the diff → rollback).
- Audience: AI engineers, architects. Channels: HN (launch week), LinkedIn, r/MachineLearning-adjacent communities.

### Later topics
- "PostgreSQL as the only state store for a workflow engine (files go to RustFS): outbox, leases and SKIP LOCKED" **[verify locking approach]**
- "What our release gates check before every RC" (evidence over claims)
- Use-case posts: KYC onboarding, refund agent, support triage (from `examples/apl/`)

## Videos

| # | Length | Script |
| --- | --- | --- |
| 1 | 3 min | Install with one command → open Studio → run lead triage → low-confidence answer lands in a human task → approve → audit trail → (1.1.0) Insight flags the override rate → replay the proposal → approve → roll back in one click (detailed shot list: `docs/assets/video/m4-demo-script.md`) |
| 2 | 8 min | Write a process in APL from scratch, deploy, break the schema on purpose, show the route to a person |
| 3 | 10 min | Agent with MCP tools: approval-required write, exact arguments, crash mid-call, no duplicate write |
| 4 | 5 min | Import a Camunda 7 BPMN file and add an agent step |
| Monthly | 60 min | Livestream "office hours": build a process live, answer questions, review a community PR |

Cut each video into 30–60 s clips for X, LinkedIn and YouTube Shorts. Reuse the docs
screenshot stack (isolated OIDC + stub LLM + Playwright) for reproducible recordings.

## Social post bank

1. "Agents advise. Rules decide. Humans approve. PostgreSQL remembers. That's the whole design of Abada, an open-source runtime for AI business processes. 🧵"
2. "Hot take: the model should never run inside your database transaction. Here's why, and what to do instead → <post 1>"
3. "Your agent wants to issue a €4,000 refund. Abada shows a person the exact tool call and arguments before anything happens. <clip>"
4. "Every process in Abada is YAML you can review in a pull request. Here's a lead-triage agent in 40 lines. <image of README snippet>"
5. "One command, Docker only: `curl -fsSL https://install.abadaplatform.com/install.sh | bash`"
6. "Thank you @<contributor> for <PR> — first contribution to Abada! 🎉"
7. "Release <version>: <one user-visible change> <GIF>"

Cadence: 3 per week, alternating educational / demo / community.

## 12-week calendar

| Week | Long-form | Video | Outreach |
| --- | --- | --- | --- |
| 1 | — | — | GitHub settings, labels, seed issues, Hacktoberfest |
| 2 | — | Video 1 | GitHub Release with GIF; awesome-selfhosted, AlternativeTo |
| 3 | Post 1 | — | r/selfhosted soft launch; Java/Spring Discords |
| 4 | — | Video 2 | awesome-java, awesome-mcp / agent lists; feedback fixes |
| 5 | Post 5 (1.1.0 replay) | — | **Launch week:** Show HN, Product Hunt, Reddit, newsletters |
| 6 | — | Video 3 | Follow-ups, answer every thread, CFP 1 |
| 7 | Post 3 | — | r/AI_Agents, MCP communities; office hours #1 |
| 8 | — | Video 4 | Java Weekly / This Week in Spring pitch, CFP 2 |
| 9 | Post 4 | — | dev.to / Hashnode series; JUG talk outreach |
| 10 | — | Clip set | Partnerships: MCP server projects, model gateways |
| 11 | Use-case post | — | Office hours #2; contributor shout-outs |
| 12 | Retro post: "12 weeks of building in public" | — | Review metrics, plan next quarter |
