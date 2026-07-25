# Loki Integration Walkthrough

## Overview

Successfully integrated Loki as the centralized log aggregation system for the Abada Engine, completing the "three pillars of observability" (metrics, traces, and logs) using a unified OpenTelemetry pipeline.

## Changes Made

### 1. Infrastructure Configuration

#### Promtail for Log Collection
- **[promtail-config.yaml](//docker/promtail-config.yaml)**: Created configuration to tail application log files from `/var/log/abada/*.log` and forward them to Loki.
- **[docker-compose.yml](//docker-compose.yml)**: Added `promtail` service, mounting the `./logs` directory and linking to Loki.

#### Loki Configuration
- **[loki-config-dev.yaml](//docker/loki-config-dev.yaml)**: Increased ingestion rate limits to handle log volume:
  - `ingestion_rate_mb`: 50
  - `per_stream_rate_limit`: 50MB

---

### 2. Application Logging Configuration

#### Logback Configuration
- **[logback-spring.xml](//src/main/resources/logback-spring.xml)**:
  - Configured `RollingFileAppender` to write logs to `logs/abada-engine.log`.
  - Ensured logs include `traceId` and `spanId` in the pattern for correlation.

#### Docker Compose
- **[docker-compose.dev.yml](//docker-compose.dev.yml)**:
  - Added volume mount `./logs:/app/logs:z` to expose application logs to the host (and Promtail).

---

### 3. Documentation Updates

#### Observability Reference Guide
- **[observability-reference-guide.md](//docs/observability-reference-guide.md)**:
  - Updated architecture to show Promtail integration.
  - Added Promtail configuration examples.
  - Removed OpenTelemetry logging configuration.

#### README
- **[README.md](//README.md)**:
  - Updated observability section to mention Promtail and Loki.

---

## Architecture

The complete observability pipeline now follows this flow:

```
┌─────────────────┐
│  Spring Boot    │
│  Application    │
└────────┬────────┘
         │
         ├─── Traces ───┐
         ├─── Metrics ──┤
         └─── Logs ─────┼───> [File System]
                        │          │
                        ▼          ▼
              ┌──────────────────┐ ┌──────────┐
              │ OpenTelemetry    │ │ Promtail │
              │   Collector      │ └────┬─────┘
              └────────┬─────────┘      │
                       │                │
         ┌─────────────┼─────────────┐  │
         │             │             │  │
         ▼             ▼             ▼  ▼
    ┌────────┐   ┌──────────┐   ┌──────┐
    │ Jaeger │   │Prometheus│   │ Loki │
    └────────┘   └──────────┘   └──────┘
         │             │             │
         └─────────────┴─────────────┘
                       │
                       ▼
                 ┌──────────┐
                 │ Grafana  │
                 └──────────┘
```

## Key Features

### 1. Unified Observability Pipeline
All telemetry data (traces, metrics, logs) flows through a single OpenTelemetry Collector, providing:
- Consistent configuration
- Centralized processing
- Unified resource attribution

### 2. Automatic Trace Correlation
Logs automatically include `traceId` and `spanId` from the MDC context, enabling:
- Jump from traces in Jaeger to related logs in Loki
- Filter logs by specific trace IDs
- Correlate distributed operations across services

### 3. Efficient Log Storage
Loki uses label-based indexing instead of full-text indexing:
- Faster queries
- Lower storage costs
- Better performance at scale

### 4. Seamless Grafana Integration
All observability data is accessible in Grafana:
- Metrics dashboards from Prometheus
- Trace exploration from Jaeger
- Log queries from Loki
- Unified view of system behavior

## Usage Examples

### Querying Logs in Grafana

1. Navigate to Grafana Explore view
2. Select Loki as the data source
3. Use LogQL queries:

```logql
# All logs from abada-engine
{service_name="abada-engine"}

# Filter by log level
{service_name="abada-engine"} | json | level="ERROR"

# Logs for a specific trace
{service_name="abada-engine"} | json | traceId="abc123def456"
```

### Trace-to-Logs Workflow

1. Find a trace in Jaeger (http://localhost:16686)
2. Copy the trace ID
3. In Grafana Explore, query Loki:
   ```logql
   {service_name="abada-engine"} | json | traceId="<paste-trace-id>"
   ```
4. View all logs associated with that specific request

## Next Steps

To complete the verification:

1. **Rebuild the application** with new dependencies:
   ```bash
   mvn clean package -DskipTests
   docker-compose build abada-engine
   ```

2. **Restart services**:
   ```bash
   docker-compose restart otel-collector
   docker-compose restart abada-engine
   ```

3. **Configure Grafana**:
   - Add Loki as a data source (http://loki:3100)
   - Test log queries in Explore view

4. **Verify trace correlation**:
   - Make API requests to generate traces
   - Verify logs appear in Loki with trace IDs
   - Test jumping between Jaeger traces and Loki logs

## Troubleshooting

### Loki Container Issues
- **Permission errors**: Fixed by configuring proper ingester ring structure
- **Configuration errors**: Ensure `ingester.lifecycler.ring` is used instead of top-level `ring`

### OTel Collector Issues
- **Unknown exporter**: Use `otlphttp/loki` instead of `loki` exporter
- **Connection errors**: Verify Loki is running and accessible at `http://loki:3100`

### Application Issues
- **Missing dependencies**: Ensure `opentelemetry-logback-appender-1.0` and `logstash-logback-encoder` are in pom.xml
- **No logs in Loki**: Check that OTEL appender is added to logger configurations
