# Abada Platform → SaaS Transformation Roadmap

> **Superseded (2026-09-23).** This document is kept for history. The only active roadmap is [`development/roadmap.md`](../development/roadmap.md). 

> **Deferred:** This document is not the active delivery roadmap. The reliable
> OSS core roadmap in `docs/archive/roadmap-to-1.0.md` is authoritative until 1.0.

## Overview

This earlier proposal describes possible SaaS layers. It must not be read as a
statement that the current runtime is already stateless or cluster-certified.

Below are the 7 pillars required, ordered by priority and dependency.

---

## Pillar 1 — Multi-Tenancy 🏢
**Priority: Critical (everything else depends on this)**

### Current State
The engine is single-tenant by design. There is no concept of an "organization" or "workspace": all process definitions, instances, tasks, and users share a single database schema and a single Keycloak realm.

### What's Needed

**1a. Data Isolation Strategy — choose one:**

| Model | Isolation Level | Complexity | Cost |
|-------|----------------|------------|------|
| **Schema-per-tenant** (PostgreSQL) | High | Medium | Medium |
| **Row-level security (RLS)** | Medium | Low | Low |
| **Database-per-tenant** | Very High | High | High |

> **Recommended**: Start with RLS (row-level isolation) using a `tenant_id` column on every entity. It's the fastest to implement and easy to migrate to schema-per-tenant later. Use PostgreSQL RLS policies so the engine can never accidentally leak cross-tenant data.

**1b. Engine-Level Changes**
- Add `tenantId` to all JPA entities: `ProcessDefinitionEntity`, `ProcessInstanceEntity`, `TaskEntity`, `ExternalTaskEntity`
- Pass `tenantId` through `AbadaEngine` operations and filter all queries by it
- Startup metric aggregation and every command/query must be tenant-scoped

**1c. Identity & Auth — Keycloak Multi-Realm**
- Provision one Keycloak realm per tenant on signup → strong isolation for SSO/OIDC
- Or use a shared realm with tenant-specific groups + Keycloak Organizations feature (KC 24+)
- A **tenant provisioning service** must automate: realm creation, client registration, first admin user

**1d. Tenant Management API**
New internal/admin API:
```
POST   /api/admin/tenants          → provision new tenant
GET    /api/admin/tenants/{id}     → get tenant info
PATCH  /api/admin/tenants/{id}     → update limits/plan
DELETE /api/admin/tenants/{id}     → offboard
```

---

## Pillar 2 — Billing & Subscription Management 💳
**Priority: Critical**

### What's Needed

**2a. Stripe Integration (recommended)**
- Use **Stripe Billing** for subscriptions + **Stripe Checkout** for self-serve upgrades
- Webhook listener to sync subscription state into the tenant database
- Entitlement model: map plan → feature flags and resource limits

**2b. Plan & Quota Enforcement**
Define plan tiers (example):

| Plan | Process Instances/mo | Users | BPMN Uploads |
|------|---------------------|-------|-------------|
| Free | 500 | 3 | 5 |
| Starter | 10,000 | 10 | Unlimited |
| Pro | 100,000 | 50 | Unlimited |
| Enterprise | Unlimited | Unlimited | Unlimited + SLAs |

- Add quota checks in `AbadaEngine.startProcess()` and `deploy()` that fail gracefully with a `402 Payment Required`
- Quota counters tracked in Redis (or PostgreSQL with a monthly reset job)

**2c. Usage Metering**
- Leverage existing `EngineMetrics` — already emits `abada.process.instances.started` per process definition
- Add `tenant_id` label to all metrics
- Feed into Stripe Metered Billing for usage-based plans

---

## Pillar 3 — Self-Serve Onboarding & Admin Portal 🚀
**Priority: High**

### What's Needed

**3a. Public Signup Flow**
- Marketing landing page → Signup → Email verification → Tenant provisioning → Dashboard
- Integrate with Stripe Checkout for plan selection at signup

