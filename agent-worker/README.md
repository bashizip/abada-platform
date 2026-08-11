# Abada Agent Worker

First-party Java 21 sidecar for APL `agent` nodes. It consumes the durable
`abada:agent` external-task topic through worker protocol v1 and calls an LLM
gateway outside engine transactions. A model-name factory routes `gemini*`
and `google/` models to the Google Gemini REST `:generateContent` endpoint
and all other models to an OpenAI-compatible `/chat/completions` endpoint.

Required environment variables: `ABADA_ENGINE_URL`,
`ABADA_AGENT_LLM_BASE_URL`, and `ABADA_AGENT_LLM_API_KEY`. For production OIDC,
prefer `ABADA_AGENT_OIDC_TOKEN_URL`, `ABADA_AGENT_OIDC_CLIENT_ID`, and
`ABADA_AGENT_OIDC_CLIENT_SECRET`; `ABADA_ENGINE_TOKEN` remains available for a
pre-issued token. Secured deployments also set `ABADA_AGENT_PROJECT_ID` and
bind that service principal to the project's `abada:agent` topic. Optional
bounds and the tool allow-list are documented in
`docs/reference/agent-worker.md`.
