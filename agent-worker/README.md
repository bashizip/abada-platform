# Abada Agent Worker

First-party Java 21 sidecar for APL `agent` nodes. It consumes the durable
`abada:agent` external-task topic through worker protocol v1 and calls an
OpenAI-compatible `/chat/completions` gateway outside engine transactions.

Required environment variables: `ABADA_ENGINE_URL`,
`ABADA_AGENT_LLM_BASE_URL`, and `ABADA_AGENT_LLM_API_KEY`. For production OIDC,
prefer `ABADA_AGENT_OIDC_TOKEN_URL`, `ABADA_AGENT_OIDC_CLIENT_ID`, and
`ABADA_AGENT_OIDC_CLIENT_SECRET`; `ABADA_ENGINE_TOKEN` remains available for a
pre-issued token. Optional bounds and the tool allow-list are documented in
`docs/reference/agent-worker.md`.
