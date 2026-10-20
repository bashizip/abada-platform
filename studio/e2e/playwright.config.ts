import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Browser runs of the Studio against a real engine (M5 S12). See e2e/README.md.
 *
 * Playwright starts three servers unless they already run: the deterministic stub model, an
 * engine from `engine/target` on a scratch H2 database (OIDC against the dev Keycloak, the stub
 * as its only AI provider), and the Studio's Vite dev server on port 5605 (the only port the
 * dev realm accepts as a redirect). The dev Docker stack is never touched.
 */
const studioDir = path.resolve(import.meta.dirname, '..');
const repoDir = path.resolve(studioDir, '..');
const dataDir = path.resolve(import.meta.dirname, '.data');

const enginePort = Number(process.env.E2E_ENGINE_PORT ?? 5611);
const stubPort = Number(process.env.E2E_STUB_LLM_PORT ?? 5612);
const studioUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5605';
const realm = process.env.E2E_OIDC_REALM_URL ?? 'http://keycloak.localhost/realms/abada-dev';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: path.resolve(import.meta.dirname, 'test-results'),
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: studioUrl,
    channel: process.env.E2E_CHANNEL ?? 'chrome',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_EXTERNAL_STACK ? undefined : [
    {
      command: `node e2e/stub-authoring-llm.mjs ${stubPort}`,
      cwd: studioDir,
      url: `http://127.0.0.1:${stubPort}/v1/models`,
      reuseExistingServer: true,
    },
    {
      // A fresh scratch database on each start of the engine.
      command: `rm -rf "${dataDir}" && mkdir -p "${dataDir}" && java -jar $(ls engine/target/abada-engine-*.jar | head -1)`
        + ` --spring.profiles.active=dev --server.port=${enginePort}`
        + ` "--spring.datasource.url=jdbc:h2:file:${dataDir}/engine;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE"`
        // The dev profile defaults to proxy mode; the e2e run signs in for real.
        + ` --abada.security.mode=oidc --spring.security.oauth2.resourceserver.jwt.issuer-uri=${realm}`
        + ` --abada.security.jwk-set-uri=${realm}/protocol/openid-connect/certs --abada.security.audience=abada-frontend`
        + ` --abada.security.allowed-origins=${studioUrl}`,
      cwd: repoDir,
      url: `http://localhost:${enginePort}/api/actuator/health/liveness`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        // The stub is the only model: no real provider is called.
        ABADA_LLM_API_KEY: 'stub',
        ABADA_LLM_PROVIDER: 'openai-compatible',
        ABADA_LLM_BASE_URL: `http://127.0.0.1:${stubPort}/v1`,
        ABADA_LLM_MODEL: 'stub-authoring',
      },
    },
    {
      command: `npx vite --config e2e/vite.e2e.config.ts`,
      cwd: studioDir,
      url: studioUrl,
      reuseExistingServer: true,
      env: { E2E_ENGINE_URL: `http://localhost:${enginePort}` },
    },
  ],
});
