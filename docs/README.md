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

#### 🧭 Architecture Decision Records

- [ADR-001: BPMN Dialects and Vendor Compatibility](adr/ADR-001-bpmn-dialects-and-vendor-compatibility.md) - Profile-based handling of Camunda/standard/Abada-native dialects.
- [ADR-002: Native Decision Tables as the Deterministic Wall](adr/ADR-002-native-decision-tables-deterministic-wall.md) - Deterministic in-transaction decision tables as the counterweight to probabilistic agents.
- [ADR-003: The Autonomous Workflow Loop](adr/ADR-003-insight-loop-engine-otel-apl.md) - Self-optimizing AI agent loop built on OpenTelemetry telemetry and APL governance.

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
- [Frontend Guide](development/frontend-guide.md) - Guide for frontend development.
- [Orun App Specification](development/orun-app-spec.md) - Specifications for the Orun application.
- [Studio App Specification](development/studio-app-spec.md) - Specifications for the Studio authoring application: APL pipeline, deployment, live Run panel and operations.
- [Roadmap to 1.0](development/roadmap-to-1.0.md) - Release gates and acceptance evidence.
- [Roadmap to 1.1 RC](development/roadmap-to-1.1.0-rc.md) - Agentic workflow integration and deferred infrastructure certification.
- [1.0 RC Publication Gates](development/1.0-rc-publication-gates.md) - Candidate-specific GO/NO-GO checklist and evidence record.
- [BPMN Support](reference/bpmn-support.md) - Guaranteed and rejected BPMN constructs.
- [APL Specification](reference/apl-specification.md) - The Abada Process Language: YAML syntax, node types, native decision tables, expressions and error codes.
- [Deployment Support](reference/deployment-support.md) - Supported runtime and security modes.
- [Upgrading](operations/upgrading.md) - Schema and deployment upgrade procedure.

### 📝 Release Notes

History of changes and updates.

- [Release Notes](release-notes/) - Directory containing release notes for all versions.

---
*Documentation structure organized for clarity and ease of navigation.*
