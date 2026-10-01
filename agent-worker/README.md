# Abada Agent Worker

First-party Java 21 sidecar for APL `agent` nodes. It registers the global
`abada:agent` capability on startup, consumes the durable
`abada:agent` external-task topic through worker protocol v1 (project-
agnostically; the owning project arrives in each locked-task payload) and
calls an LLM
gateway outside engine transactions. Each model routes to the provider whose
model prefix matches it: Gemini through Google's OpenAI-compatible surface,
every other provider through `/chat/completions`.

Required environment variable: `ABADA_ENGINE_URL`. Model provider keys come
from the engine (Studio → Settings → AI Providers, over the engine's
`ABADA_LLM_*` variables) through `GET /v1/workers/me/ai-credentials`, cached for
`ABADA_AGENT_CREDENTIALS_TTL_MS`; the worker's own `ABADA_AGENT_LLM_*` and
`ABADA_AGENT_OPENAI_*` pairs are a deprecated fallback. For production OIDC,
prefer `ABADA_AGENT_OIDC_TOKEN_URL`, `ABADA_AGENT_OIDC_CLIENT_ID`, and
`ABADA_AGENT_OIDC_CLIENT_SECRET`; `ABADA_ENGINE_TOKEN` remains available for a
pre-issued token. The worker's global capabilities may be restricted with the
comma-separated `ABADA_AGENT_MODELS` list (empty means all models in the
engine allow-list). No project binding is required. Startup registration
retries an engine or identity provider that is not ready yet for up to
`ABADA_AGENT_STARTUP_RETRY_MS` (default 300000). Optional
bounds and the tool allow-list are documented in
`docs/reference/agent-worker.md`.
