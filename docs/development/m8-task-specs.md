# M8 task specifications — Abada Cloud (hosted SaaS, 2.0.0)

The tasks of milestone M8. The roadmap lists them; this file holds what each
one means. M8 starts after M7 has shipped and builds on it: the Helm chart,
the cloud object stores, managed PostgreSQL and the Kubernetes gate are the
foundation of the hosted service. Dates are set when M7 ships.

---

## Why M8, and why 2.0.0

Self-hosting is Abada's core promise, and it stays the default. But many
organisations that want governed AI processes cannot run a platform
themselves: small teams, subsidiaries, pilots that must start this week, and
organisations whose own cloud team prefers a managed service in a region they
choose. A hosted Abada Cloud reaches them and gives Abada recurring revenue.

It is a major release because tenancy is not an add-on: every tenant-owned
table, query, lease, file, worker credential and API call becomes
tenant-scoped, and the worker protocol changes. A service people pay for also
needs pricing, billing, metering, regions, operations and contracts that
Abada does not have today.

## Guardrails (apply to every task)

1. **One engine, one codebase.** The hosted service runs the same AGPL engine,
   Studio and agent worker as every other distribution. No governance or
   runtime capability exists only in the cloud. The control plane (sign-up,
   billing, provisioning) is the only cloud-only component.
2. **Self-hosted unchanged for its operators.** A self-hosted installation is
   one implicit tenant. Its operators configure nothing new, see no tenant
   selector, and upgrade through ordinary Flyway migrations.
3. **Isolation in the database.** Tenant isolation is enforced by PostgreSQL
   row-level security (or a dedicated database), not only by application
   filters. An application bug must not be enough to read another tenant's
   data.
4. **The doctrine holds.** The model still runs outside the transaction, the
   engine still enforces the contract, humans still own change, and every AI
   decision still leaves evidence — now per tenant.
5. **The exit is always open.** A tenant can export everything and run it
   self-hosted. Sovereignty is the brand; lock-in would contradict it.
6. **Customer data is the customer's.** No tenant data is used for anything
   but serving that tenant. Prompts and outputs are never used to train
   anything.

---

## P1 — Tenancy model decision record

**Goal.** Decide, before any code, how tenants are isolated, and record it in
`docs/architecture/tenancy.md`.

**Options.**

| Model | Isolation | Cost per tenant | Fits |
| --- | --- | --- | --- |
| Shared database, `tenant_id` + row-level security (pooled) | Strong if RLS is enforced everywhere | Lowest | Free and team plans |
| Schema per tenant | Good | Medium; migrations × N schemas | Rarely worth it over the other two |
| One Helm release and database per tenant (dedicated) | Strongest, also performance isolation | Highest | Enterprise, regulated, residency-sensitive |

**Starting recommendation.** A hybrid: a pooled tier for self-service plans
and a dedicated tier for enterprise. The dedicated tier is the M7 chart run
per tenant, so it needs little new engine work; the pooled tier is what P2
and P3 build. Launch can be pooled-only if the cut line is reached.

**Also decide:** tenant identifier format; how a tenant maps to a hostname
(`<org>.abada.cloud` or a path); whether one user can belong to several
tenants; the default tenant id used by self-hosted installations.

---

## P2 — Tenant in the engine

**Goal.** Every piece of tenant-owned state carries its tenant, and
PostgreSQL refuses cross-tenant access.

**Work.**
- Flyway migration adding `tenant_id` (not null) to every tenant-owned table:
  definitions and versions, instances, tokens, tasks, variables, jobs,
  timers, subscriptions, outbox, history, journal and evidence, files
  metadata, admin audit, insight and proposals, model and MCP configuration.
  Existing rows are backfilled to the default tenant. Composite indexes lead
  with `tenant_id` on every acquisition and list path.
- Row-level security policies on those tables, keyed by a per-transaction
  setting (`SET LOCAL abada.tenant_id`) set by the engine at the start of every
  transaction. The engine's database role does not bypass RLS; a separate
  role for migrations and the control plane does.
- Tenant context resolved from the JWT (a configurable claim) for users and
  from the worker credential for workers. A request without a resolvable
  tenant is rejected, except in single-tenant mode where the default tenant
  applies.
- Leases, timers, schedulers and the outbox dispatcher acquire work across
  tenants fairly (P3) but always execute each command inside its own tenant's
  context.
