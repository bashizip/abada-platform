# Keycloak themes

`abada/` is the login theme for the development realm (`abada-dev`). It restyles
Keycloak's stock login pages to match Studio's canvas: the warm charcoal
background with the canvas dot grid, mocha cards, linen text and the amethyst
primary button. The palette mirrors `studio/src/index.css`.

- `login/theme.properties` extends the bundled `keycloak` theme, so every page
  template and PatternFly class mapping is inherited. Only the page shell and
  styles change.
- `login/template.ftl` is Keycloak 21.1.1's `base/login/template.ftl` with the
  Studio brand header and SVG favicon. Re-diff it when the Keycloak image in
  `compose.dev.yaml` is upgraded.
- `login/resources/css/abada.css` holds all styling; it loads after
  Keycloak's `login.css`.
- `login/messages/messages_en.properties` holds the page title and tagline.

`compose.dev.yaml` mounts the theme at `/opt/keycloak/themes/abada`, and
`realm-dev.json` selects it with `"loginTheme": "abada"`. `start-dev` disables
theme caching, so CSS and template edits show on the next page reload.

Keycloak only imports `realm-dev.json` into an empty database. To switch an
already-provisioned dev realm to the theme, pick **abada** under
*Realm settings → Themes → Login theme* in the admin console, or run:

```bash
docker compose exec keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin --password admin
docker compose exec keycloak /opt/keycloak/bin/kcadm.sh update realms/abada-dev \
  -s loginTheme=abada -s 'displayName=Abada Studio'
```

Production uses an external identity provider; if it is Keycloak, copy
`abada/` into its `themes/` directory and select it the same way.
