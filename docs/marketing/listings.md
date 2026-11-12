# Listings and directories

Read each list's contribution guide first; most require a minimum age, a licence, and a
specific line format. Submit one per week rather than all at once.

| Where | Category | Notes |
| --- | --- | --- |
| [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted-data) | Automation / Workflow | Requires the project to be actively maintained and released for some time; check current rules |
| [selfh.st](https://selfh.st/apps/) | App directory | Also pitch Self-Host Weekly |
| [awesome-java](https://github.com/akullpp/awesome-java) | Workflow orchestration engines | Usually requires a minimum number of stars — submit after launch |
| [awesome-workflow-engines](https://github.com/meirwah/awesome-workflow-engines) | Full fledged products | |
| awesome-mcp / awesome-mcp-clients lists | Clients / frameworks | Abada consumes MCP servers |
| awesome-ai-agents / awesome-llm-apps lists | Frameworks / governance | |
| [AlternativeTo](https://alternativeto.net) | Alternative to Camunda, Flowable, n8n | |
| [OpenAlternative](https://openalternative.co) | Open-source alternative to … | |
| [Product Hunt](https://www.producthunt.com) | Developer tools | Launch week |
| [LibHunt](https://www.libhunt.com) | Java | Auto-indexed; claim the page |
| Docker Hub / GHCR README | — | Make the image page link back to the repo and docs |

## Ready-to-paste entries

**Short (one line):**
`Abada - Runtime for governed AI-driven business processes: agents advise, engine-enforced rules decide, humans approve, PostgreSQL stores state and audit. (Source Code) AGPL-3.0 Docker/Java`

**awesome-workflow-engines style:**
`* [Abada](https://github.com/bashizip/abada-platform) - Self-hosted process engine for AI agents, rules and human approval. Processes in YAML (APL) or imported BPMN 2.0; PostgreSQL and RustFS, both self-hosted; Java/Spring Boot.`

**Directory description (≈60 words):**
Abada is an open-source, self-hosted runtime for business processes in which AI agents,
deterministic rules and people work together. The engine validates every model answer
against a declared schema and confidence threshold before it can change state, routes weak
answers to people, and runs agent tool calls under approval policies. It stores process
state in PostgreSQL and, from 1.2, task files in RustFS, both self-hosted; sign-in is through
your OIDC provider.