- `/api/v1` stays tenant-implicit (the tenant comes from the token); no
  tenant id appears in public URLs. Any contract change is documented before
  implementation, per `AGENTS.md`.

**Acceptance tests (PostgreSQL Testcontainers).**
- Fresh database and upgrade from every supported 1.x schema; all 1.x data
  lands in the default tenant and keeps working.
- For every repository method: data of tenant A is invisible to tenant B, and
  a query that forgets its filter still returns nothing across tenants
  because RLS blocks it.
- The 0.10 concurrency, lease-recovery, failover and duplicate-request suites
  pass with 3 tenants sharing the engine.
- Single-tenant mode: the full existing suite passes unchanged.

---

## P3 — Isolation beyond the database

**Goal.** Nothing outside PostgreSQL leaks between tenants either.

**Work.**
- Files: objects under `tenants/<id>/`, encrypted with a per-tenant key
  (KMS-backed in the cloud); the worker file lease checks the tenant.
- Workers: worker credentials are issued per tenant; the external worker
  protocol carries the tenant implicitly through the credential; a worker can
  never lock another tenant's work. Abada-run agent workers are shared but
  execute each job in its tenant's context with its tenant's provider keys.
- Configuration: model providers, MCP servers, secrets and webhooks per
  tenant; secrets in a per-tenant secret store path.
- Caches keyed by tenant (parsed definitions are keyed by tenant and
  definition version); metrics and traces carry a tenant label in the
  operator's telemetry and never in the tenant-visible one of another tenant;
  logs never print another tenant's data.
- Noisy neighbours: fair work acquisition (round-robin or weighted by plan
  across tenants), per-tenant rate limits on the API, per-tenant concurrency
  limits on agent calls.

**Acceptance.** An isolation suite that, for two tenants, tries every API
endpoint, every worker protocol call, Studio, file download, webhook delivery
and SSE stream with the other tenant's identifiers and gets nothing back. One
tenant saturating agent work does not stop the other's timers or tasks.

---

## P4 — Control plane (`abada-cloud`)

**Goal.** Organisations can sign up, get a working tenant, change plan and
leave, without us doing anything by hand.

**Work.** A separate service (and repository, licence decided in P12):
sign-up with email verification; organisation and tenant creation;
provisioning of a pooled tenant (rows, keys, secret paths, default roles) in
seconds and of a dedicated tenant (namespace, M7 Helm release, database,
bucket) in minutes; plan changes; suspension for non-payment with a grace
period; deletion with a verified purge (database rows, objects, keys, backups
after their retention); an operator console for support. Every control-plane
action is audited.

**Acceptance.** Sign-up to a running first process in under five minutes on
the pooled tier; deletion leaves no row, object or key (verified by a test
that searches for the tenant id everywhere).

---

## P5 — Identity

**Goal.** Small teams sign in without an IdP; organisations use their own.

**Work.** Hosted accounts (email and password with MFA, or social sign-in)
through a multi-tenant identity broker (Keycloak organisations, or a managed
equivalent, decided at the start); per-tenant SSO federation with the
tenant's OIDC provider, then SAML; invitations; Abada roles per tenant; SCIM
provisioning later.

**Acceptance.** The negative tests required by `AGENTS.md` per tenant: a
token from tenant A's IdP is refused by tenant B; an expired or
wrong-audience token is refused; a user invited to two tenants sees only the
one they signed into.

---

## P6 — Metering and quotas

**Goal.** Usage is measured exactly, enforced by the engine and visible to
the tenant.

**Work.**
- Usage events written in the same transaction as the work they measure,
  through the transactional outbox: instance started, agent call completed
  (tokens in and out, model, computed spend — the engine already prices
  tokens), human task completed, storage used, active seats.
- Aggregation per tenant per day, idempotent by event id; reconciliation job
  comparing aggregates with source tables.
- Quotas per plan (instances per month, agent spend, storage, seats) enforced
  by the engine: a start over quota is a typed error, and an agent call over
  the spend cap routes like `on_error` with a clear reason, never silently.
- A usage page in Studio for tenant administrators.

**Acceptance.** Replaying the same events twice does not double-count;
reconciliation matches to the unit on a seeded month; a quota stop is
visible in the audit trail.

---

## P7 — Pricing and billing

**Goal.** Decide the prices, then charge them correctly.

**Decisions (business, with exit criteria).**
- Plans: free (limited instances and agent spend, community support), team,
  business, enterprise/dedicated. What each includes: instances, seats,
  agent spend included or passed through, storage, regions, SSO, SLA, support.
