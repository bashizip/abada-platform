# How Abada compares — DRAFT, do not publish unverified

Statements about other products are general characterisations and must be checked against
their current documentation (and dated) before this becomes a public page. Keep the tone
factual and generous: say where each alternative is the better choice.

| | Abada | Camunda 7 CE | Camunda 8 | Temporal | n8n | LangGraph |
| --- | --- | --- | --- | --- | --- | --- |
| What it is | Process runtime for AI agents, rules and people | BPMN process engine | BPMN orchestration platform | Durable code execution | Integration automation | Agent orchestration library |
| Process definition | APL (YAML); BPMN 2.0 import | BPMN XML | BPMN XML | Code | Visual nodes | Code (graph) |
| Engine-enforced AI output contract (schema, confidence, routes) | Yes | No | **[verify]** | No (in your code) | **[verify]** | In your code |
| Human approval of agent tool calls with exact arguments | Yes | No | **[verify]** | In your code | **[verify]** | Interrupts, in your code |
| Human tasks and forms | Yes | Yes | Yes | No (build it) | Limited **[verify]** | No |
| Storage | PostgreSQL + RustFS (task files), both self-hosted, from 1.2 | Relational DBs | Zeebe + Elasticsearch/OpenSearch **[verify]** | Cassandra / MySQL / PostgreSQL | PostgreSQL / SQLite | Checkpointer of your choice |
| Self-hosted | Yes, all features | Yes | Licence terms apply **[verify]** | Yes | Fair-code licence **[verify]** | Library |
| Licence | AGPL-3.0 (SDK Apache-2.0) | Apache-2.0 | **[verify]** | MIT | Sustainable Use **[verify]** | MIT |

## Where the alternative is the better choice

- **Temporal** — you want long-running workflows as code in many languages and do not
  need BPMN, human tasks or an AI output contract.
- **n8n** — you mainly connect SaaS tools with hundreds of ready-made integrations.
- **Camunda 8** — you need its enterprise support and full BPMN coverage at large scale.
- **LangGraph** — you are building the agent itself; Abada can govern it as a worker.

## Where Abada fits best

A business process that must combine AI judgement, deterministic rules and human
approval, with an auditable record in your own PostgreSQL and no vendor cloud.
