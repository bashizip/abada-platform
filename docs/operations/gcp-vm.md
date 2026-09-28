# Single-VM server on Google Cloud

This procedure runs the self-contained `server` profile on one Compute Engine
VM, for example the public demo at `demo.abadaplatform.com`. The profile
publishes Studio, the Engine API, Keycloak and the docs over HTTPS for one
`ABADA_DOMAIN`, with Let's Encrypt certificates, a bundled production-mode
Keycloak and the first-party agent worker.

It is a single-host deployment: one PostgreSQL, one Keycloak, one engine. It
is not the multi-replica topology, and it does not replace the `prod` profile
when you already run an identity provider. See the
[deployment support matrix](../reference/deployment-support.md) for its
evidence status.

## What you get

| URL | Service |
| --- | --- |
| `https://$ABADA_DOMAIN` | Studio; `/api` on the same origin goes to the engine |
| `https://api.$ABADA_DOMAIN` | Engine API for external workers and SDK clients |
| `https://auth.$ABADA_DOMAIN` | Keycloak (realm `abada`) |
| `https://docs.$ABADA_DOMAIN` | Documentation |

Only Traefik publishes ports (80 for the ACME challenge and the HTTPS
redirect, 443). PostgreSQL, the Keycloak database and the Keycloak port stay
on the internal Compose networks.

## 1. Create the VM

Set your project and names once:

```bash
export PROJECT=my-gcp-project REGION=europe-west1 ZONE=europe-west1-b
export VM=abada-demo DOMAIN=demo.abadaplatform.com EMAIL=ops@abadaplatform.com
```

Reserve a static address so DNS survives VM restarts:

```bash
gcloud compute addresses create "$VM-ip" --project "$PROJECT" --region "$REGION"
```

Open only HTTP and HTTPS to the tagged VM:

```bash
gcloud compute firewall-rules create abada-web --project "$PROJECT" --allow tcp:80,tcp:443 --target-tags abada-web
```

Create the VM with the bootstrap script. `e2-standard-2` (2 vCPU, 8 GB) fits
the stack's memory limits (about 6 GB with the agent worker); use
`e2-standard-4` if you add `--telemetry`.

```bash
gcloud compute instances create "$VM" --project "$PROJECT" --zone "$ZONE" --machine-type e2-standard-2 --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-balanced --address "$VM-ip" --tags abada-web --metadata-from-file startup-script=deployment/gcp/startup.sh --metadata abada-domain="$DOMAIN",abada-acme-email="$EMAIL",abada-version=1.0.0-rc.7
```

On every boot, [`deployment/gcp/startup.sh`](../../deployment/gcp/startup.sh)
installs Docker Engine with the Compose plugin, downloads the release bundle
from `install.abadaplatform.com`, verifies its SHA-256 checksum, extracts it to
`/opt/abada` and writes `ABADA_DOMAIN` and `ABADA_ACME_EMAIL` into
`/opt/abada/.env.server`. It does not start the stack unless the metadata
attribute `abada-autostart=true` is set; start it yourself the first time so
you can watch it.

## 2. Point DNS at the VM

```bash
gcloud compute addresses describe "$VM-ip" --project "$PROJECT" --region "$REGION" --format 'value(address)'
```

Create two `A` records with that address: `demo` and `*.demo` under
`abadaplatform.com`. If the zone is on Cloudflare, set both to **DNS only**
(grey cloud): Let's Encrypt HTTP-01 validation and Traefik's certificates need
the traffic to reach the VM directly.

Without a domain, set `abada-domain` to `<ip-with-dashes>.sslip.io`, for
example `34-56-78-90.sslip.io`. sslip.io resolves every subdomain to the
embedded address, and Let's Encrypt issues certificates for it.

## 3. Start Abada

```bash
gcloud compute ssh "$VM" --project "$PROJECT" --zone "$ZONE"
```

On the VM:

```bash
sudo journalctl -u google-startup-scripts.service --no-pager | grep abada-startup
```

```bash
sudo /opt/abada/release/abada-platform up server
```

On first start the launcher generates every secret into
`/opt/abada/.env.server` (mode `600`): database passwords, the Keycloak admin
password, the admin-API and agent client secrets and the Studio passwords. It
then validates the domain, email, secrets and pinned image versions, starts
the stack and, on every run:

