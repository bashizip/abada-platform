# M3 demo kit: an agent that acts

Stand-ins for the refund-agent example
(`examples/apl/refund-agent.apl.yaml`) and the documentation tutorial
"An agent that acts":

| File | What it is |
| --- | --- |
| `stub_mcp.py` | A `payments` MCP server (streamable HTTP, port 8765): `get_order` (read) and `refund` (a write without idempotency key). Demo data only. |
| `stub_llm.py` | A scripted OpenAI-compatible model (port 8000) that plays the refund agent deterministically. Optional. |
| `compose.demo.yaml` | Dev-stack overlay: runs the stub on the agent worker's loopback and allows the `payments` tool server. |
| `compose.scripted-model.yaml` | Optional overlay: the scripted model instead of a real provider. |

## Run it with the development stack

```bash
docker compose --env-file .env.dev -f compose.yaml -f compose.dev.yaml \
  -f scripts/dev/m3-demo/compose.demo.yaml --profile agent up -d
```

Add `-f scripts/dev/m3-demo/compose.scripted-model.yaml` to use the scripted
model. Recreating the agent worker container disconnects the stub from its
network namespace: restart `payments-mcp` after it.

## Crash a refund on purpose

The next refund takes effect, then the server fails before answering, as a
server crashing mid-write would:

```bash
docker compose ... exec payments-mcp touch /tmp/payments-crash-next-refund
```

The refund tool takes no idempotency key, so the engine never sends the refund
again: the step becomes `OUTCOME_UNKNOWN` and a `TOOL_OUTCOME_UNKNOWN` incident
asks a person. Check what really happened before you confirm:

```bash
docker compose ... exec payments-mcp wget -qO- http://127.0.0.1:8765/refunds
```

## Run it without Docker

Both stubs are single-file Python 3 programs without dependencies:

```bash
python3 scripts/dev/m3-demo/stub_mcp.py   # :8765, crash flag /tmp/payments-crash-next-refund
python3 scripts/dev/m3-demo/stub_llm.py   # :8000, point the worker or an AI provider at http://127.0.0.1:8000/v1
```
