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
  model: gpt-5-mini
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

## Safety and delivery

- Requested tools must all appear in `ABADA_AGENT_ALLOWED_TOOLS`. The v1
  sidecar does not execute arbitrary tool code; allowed identifiers are
  provided as model context for adapters added deliberately by operators.
- Model timeouts and task concurrency are bounded. Technical failures consume
  durable engine retries with a bounded retry delay; zero retries creates the
  normal incident.
- Completion and failure use the external task ID as their idempotency key.
- Model and other external effects are at-least-once. Providers and future
  tool adapters must support their own stable deduplication keys.
- Logs contain task/activity IDs and counters, not tokens, prompts, variables,
  credentials, or model responses.

## Sidecar configuration

Required: `ABADA_ENGINE_URL`, `ABADA_AGENT_LLM_BASE_URL`, and
`ABADA_AGENT_LLM_API_KEY`. Select the model with
`ABADA_AGENT_LLM_MODEL`. For secured engines, configure either a short-lived
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
