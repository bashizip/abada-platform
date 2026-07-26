# Abada Engine Documentation

Welcome to the Abada Engine documentation. This documentation is organized to help you quickly find the information you need, whether you are an architect, developer, or operator.

The reader-oriented user, architecture and developer guide lives in the Starlight
application at [`../documentation`](../documentation/) and is published at
<https://abada-engine-docs.vercel.app>. The Markdown files in this directory
remain the detailed product contracts, specifications, ADRs, release notes and
operational records that the site summarizes and links to.

## 📚 Table of Contents

### 🏗️ Architecture

High-level design and architectural decisions.

- [Overview](architecture/overview.md) - The big picture of Abada Engine's architecture and deployment.
- [Runtime State](architecture/runtime-state.md) - PostgreSQL-authoritative target architecture, command lifecycle, and migration status.
- [Authentication Service](architecture/auth-service.md) - How authentication and authorization work.
- [Event Delivery](architecture/event-delivery.md) - Mechanics of event processing and delivery.
- [SPI Design](architecture/spi-design.md) - Service Provider Interface design for extensibility.
- [Event-Based Gateways](architecture/event-based-gateways-design.md) - Design of event-based gateways.

### 🚀 Features

Detailed guides on specific engine features.

- [Process Variables](features/process-variables.md) - Handling data within processes.
- [Service Tasks](features/service-tasks.md) - Implementing and using service tasks.
- [Exclusive Gateway](features/exclusive-gateway.md) - Logic and usage of exclusive gateways.
- [Persistence](features/persistence.md) - How data is stored and managed.
- [Kitchen Sink Process](features/kitchen-sink-process.md) - A comprehensive example process demonstrating various features.

### 🛠️ Operations

Guides for deploying, monitoring, and managing the engine.

- [Docker Deployment](operations/docker-deployment.md) - Deploying Abada Engine using Docker.
- [Observability](operations/observability.md) - Monitoring, metrics, tracing, and logging.
- [User Guide](../documentation/src/content/docs/user/index.mdx) - Quickstart, production, identity, telemetry, backup, upgrades and troubleshooting.

### 💻 Development

Resources for developers building on or contributing to Abada Engine.

- [API Documentation](development/api.md) - REST API reference.
- [Authentication Guide](ENGINE-AUTHENTICATION.md) - Practical guide for app developers on using Keycloak and Traefik.
- [Frontend Guide](development/frontend-guide.md) - Guide for frontend development.
- [Orun App Specification](development/orun-app-spec.md) - Specifications for the Orun application.
- [Roadmap to 1.0](development/roadmap-to-1.0.md) - Release gates and acceptance evidence.
- [Roadmap to 1.1 RC](development/roadmap-to-1.1.0-rc.md) - Google AI Lab candidature and deferred infrastructure certification.
- [1.0 RC Publication Gates](development/1.0-rc-publication-gates.md) - Candidate-specific GO/NO-GO checklist and evidence record.
- [BPMN Support](reference/bpmn-support.md) - Guaranteed and rejected BPMN constructs.
- [Deployment Support](reference/deployment-support.md) - Supported runtime and security modes.
- [Upgrading](operations/upgrading.md) - Schema and deployment upgrade procedure.

### 📝 Release Notes

History of changes and updates.

- [Release Notes](release-notes/) - Directory containing release notes for all versions.

---
*Documentation structure organized for clarity and ease of navigation.*
