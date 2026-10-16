# AI providers

Agent tasks, the Insight loop and APL authoring call large language models
through **AI providers**. Since `1.0.0-rc.8` there is one configuration for
all three, managed in Studio and resolved by the engine.

## Where keys come from

For each provider id:

- A provider **saved in Studio** (Settings > AI Providers) always keeps its
  settings: name, base URL, the model prefixes it serves, default model and
  whether it is the default. Its **key** is the key saved in Studio, or else
  the environment key of the same provider (shown as *Key from server*).
  A provider **disabled** in Studio is not used, even if the environment has
  a key for it. Keys are write-only in the API (responses carry a hint such as
  `****abcd`) and stored AES-256-GCM encrypted with `ABADA_ENCRYPTION_KEY`.
- A provider configured **only in the environment** is used with its preset
  settings. The environment variables are:
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

## Saving a provider: tested first

A provider is saved only after it answers. When a save changes what a call
uses (the key, base URL, default model or provider type), the engine first
makes one short chat completion with the values the provider would have once
saved, outside any transaction. If the provider does not answer, nothing is
saved and `PUT /v1/ai-providers/{id}` (and `PUT /v1/insight/config/ai`) return
`422` with code `AI_PROVIDER_TEST_FAILED` and the provider's reason (invalid
key, unknown model, quota...). A key in the reason is masked. Two saves skip
the test: disabling a provider, and saving one that has no key anywhere yet
(it is not used until it has one). Studio's button reads **Test & save**.

## Models: read from each provider

After a successful save, once a day and on demand
(`POST /v1/ai-providers/{id}/models/refresh`), the engine reads each active
provider's own model list (`GET {baseUrl}/models` with its key; Anthropic also
receives `x-api-key` and `anthropic-version`). Ids are kept without a
`models/` prefix; embedding, audio, image, moderation and search models are
left out. `GET /v1/ai-providers/models` returns, per provider, the models, when
they were read and the last error. A failed read keeps the last good list.

A model a provider lists, **and that routes to that provider** under the rules
below, is allowed for agent nodes, fallback models and model retries in
addition to `ABADA_AGENT_ALLOWED_MODELS`; the served APL schema
(`GET /v1/apl/schema`) lists both. A new model is therefore usable the day its
provider publishes it, with no Abada release. An operator who wants a strict
list sets `ABADA_MODEL_DISCOVERY_ENABLED=false` (the allow-list alone then
applies); an empty `ABADA_AGENT_ALLOWED_MODELS` still disables the check.
Replicas take turns through a short lease (`ai_refresh_state`), so one engine
reads a given list at a time.

## Prices: your price, else the public catalog

Agent cost is computed by the engine from token counts and the price in effect
at the time of the call (see [runtime semantics](runtime-semantics.md)).
Prices come, in this order, from:

1. **Your price** (`POST /v1/model-prices`), for the provider that serves the
   model, else for any provider. It always wins.
2. **The public catalog**: by default OpenRouter's model list
   (`ABADA_PRICE_CATALOG_URL`, default `https://openrouter.ai/api/v1/models`),
   read once a day with a plain `GET` that carries nothing from this
   installation. It lists per-token prices for the models of Google, OpenAI,
   Anthropic, DeepSeek and others. A changed price becomes a new row in
   `model_catalog_prices` from the time it was read; rows are never edited, so
   a cost already computed never moves. A model id matches a catalog id by its
   bare name (`gemini-3.8-flash` matches `google/gemini-3.8-flash`; dots and
   dashes, `:variants` and date suffixes are ignored), preferring the model's
   own vendor.
3. **The release snapshot**: the catalog as read when the release was built
   (`llm/model-price-snapshot.json`, 2026-10-16 for `1.1.1`), imported once,
   so prices exist offline or with the catalog off
   (`ABADA_PRICE_CATALOG_ENABLED=false`).

A model no source knows stays **unpriced**, never free. Catalog prices are
the ones the catalog publishes; they usually match the provider's list price
but are not read from the provider's own pricing page, so set your price when
you have a negotiated or different rate. `GET /v1/model-prices/effective?model=...`
returns each model's price with its source (`ADMIN`, `CATALOG` or `NONE`);
`GET /v1/model-prices/catalog` returns the catalog state and
`POST /v1/model-prices/catalog/refresh` reads it now.

## Routing

An agent node's `model` goes to the enabled, configured provider whose model
prefix is the **longest match**; `*` matches any model but loses to every
real prefix. A model that no provider serves has **no** provider: the engine
refuses to start the process (naming the model), and Studio's Deploy & Start
and Dry Run say the same before deploying. A node without a model uses the
Insight provider. Namespaces (`google/`, `openai/`, `anthropic/`) are stripped
before the model id is sent to that provider.

**Default model.** Insight, APL authoring and new agent nodes use the
*Default model* chosen at the top of Settings > AI Providers (stored as the
provider's `insight_default` and `default_model`). The first provider saved
becomes the default. If the chosen provider cannot run (no key anywhere),
the environment default provider, else the first Studio provider, stands in,
and `GET /v1/ai-providers/status` reports `insightFallback: true` with the
`requestedInsightProviderId` so Studio can say so.

## API

| Endpoint | Guard | Purpose |
| --- | --- | --- |
| `GET /v1/ai-providers` | insight read roles | Providers with hint, source and configured flag |
| `PUT /v1/ai-providers/{id}` | `insight:configure` or admin | Create/update after a live test (`422 AI_PROVIDER_TEST_FAILED` otherwise); a blank `apiKey` keeps the stored key |
| `DELETE /v1/ai-providers/{id}` | `insight:configure` or admin | Remove a Studio provider (the environment one applies again) |
| `POST /v1/ai-providers/{id}/test` | `insight:configure` or admin | Live test, optionally with an unsaved key |
| `GET /v1/ai-providers/status?model=...` | any signed-in user | Which models have no provider |
| `GET /v1/ai-providers/models` | any signed-in user | Models each active provider lists, read time, last error |
| `POST /v1/ai-providers/{id}/models/refresh` | `insight:configure` or admin | Read a provider's model list now |
| `GET /v1/model-prices/effective?model=...` | any signed-in user | Price in effect per model and its source |
| `GET /v1/model-prices/catalog` | any signed-in user | Public catalog state |
| `POST /v1/model-prices/catalog/refresh` | `insight:configure` or admin | Read the public catalog now |
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