**3b. Admin Portal (new frontend)**
A dedicated admin experience (can extend Orun or be a new app):
- **Organization settings**: name, logo, SSO config
- **User management**: invite members, assign roles
- **Billing**: current plan, usage meter, invoices, upgrade/downgrade
- **API Keys**: generate/revoke API keys for external workers
- **Process definitions**: deploy/manage BPMN files (can reuse Orun's upload)
- **Audit log**: who did what and when

**3c. Email Notifications**
- Transactional emails: welcome, task assignment, process completion alerts
- SMS/push for mobile (future)
- Use **Resend** or **SendGrid** with templated emails

---

## Pillar 4 — Production Infrastructure (Cloud-Native) ☁️
**Priority: High**

### Current State
Docker Compose with 3 replicas and Traefik. Good for demo, not for SaaS scale.

### What's Needed

**4a. Kubernetes Migration**
- Write Helm charts for all services (engine, tenda, orun, keycloak, postgres, otel-stack)
- HPA (Horizontal Pod Autoscaler) for the engine — already partially documented in `architecture/overview.md`
- Use managed Postgres (AWS RDS / Neon / Supabase) instead of containerized

**4b. Managed Services**
| Component | Replace With |
|-----------|-------------|
| PostgreSQL container | AWS RDS / Neon / Supabase |
| Keycloak container | Self-hosted on K8s or Keycloak Cloud |
| OTEL Collector | AWS ADOT / GCP OTEL / self-hosted |
| Grafana | Grafana Cloud or self-hosted |

**4c. CI/CD Pipeline**
- GitHub Actions already exists (`.github/`) — expand it
- Pipeline: lint → test → build Docker image → push to registry → deploy to K8s (per environment)
- Semantic versioning + automated release notes
- Preview environments per PR

**4d. Disaster Recovery**
- Automated PostgreSQL backups (point-in-time recovery)
- Multi-AZ deployment
- RTO/RPO targets defined for each plan tier

**4e. State Management Foundation** ✅
> The 0.10 OSS core loads mutable process and task state from PostgreSQL per
> command and uses database locks, leases and idempotency records across
> replicas. Redis is not required for workflow correctness. SaaS work must
> preserve that authority while adding tenant isolation and capacity controls.

---

## Pillar 5 — Security Hardening 🔐
**Priority: High**

### What's Needed

**5a. RBAC Completion**
- Currently noted as "in progress" in README
- Implement role enforcement at the API layer for: `process:read`, `process:write`, `task:claim`, `task:complete`, `admin:*`
- Role assignments per-tenant, synced with Keycloak groups

**5b. API Key Authentication**
- External task workers need API keys (not user tokens)
- Implement: `POST /api/auth/keys` → creates an opaque API key stored as a hashed value
- Middleware to resolve API key → tenant + permissions

**5c. Audit Logging**
- Log every mutation (start process, complete task, deploy definition) with: who, what, when, from where
- Immutable audit log stored in a dedicated table or append-only log service

**5d. Data Encryption**
- Encrypt process variables at rest (variable JSON columns contain business data)
- TLS everywhere (already mostly done via Traefik)
- Secrets management via HashiCorp Vault or AWS Secrets Manager (replace `.env` files)

**5e. Compliance**
- GDPR: `DELETE /api/admin/tenants/{id}/data` must hard-delete all tenant data
- SOC 2 Type II readiness: access controls, audit logs, change management
- OWASP Top 10 review of REST API

---

## Pillar 6 — Developer Ecosystem & API 🛠️
**Priority: Medium**

### What's Needed

**6a. API Versioning & Stability**
- Stabilize all REST contracts (targeted by the 0.11 gate)
- Strict API versioning (`/api/v1/`, `/api/v2/`)
- OpenAPI spec published and versioned (Swagger already exists)
- Deprecation policy documented

**6b. SDKs**
- **Java SDK** (already on roadmap for `1.0.0-beta`)
- **JavaScript/TypeScript SDK** (high demand — enables Node.js workers)
- **Python SDK** (data pipeline integration)
- Publish to Maven Central, npm, PyPI

**6c. Webhooks**
- SaaS customers expect push events, not polling
- Events: `process.started`, `process.completed`, `task.created`, `task.completed`, `task.assigned`
- Reliable delivery with retry + dead-letter queue

**6d. Developer Portal**
- Interactive API documentation (beyond Swagger)
- Quick-start guides and code samples
- Sandbox environment with pre-loaded demo processes

---

## Pillar 7 — Go-to-Market 📣
**Priority: Medium (can run in parallel)**

### What's Needed

**7a. Landing Page**
- Public marketing site targeting: "Lightweight Camunda/Flowable alternative", "BPMN automation for developers"
- Pricing page, feature comparison, documentation link, sign-up CTA

**7b. Positioning**
The platform's differentiators vs Camunda/Flowable/Temporal:
- ✅ Truly lightweight (no Camunda Platform baggage)
- ✅ Native OpenTelemetry observability out of the box
- ✅ Simple self-host OR SaaS
- ✅ Honest pricing (not "contact sales" for basic features)

**7c. Documentation Site**
- Move docs from Markdown files to a documentation platform (Docusaurus, Mintlify, or GitBook)
- Cover: Getting Started, BPMN Reference, API Reference, External Workers guide, SaaS Admin guide

**7d. Community**
- GitHub Discussions or Discord for early adopter community
- Public changelog / release notes page

---

## Implementation Sequence

```mermaid
gantt
    title Abada SaaS Transformation
    dateFormat YYYY-MM
    section Foundation (Must-have for launch)
    Multi-Tenancy (data model + API)       :crit, 2026-03, 2m
    Keycloak multi-realm provisioning      :crit, 2026-03, 6w
    In-memory state fix (DB-only hot path) :crit, 2026-03, 3w
    RBAC completion                        :crit, 2026-04, 3w
    section Monetization
    Stripe integration + plans             :2026-04, 5w
    Quota enforcement                      :2026-05, 2w
    Usage metering                         :2026-05, 2w
    section Product
    Admin Portal (onboarding + billing)    :2026-05, 2m
    Self-serve signup flow                 :2026-05, 3w
    Email notifications                    :2026-06, 2w
    section Infrastructure
    Kubernetes Helm charts                 :2026-04, 6w
    CI/CD pipeline hardening               :2026-04, 2w
    Managed Postgres migration             :2026-05, 2w
    section Ecosystem
    JS/TS SDK                              :2026-06, 3w
    Webhooks                               :2026-06, 3w
    Developer Portal                       :2026-07, 4w
    section GTM
    Landing page                           :2026-05, 3w
    Docs site                              :2026-06, 4w
```

---

## Quick Wins (Start This Week)

These don't require major architecture changes and unblock everything else:

1. **Add `tenant_id` column** to all JPA entities — schema-level change, establishes the tenancy contract
2. **API Key model** — simple table + hash-based lookup, unblocks external worker auth
3. **Preserve database-authoritative execution** while adding tenant-scoped
   queries, locks, leases and capacity limits
4. **GitHub Actions CI** — ensure engine tests pass on every PR before any new feature work
5. **Stripe account setup** — register, define products/prices, get webhook endpoints ready
