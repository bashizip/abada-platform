# Loki Integration Troubleshooting & Resolution

## Issue Summary
When running in release mode with Docker, logs were not appearing in the Grafana dashboard through Loki, and the label selector was empty.

## Root Causes Identified

### 1. **Logback Configuration Issue** (Primary)
The `logback-spring.xml` configuration had a critical bug where specific loggers (lines 56-78) were configured with:
- `additivity="false"` 
- Only reference to `CONSOLE` appender
- **No reference to the `ASYNC_FILE` appender**

This meant that even though the prod profile's root logger was configured to use `ASYNC_FILE`, the specific loggers overrode this configuration and only wrote to console/stdout, not to file.

**Impact**: No logs were being written to `/app/logs/abada-engine.log`, so Promtail had nothing to scrape.

### 2. **Missing Volume Mount in Release Compose**
The `release/docker-compose.release.yml` didn't have a volume mount for the logs directory on the `abada-engine` service.

**Impact**: Even if logs were being written inside the container, they wouldn't be accessible to Promtail on the host filesystem.

## Solutions Implemented

### Solution 1: Fixed Logback Configuration
**File**: `src/main/resources/logback-spring.xml`

**Changes**:
- Split logger configurations into two `<springProfile>` blocks:
  - `<springProfile name="!prod">`: Dev/test loggers - write only to CONSOLE
  - `<springProfile name="prod">`: Production loggers - write to both JSON (console) and ASYNC_FILE

**Result**: In production mode, all logs are now written to both:
1. Console (as JSON for Docker logs)
2. File (`/app/logs/abada-engine.log`) for Promtail to scrape

### Solution 2: Added Volume Mount
**File**: `release/docker-compose.release.yml`

**Changes**:
Added volume mount to the `abada-engine` service:
```yaml
volumes:
  - type: bind
    source: /Users/pbash/repo/abada-platform/abada-engine/logs
    target: /app/logs
    bind: {}
```

**Result**: Logs written inside the container at `/app/logs/` are now accessible on the host at the `logs/` directory.

## Verification

### Check Logs Are Being Written
```bash
# Check log file size
wc -l logs/abada-engine.log

# View recent logs
tail -20 logs/abada-engine.log
```

### Check Promtail is Scraping
```bash
# View Promtail logs
docker logs promtail --tail 30

# Look for:
# - "tail routine: started" 
# - "Seeked /var/log/abada/abada-engine.log"
```

### Query Loki API Directly
```bash
# Check available labels
curl -s 'http://localhost:3100/loki/api/v1/label' | jq .

# Expected output:
# {
#   "status": "success",
#   "data": [
#     "filename",
#     "job",
#     "service_name"
#   ]
# }

# Query logs
curl -s -G 'http://localhost:3100/loki/api/v1/query_range' \
  --data-urlencode 'query={job="abada-engine"}' \
  --data-urlencode 'limit=10' | jq .
```

### Check in Grafana
1. Open Grafana: http://localhost:3000
2. Go to **Explore** (compass icon in left sidebar)
3. Select **Loki** as data source
4. In the label filters, you should now see:
   - `filename`
   - `job`
   - `service_name`
5. Use LogQL query: `{service_name="abada-engine"}`

## Alternative Solution: Docker Logging Driver (Optional)

A more cloud-native approach is to configure Promtail to scrape logs directly from Docker containers instead of files.

**File Created**: `docker/promtail-config-docker.yaml`

This configuration:
- Uses Docker service discovery
- Scrapes logs directly from `/var/lib/docker/containers/`
- Automatically adds labels from container metadata
- Requires mounting the Docker socket in Promtail

**To use this approach**:
1. Update `release/docker-compose.release.yml`:
   ```yaml
   promtail:
     volumes:
       - type: bind
         source: /var/run/docker.sock
         target: /var/run/docker.sock
       - type: bind
         source: /Users/pbash/repo/abada-platform/abada-engine/docker/promtail-config-docker.yaml
         target: /etc/promtail/config.yml
   ```

2. Restart Promtail:
   ```bash
   docker compose -f release/docker-compose.release.yml restart promtail
   ```

## Current Architecture

```
┌─────────────────┐
│  Spring Boot    │
│  Application    │  (SPRING_PROFILES_ACTIVE=prod)
└────────┬────────┘
         │
         ├─── Traces ────┐
         ├─── Metrics ───┤
         ├─── Logs (JSON to stdout)
         └─── Logs (Plain text to file: /app/logs/abada-engine.log)
                         │
                         ├─── Docker Logs (JSON)
                         └─── File System (Plain text)
                                  │
                                  ▼
                           ┌──────────┐
                           │ Promtail │ (scrapes file)
                           └────┬─────┘
                                │
         ┌──────────────────────┼────────────────────┐
         │                      │                    │
         ▼                      ▼                    ▼
    ┌────────┐          ┌──────────┐          ┌──────┐
    │ Jaeger │          │Prometheus│          │ Loki │
    └────────┘          └──────────┘          └──────┘
         │                      │                    │
         └──────────────────────┴────────────────────┘
                                │
                                ▼
                          ┌──────────┐
                          │ Grafana  │
                          └──────────┘
```

## Key Learnings

1. **Spring Boot Profile-specific Logging**: Logger configurations can be scoped to specific Spring profiles using `<springProfile>` tags
2. **Logger Additivity**: When `additivity="false"`, child loggers don't inherit appenders from parent loggers - you must explicitly configure all appenders
3. **File vs Docker Logging**: In containerized environments, consider whether to use file-based logging or Docker's native logging drivers
4. **Volume Mounts**: Always ensure log directories are mounted as volumes if you need external tools (like Promtail) to access them

## Related Files
- [logback-spring.xml](file:///Users/pbash/repo/abada-platform/abada-engine/src/main/resources/logback-spring.xml)
- [release/docker-compose.release.yml](file:///Users/pbash/repo/abada-platform/abada-engine/release/docker-compose.release.yml)
- [docker/promtail-config.yaml](file:///Users/pbash/repo/abada-platform/abada-engine/docker/promtail-config.yaml)
- [docker/promtail-config-docker.yaml](file:///Users/pbash/repo/abada-platform/abada-engine/docker/promtail-config-docker.yaml)
- [docker/loki-config-prod.yaml](file:///Users/pbash/repo/abada-platform/abada-engine/docker/loki-config-prod.yaml)
