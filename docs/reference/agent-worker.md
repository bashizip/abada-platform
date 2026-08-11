# Agent worker and `abada.agent/v1` profile

APL `agent` nodes compile directly to durable external tasks on
`abada:agent`. The engine does not invoke a model in a workflow transaction.
The optional first-party Java 21 sidecar in `agent-worker/` consumes these
tasks with the Java SDK and worker protocol v1.

## APL contract

```yaml
- id: summarize
  type: agent
  profile: abada.agent/v1
  model: gemini-2.5-flash
  prompt: Summarize case ${caseId} as JSON.
  inputs:
    caseId: ${caseId}
    content: ${content}
  result_variable: summary
  output_schema:
    type: object
  tools: [crm.read]
  confidence_threshold: 80
  temperature: 0.2
  max_tokens: 2048
  timeout_ms: 60000
  max_attempts: 3
  retry_backoff_ms: 2000
  next: review
```

`profile` is fixed to `abada.agent/v1`. Deployment rejects invalid confidence,
temperature, timeout, token, attempt, and backoff bounds. The locked-task
response contains the same descriptor as optional `agentWork`; ordinary BPMN
and `engine-task` workers continue to receive `null`, preserving protocol-v1
compatibility.

If `output_schema` is present, the worker requires a JSON object. An optional
`_confidence` field is checked against `confidence_threshold`. The object (or
plain text without a schema) is merged under `result_variable` only through
the normal external-task completion command.

## Durable attempt metadata

Each completion and failure carries an optional additive `agent` block (the
`AgentAttemptMetadata` contract). The engine persists it on the external-task
record and in activity history so model attempts and results are observable
without logging prompts, tokens, credentials, or complete sensitive payloads:

- `model`: the resolved model actually used (descriptor `model`, falling back
  to `ABADA_AGENT_LLM_MODEL`).
- `provider`: the gateway family (`openai-compatible` or `google-gemini`).
- `attempt`: the 1-based attempt number for this task.
- `durationMs`: the model call duration.
- `tools`: the tool identifiers the task was allowed to involve.
- `resultVariable`: the process variable the result was merged under.
- `promptHash`: a stable SHA-256 prefix of the prompt template (never the
  prompt text, variables, or rendered inputs).
- `errorType`: the failure class name, on failure reports only.
- `confidence`: the achieved `_confidence` score (0–100) the model reported
  for a structured output, when present. It is the same value that was gated
  against `confidence_threshold` before the attempt completed, so operators
  can see how much headroom an agent node actually had.

The `EXTERNAL_TASK_LOCKED` history event records the durable request facts
(requested model, result variable, allowed tools and confidence threshold)
from the definition; the `EXTERNAL_TASK_COMPLETED` and `EXTERNAL_TASK_FAILED`
events carry the attempt metadata above. The external-task row keeps the same
JSON on its `agent_metadata` column, so model/tool/confidence facts survive
restarts and are ready for the live instance view, where the achieved score
is rendered against the declared threshold.

## Safety and delivery

- Requested tools must all appear in `ABADA_AGENT_ALLOWED_TOOLS`. The v1
  sidecar does not execute arbitrary tool code; allowed identifiers are
  provided as model context for adapters added deliberately by operators.
- Model timeouts and task concurrency are bounded. Technical failures consume
  durable engine retries with a bounded retry delay; zero retries creates the
  normal incident. Agent-task retries are seeded from the APL `max_attempts`
  so the durable retry budget matches the descriptor.
- Completion and failure use the external task ID as their idempotency key.
- Model and other external effects are at-least-once. Providers and future
  tool adapters must support their own stable deduplication keys.
- Logs contain task/activity IDs and counters, not tokens, prompts, variables,
  credentials, or model responses.

## Sidecar configuration

Required: `ABADA_ENGINE_URL` plus at least one LLM endpoint pair
(`ABADA_AGENT_LLM_BASE_URL`/`ABADA_AGENT_LLM_API_KEY` and/or
`ABADA_AGENT_OPENAI_BASE_URL`/`ABADA_AGENT_OPENAI_API_KEY`); each endpoint
falls back to the other when unset. Select the model with
`ABADA_AGENT_LLM_MODEL`. The sidecar routes each task to a provider gateway
from the requested model name (the descriptor `model` field, falling back to
`ABADA_AGENT_LLM_MODEL`): models starting with `gemini` or the `google/`
prefix use the Google Gemini REST `:generateContent` endpoint with the API
key sent as `x-goog-api-key` (the `google/` prefix is stripped from the model
path); all other models use an OpenAI-compatible `/chat/completions` endpoint
with `Authorization: Bearer`. Both gateways share the same prompt rendering,
selected-inputs, output-schema and `_confidence` handling. By default the
OpenAI-compatible gateway reuses the same endpoint and key. To route
non-Gemini models to a different OpenAI-compatible endpoint (DeepSeek,
OpenRouter, a local gateway, ...), set `ABADA_AGENT_OPENAI_BASE_URL` and
`ABADA_AGENT_OPENAI_API_KEY`; when unset they fall back to
`ABADA_AGENT_LLM_BASE_URL` and `ABADA_AGENT_LLM_API_KEY`. For secured
engines, configure either a short-lived
`ABADA_ENGINE_TOKEN` or the preferred OIDC client-credentials settings:
`ABADA_AGENT_OIDC_TOKEN_URL`, `ABADA_AGENT_OIDC_CLIENT_ID`, and
`ABADA_AGENT_OIDC_CLIENT_SECRET`. The token is cached only until shortly
before expiry. A secured worker also sets `ABADA_AGENT_PROJECT_ID`; its OIDC
service principal must have the global worker authority and an Owner-created
binding for that project and every topic it polls. The engine rejects an
unscoped secured fetch or a topic outside the binding.

The Compose service is opt-in through the `agent` profile. Build locally by
installing `sdk/java` and packaging `agent-worker` with the Java 21 Maven
wrapper under `engine/`.

## Development quickstart

The dev stack authenticates with the bundled Keycloak in OIDC mode, so the
worker uses OIDC client credentials instead of a static engine token. Run the
targeted suite with:

```bash
# 1. Start the dev stack (creates .env.dev from the safe defaults)
./release/abada-platform up dev --agent

# 2. Point the worker at an OpenAI-compatible endpoint in .env.dev
#    ABADA_AGENT_LLM_BASE_URL / ABADA_AGENT_LLM_API_KEY (or reuse ABADA_LLM_*)
#    and choose a client secret:
#    ABADA_AGENT_OIDC_CLIENT_SECRET=<long random value>

# 3. One-time Keycloak + binding provisioning (idempotent)
./scripts/dev/provision-agent-worker.sh

# 4. After any worker or SDK change, rebuild the local image and redeploy
./scripts/dev/build-agent-worker.sh
```

Provisioning creates the `abada-agent-worker` confidential client with the
engine audience and groups mappers, puts its service account in the
`abada-worker` group, and binds the observed principal to the Default
project's `abada:agent` topic. The worker then runs with
`ABADA_AGENT_PROJECT_ID=00000000-0000-0000-0000-000000000001` and polls that
topic. Deploy an APL definition with an `agent` node (for example
`examples/lead-triage-demo.apl.yaml`) from Studio; completion and failure
attempt metadata is visible on the external-task row and in activity history.