- sets the `abada-frontend` redirect URI and web origin to
  `https://$ABADA_DOMAIN`;
- applies the generated admin-API client secret;
- creates or updates `alice` (operator, every Abada role) and `bob` (human
  reviewer: runs processes and completes tasks, cannot deploy or administer);
- provisions and starts the agent worker.

Each step is idempotent, so rerunning `up server` converges a changed
`.env.server` onto Keycloak. The realm file itself contains no users, secrets
or URLs.

Read the passwords when you need them:

```bash
sudo grep -E '^(ABADA_OPERATOR_PASSWORD|ABADA_REVIEWER_PASSWORD|KEYCLOAK_ADMIN_PASSWORD)=' /opt/abada/.env.server
```

Certificates are requested on the first HTTPS request to each hostname, so the
first page load can take up to a minute.

## 4. First run of the demo

1. Open `https://$ABADA_DOMAIN` and sign in as `alice`. This first sign-in
   creates and deploys the **AI Lead Triage** starter and adds `bob` as its
   reviewer. The starter is wired to these two usernames.
2. Add the model provider key in Studio → Settings (stored encrypted in the
   database), or set `ABADA_AGENT_LLM_API_KEY` in `.env.server` and rerun
   `up server`.
3. Start the HIGH, MEDIUM and LOW examples, then show Tasks, Operations and
   Insight. Sign in as `bob` to complete the human review.

## Running a public demo

- **Model spend.** Every started instance calls the model. Use a provider key
  with a spending cap. `ABADA_AGENT_MAX_TASKS=2` limits concurrency.
- **Shared accounts.** Anyone with the `bob` password can start and complete
  work. Rotate it by editing `ABADA_REVIEWER_PASSWORD` and rerunning
  `up server`; set `ABADA_REVIEWER_ENABLED=false` to disable the account.
- **Reset.** To return to a clean demo, back up if needed, then remove the
  volumes and start again. This deletes all processes, history and Keycloak
  users:

  ```bash
  sudo /opt/abada/release/abada-platform down server
  ```

  ```bash
  sudo docker volume rm abada_postgres_data abada_keycloak_data
  ```

  ```bash
  sudo /opt/abada/release/abada-platform up server
  ```

  Keep `abada_letsencrypt_data`: deleting it requests new certificates and can
  hit Let's Encrypt rate limits.

## Backup and upgrade

Back up both databases and the environment file (it holds the only copy of the
generated secrets):

```bash
cd /opt/abada && sudo docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml exec -T postgres pg_dump -U abada -Fc abada_engine > abada_engine.dump
```

```bash
cd /opt/abada && sudo docker compose --env-file .env.server -f compose.yaml -f compose.server.yaml exec -T keycloak-db pg_dump -U keycloak -Fc keycloak > keycloak.dump
```

A scheduled persistent-disk snapshot of the boot disk is a simple complement.

To upgrade, read the target version's release notes, back up, then change the
`abada-version` metadata and rerun the startup script. It installs the new
bundle and re-pins the four image tags in `.env.server`:

```bash
gcloud compute instances add-metadata "$VM" --project "$PROJECT" --zone "$ZONE" --metadata abada-version=NEW_VERSION
```

```bash
sudo google_metadata_script_runner startup && sudo /opt/abada/release/abada-platform up server
```

## Rehearsing without rate limits

Set `ABADA_ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory`
in `.env.server` to use Let's Encrypt staging. Browsers do not trust staging
certificates; switch back and remove the `abada_letsencrypt_data` volume
before going live.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Browser shows `TRAEFIK DEFAULT CERT` | DNS does not point at the VM yet, port 80 is closed, or the records are proxied. See `docker compose ... logs traefik`. |
| Studio sign-in returns "Invalid redirect uri" | `ABADA_DOMAIN` changed after the first start; rerun `up server` to reapply it. |
| Engine returns 401 for valid users | The issuer is `https://auth.$ABADA_DOMAIN/realms/abada`; check that `KC_HOSTNAME_URL` and the engine's `OIDC_ISSUER_URI` agree in `docker compose ... config`. |
| `up server` stops at a port check | Another process holds 80 or 443 on the VM. |
