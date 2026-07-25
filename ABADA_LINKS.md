# Abada Platform Service Links

This document provides a quick reference for all the accessible service links in the Abada development environment.

## Development platform (HTTP)

| Service | URL | Description |
| :--- | :--- | :--- |
| **Abada Engine API** | [http://api.localhost/api](http://api.localhost/api) | Core BPMN execution engine API |
| **Swagger UI** | [http://api.localhost/api/swagger-ui.html](http://api.localhost/api/swagger-ui.html) | Interactive API documentation |
| **Abada Tenda** | [http://tenda.localhost](http://tenda.localhost) | Task management UI |
| **Abada Orun** | [http://orun.localhost](http://orun.localhost) | Operations cockpit |
| **Keycloak Admin** | [http://keycloak.localhost](http://keycloak.localhost) | Development identity provider |
| **Traefik Dashboard** | [http://127.0.0.1:8080/dashboard/](http://127.0.0.1:8080/dashboard/) | Loopback-only local routing dashboard |

## Optional telemetry overlay

| Service | URL | Description |
| :--- | :--- | :--- |
| **Grafana** | [http://127.0.0.1:3000](http://127.0.0.1:3000) | Loopback-only entry point for provisioned metrics, traces and logs |

---
**Note:** Prometheus, Jaeger, Loki, Promtail and the collector stay on the
internal telemetry network. Grafana is their supported user interface. Start
them with `./release/abada-platform up dev --telemetry`.
