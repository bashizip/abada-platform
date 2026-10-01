# AI providers

Agent tasks, the Insight loop and APL authoring call large language models
through **AI providers**. Since `1.0.0-rc.8` there is one configuration for
all three, managed in Studio and resolved by the engine.

## Where keys come from

For each provider id the engine uses, in order:

1. **Studio** (Settings > AI Providers): a saved, enabled provider with a key.
   Keys are write-only in the API (responses carry a hint such as `****abcd`)
   and stored AES-256-GCM encrypted with `ABADA_ENCRYPTION_KEY`.
2. **Engine environment**, a developer/bootstrap default:
   - per provider: `ABADA_LLM_<PROVIDER>_API_KEY`, optionally
     `ABADA_LLM_<PROVIDER>_BASE_URL`, for `GEMINI`, `OPENAI`, `ANTHROPIC`,
     `DEEPSEEK` and `OPENROUTER`;
   - one default provider: `ABADA_LLM_API_KEY` with `ABADA_LLM_BASE_URL`,
     `ABADA_LLM_MODEL` and `ABADA_LLM_PROVIDER` (inferred from the base URL
     when empty; a bare Gemini `/v1beta` base is corrected to `/v1beta/openai`);
   - deprecated, still honoured: the rc.7 worker variables
     `ABADA_AGENT_LLM_API_KEY`/`_BASE_URL` and
     `ABADA_AGENT_OPENAI_API_KEY`/`_BASE_URL` (a warning is logged once).

The agent worker's own `ABADA_AGENT_LLM_*` / `ABADA_AGENT_OPENAI_*` variables
are a last-resort fallback for models the engine does not serve.

## Provider types

| Type | Default base URL | Default model prefixes |
| --- | --- | --- |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini`, `google/` |
| `openai` | `https://api.openai.com/v1` | `gpt-`, `o1`, `o3`, `o4`, `openai/` |
| `anthropic` | `https://api.anthropic.com/v1` | `claude`, `anthropic/` |
| `deepseek` | `https://api.deepseek.com/v1` | `deepseek-` |
| `openrouter` | `https://openrouter.ai/api/v1` | `deepseek/`, `meta-llama/`, `mistralai/`, `qwen/`, `x-ai/`, `openrouter/` |
| `openai-compatible` | required | `*` |

Every type is called through its OpenAI-compatible
`POST {baseUrl}/chat/completions` with `Authorization: Bearer <key>`.
Anthropic is reached through its OpenAI SDK compatibility endpoint. OpenRouter
requests carry the `HTTP-Referer`/`X-Title` headers when
`ABADA_LLM_OPENROUTER_ENABLED` is true (default).

## Routing

An agent node's `model` goes to the enabled, configured provider whose model
prefix is the **longest match**; `*` matches any model but loses to every
real prefix. A model that no provider serves has **no** provider: the engine
refuses to start the process (naming the model), and Studio's Deploy & Start
and Dry Run say the same before deploying. A node without a model uses the
Insight provider. Namespaces (`google/`, `openai/`, `anthropic/`) are stripped
before the model id is sent to that provider.

Insight and APL authoring use the provider marked *Used by Insight*
(`insight_default`), else the environment default provider, else the first
configured Studio provider. Their model is that provider's default model.

## API

| Endpoint | Guard | Purpose |
| --- | --- | --- |
| `GET /v1/ai-providers` | insight read roles | Providers with hint, source and configured flag |
| `PUT /v1/ai-providers/{id}` | `insight:configure` or admin | Create/update; a blank `apiKey` keeps the stored key |
| `DELETE /v1/ai-providers/{id}` | `insight:configure` or admin | Remove a Studio provider (the environment one applies again) |
| `POST /v1/ai-providers/{id}/test` | `insight:configure` or admin | Live test, optionally with an unsaved key |
| `GET /v1/ai-providers/status?model=...` | any signed-in user | Which models have no provider |
| `GET /v1/workers/me/ai-credentials` | worker principals registered for `abada:agent` only | Resolved keys for the agent worker |
| `GET/PUT /v1/insight/config/ai`, `GET /v1/insight/config/llm` | as before | rc.7 compatibility views of the Insight provider |

The credentials endpoint is the only API that returns plaintext keys. It
excludes human administrators, requires the `abada:agent` capability,
answers with `Cache-Control: no-store`, and logs only provider ids and a
revision hash. The worker caches the answer for
`ABADA_AGENT_CREDENTIALS_TTL_MS` (default 60 s) and refetches after a 401/403
from a provider. Model calls stay outside engine transactions.

## Encryption key

`ABADA_ENCRYPTION_KEY` (base64, 32 bytes, `openssl rand -base64 32`) encrypts
Studio keys. `up server` generates it; production preflight requires it.
Without it the engine uses a public development key and logs
`ai_provider_keys_weakly_encrypted`. Keys saved under that development key
(every install before the key was set) still decrypt once a real key is
configured, and the engine re-encrypts them at startup. Keep the key stable
and backed up: changing it makes saved keys unreadable, and they must be
entered again.

## Upgrading from 1.0.0-rc.7

Migration `V22` creates `ai_providers` and copies the single rc.7 Studio key
into it as the Insight-default provider. `ai_provider_settings` is left in
place, unused, so rc.7 can still start against the database.
