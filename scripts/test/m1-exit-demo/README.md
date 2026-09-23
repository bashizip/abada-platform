# M1 exit demo

Checks the M1 "truth and safety" exit criteria from
[`docs/development/roadmap.md`](../../../docs/development/roadmap.md) against a
running dev stack. `run.sh` exits non-zero on the first criterion that fails.

| Criterion | How it is checked |
| --- | --- |
| Malicious expression rejected at deploy | Deploys `processes/malicious-*.apl.yaml`; expects HTTP 400 naming node `route` and no `/tmp/pwned` in the engine. |
| Invalid or low-confidence output routes to a human | Starts OK, INVALID and LOW cases; expects `OK`, `INVALID_OUTPUT` (value not written) and `LOW_CONFIDENCE` outcomes, one model call each, and completes the invalid case as a reviewer. |
| Slow agent tasks, no duplicate model call | Two rounds of four 30 s model calls on two worker replicas with 6 s locks; expects every task completed with exactly one model call. |
| Site claims match the code | Runs `abada-site/packages/web/tools/check-claims.mjs`. |

## Run

```bash
./scripts/dev/up.sh --no-build
./scripts/test/m1-exit-demo/run.sh
```

`--skip-setup` reuses an overlay that is already running. The run takes about
two and a half minutes.

## What the overlay changes

`compose.demo.yaml` adds `mock-llm`, a scripted OpenAI-compatible model
(`mock_llm.py`) whose `GET /calls` lists every call. The process inputs `mode`
(`OK`, `INVALID`, `LOW`, `SLOW`) and `caseId` select its reply. Agent workers
point their OpenAI-compatible endpoint at it, run as two replicas, and use a
6 s lock. The demo agent uses `gpt-5-mini`, which is on the default allowed
model list and takes the OpenAI-compatible route.

The script also stores a placeholder key in the dev database's AI provider
settings, because the engine refuses to start agent processes without one.
Replace it in Studio → Settings → AI Providers before using real agents, and
run `./scripts/dev/up.sh --no-build` to restore the normal worker settings.
