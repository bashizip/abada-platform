# Studio browser runs (Playwright)

End-to-end runs of the Studio in a real browser against a real engine. The first one covers
the AI draft workspace (M5 S12): a prompt, two refinements and Apply, with a deterministic
stub model behind the engine's authoring service, then one undo and one redo.

These runs are not wired into CI yet.

## What they need

- The dev Keycloak of `compose.dev.yaml` running (`http://keycloak.localhost`, realm `abada-dev`).
  `keycloak.localhost` must resolve to `127.0.0.1` for the JVM (an `/etc/hosts` line).
- An engine JAR: `cd engine && ./mvnw -DskipTests package`.
- Java 21 and Google Chrome (the run uses the installed Chrome; set `E2E_CHANNEL=chromium`
  after `npx playwright install chromium` to use Playwright's own build).
- A dev-realm user, in `E2E_USERNAME` and `E2E_PASSWORD` (for example `alice`, whose password is in
  `docker/keycloak/import/realm-dev.json`). Without them the tests are skipped.

## Run

```bash
cd studio
E2E_USERNAME=alice E2E_PASSWORD=... npm run test:e2e
```

Playwright starts, unless already running:

| Server | Port | Notes |
| --- | --- | --- |
| `e2e/stub-authoring-llm.mjs` | 5612 | OpenAI-compatible, answers keyed by the request |
| engine from `engine/target` | 5611 | dev profile, fresh H2 database in `e2e/.data`, OIDC against the dev realm, the stub as its only AI provider |
| Studio (`e2e/vite.e2e.config.ts`) | 5605 | the only port the dev realm accepts as a redirect |

The Docker dev stack is not touched. Each test creates its own project through the API (its
creator is its Owner, which drafting requires; global administration does not count).

The dev realm lists `http://localhost` without a port as a web origin, so the spec adds the
CORS headers Keycloak would send for `http://localhost:5605` to the browser's calls to Keycloak.

Set `E2E_SCREENSHOTS=<dir>` to keep screenshots of the workspace, the diff, a failed turn, the
applied draft and the collapsed bar. Failures keep a trace in `e2e/test-results`.
