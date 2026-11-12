# User-guide screenshots

Rebuilds the 1.2 screenshots in `documentation/src/assets/screens/1.2/` from a
seeded local stack. Nothing here runs in CI; it is a maintainer tool.

## Stack

| Piece | Port | Notes |
| --- | --- | --- |
| Keycloak (dev realm `abada-dev`) | 80 as `keycloak.localhost` | add `127.0.0.1 keycloak.localhost` to `/etc/hosts` |
| RustFS | 9000 | bucket and keys as in `compose.dev.yaml` |
| Engine JAR | 5611 | OIDC mode, see below |
| Studio e2e dev server | 5605 | `npm run dev -- --port 5605` with the e2e runtime config |
| Stub LLM | 5612 | `node studio/e2e/stub-authoring-llm.mjs 5612` |

Start the engine with OIDC on the dev realm and the identity-admin client, or
the Admin view stays on *Identity Provider Not Configured*:

```bash
export ABADA_KEYCLOAK_URL=http://keycloak.localhost ABADA_KEYCLOAK_REALM=abada-dev \
  ABADA_KEYCLOAK_ADMIN_CLIENT_ID=abada-admin-api \
  ABADA_KEYCLOAK_ADMIN_CLIENT_SECRET=abada-dev-admin-api-secret
java -jar engine/target/abada-engine-<version>.jar --spring.profiles.active=dev --server.port=5611 \
  --abada.security.mode=oidc \
  --spring.security.oauth2.resourceserver.jwt.issuer-uri=http://keycloak.localhost/realms/abada-dev \
  --abada.security.jwk-set-uri=http://keycloak.localhost/realms/abada-dev/protocol/openid-connect/certs \
  --abada.security.audience=abada-frontend --abada.security.allowed-origins=http://localhost:5605
```

Behind an HTTP proxy, add `keycloak.localhost` to `NO_PROXY` and to the JVM's
`http.nonProxyHosts`.

## Seed and capture

```bash
python3 scripts/docs-capture/seed.py          # prints {"projectId": ...} last
node scripts/docs-capture/capture.mjs <projectId> <unused-state.json> /tmp/cap [scene...]
```

`seed.py` creates the *Social contributions* project, the sectioned
`declaration-depot` form and `declaration.apl.yaml`, then four declarations:
one confirmed end to end, one waiting at Verification, one routed to manual
entry on low confidence and one whose agent step fails (the incident). The
agent steps are completed by the script with the worker's service account, so
no model is called. It also produces admin audit events, including two refused
attempts by `bob`.

The capture scenes read instance ids from the seed (the completed, incident and
waiting instances); update `capture.mjs` if you reseed. Shots are 1440×900 at
2× and are converted to 1920×1200 WebP (quality 82) for the docs.