- Price metric: per seat, per instance, per agent spend, or a mix. Recorded
  with the reasoning and a comparison with Camunda, Flowable and similar
  hosted offerings at the time.
- Currency and local pricing for African markets.

**Work.** A billing provider integrated with P6 metering: card payments, and
African payment rails (mobile money) through a provider that supports the
DRC and the francophone markets; invoices with VAT where applicable; trials;
upgrades and downgrades with proration; dunning and the P4 suspension flow.

**Acceptance.** A month of seeded usage produces the expected invoice for
every plan; a failed payment walks through dunning to suspension and back to
active on payment.

---

## P8 — Models in the hosted service

**Goal.** Tenants can use their own model accounts or ours, and spend stays
under control.

**Work.** Per-tenant provider keys (bring your own), stored in the tenant's
secret path; or Abada-managed models, with spend metered by P6 and billed at
a published rate. Per-tenant and per-process spend caps. The evidence record
and the "model runs outside the transaction" rule are unchanged.

**Acceptance.** Tenant A's key is never used for tenant B; hitting a cap
routes the step as specified; the invoice line matches the evidence records'
spend.

---

## P9 — Regions and data residency

**Goal.** A tenant chooses where its data lives, and it stays there.

**Work.** At least one EU region and one African region at launch (cloud
provider and regions decided at the start, cost and latency from Kinshasa
measured); each region a full cell (cluster, database, object store, keys,
backups); a tenant pinned to its region at creation; moving region is an
export/import (P10). Residency stated in the DPA.

**Acceptance.** Data, backups and logs of a tenant in the African region are
never written outside it (verified by configuration review and a test that
inspects storage locations).

---

## P10 — Portability

**Goal.** Leaving Abada Cloud is a documented, tested operation.

**Work.** Tenant export: definitions and all versions, instances with
history, journal and evidence, audit, files with their sha256, configuration
without secrets, as a signed archive. Import into a self-hosted 2.0.0
installation (and into another cloud tenant or region). Self-service in
Studio for tenant administrators.

**Acceptance.** On every release candidate: export a seeded tenant, import it
into a fresh self-hosted install, and re-run the end-to-end test against the
imported data; finished instances show the same path and evidence.

---

## P11 — Operations

**Goal.** Run the service to a standard customers can rely on.

**Work.** SLOs (availability, API latency, time to start an agent step) and
the SLA per plan; a public status page; on-call rotation and incident process
(even if the rotation starts as one person, it is written down); per-tenant
backup with point-in-time restore; a disaster-recovery exercise (lose a
region's database, restore, measure RPO and RTO) before launch; capacity and
cost dashboards per tenant.

**Acceptance.** The DR exercise meets the stated RPO and RTO; a single
tenant's restore does not touch other tenants.

---

## P12 — Security, compliance and legal

**Goal.** Earn the trust a hosted service for regulated processes needs.

**Work.**
- External penetration test focused on tenant isolation before launch; the
  findings fixed or accepted in writing.
- Per-tenant encryption keys (P3), key rotation, audit of operator access to
  tenant data (break-glass only, logged and visible to the tenant).
- SOC 2 Type I and ISO 27001 readiness plan with a target date; the
  certifications themselves may follow launch.
- Terms of service, DPA, privacy policy, sub-processor list, acceptable-use
  policy.
- Licence position settled with counsel: licence of the control plane, and
  how outside contributions to the AGPL engine are accepted (CLA or DCO).

**Acceptance.** Pen test report with no open critical or high finding;
documents published on the site before the first paid tenant.

---

## P13 — Launch

**Goal.** Ship 2.0.0 and open the service.

**Work.** Pricing page and sign-up on abadaplatform.com; hosted-service
documentation (getting started, tenancy, regions, billing, export); the
self-hosted ⇄ cloud migration guide; 2.0.0 release notes covering the
tenancy migration for self-hosted operators; the gate report with the
isolation suite, the pen test summary and the DR exercise.

---

## Exit demo

Two organisations sign up self-service, choose a plan and a region, deploy a
process and run an agent. The isolation suite proves that neither can see the
other's definitions, instances, tasks, files, workers, audit or usage through
the API, a worker, Studio or a webhook. Usage is metered and an invoice is
issued. One organisation exports everything, and the export runs unchanged on
a self-hosted 2.0.0 installation.
