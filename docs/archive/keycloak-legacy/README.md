Keycloak (development)
======================

Quick instructions to run Keycloak locally for abada-engine development.

1. Copy `env.example` to `.env` and adjust passwords if needed:

```sh
cp env.example .env
# edit .env to set KEYCLOAK_ADMIN_PASSWORD and KEYCLOAK_DB_PASSWORD if desired
```

2. Start the development stack (this includes the engine and Keycloak services):

```sh
docker compose -f docker-compose.dev.yml up --build
```

3. Keycloak Admin Console (default):

- URL: http://localhost:8080/
- Login: use `KEYCLOAK_ADMIN_USERNAME` / `KEYCLOAK_ADMIN_PASSWORD` from your `.env`

4. Realm import

- The dev compose mounts `docker/keycloak/import/realm-dev.json` and `KEYCLOAK_IMPORT` is configured, so Keycloak should import the realm on first startup.
- If you need to import into a running container manually:

```sh
./docker/keycloak/import/import-realm.sh docker-import
```

5. Testing

- Log in as `alice` / `alice`, `bob` / `bob`, or `orun-admin` / `orun-admin` and fetch a token using the OpenID Connect endpoints.
- Send requests through your gateway (Traefik) which should validate the JWT and inject `X-User` and `X-Groups` headers expected by the engine.

Notes
-----
- This setup is for local development only. Pin images and secure credentials for production.
