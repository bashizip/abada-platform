# Docker Build Strategy

This document explains the optimized Docker build setup for Abada Engine.

## Overview

The project uses a **single Dockerfile** with a build argument to support two build modes:

1. **Production Build** - Self-contained, builds from source inside Docker
2. **Development Build** - Fast iteration, uses pre-built local JAR

## Build Modes

### Production Build (Default)

**When:** CI/CD pipelines, production deployments, clean builds

**Command:**

```bash
./scripts/prod/build-prod.sh
# or
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build
```

**How it works:**

1. Copies `pom.xml` into Docker
2. Downloads Maven dependencies (`dependency:go-offline`)
3. Copies source code
4. Builds JAR with Maven inside Docker

**Performance:**

- First build: ~2-3 minutes (downloads all dependencies)
- Subsequent builds: ~30 seconds (dependencies cached in Docker layer)
- After code change: ~30 seconds (uses cached dependencies)

**Advantages:**

- ✅ Self-contained (no local Maven/JDK required)
- ✅ Reproducible builds
- ✅ Dependencies cached in Docker layers
- ✅ Works in CI/CD without local setup

### Development Build

**When:** Daily development, rapid iteration, testing code changes

**Command:**

```bash
./scripts/dev-build.sh
# or
./mvnw clean package spring-boot:repackage -DskipTests
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

**How it works:**

1. Build JAR locally with Maven wrapper (~9 seconds)
2. Copy pre-built JAR into Docker (skips Maven entirely)
3. Build runtime image (~5 seconds)

**Performance:**

- Total time: ~14 seconds
- Local Maven cache speeds up dependency downloads
- Docker build is minimal (just copy JAR)

**Advantages:**

- ✅ Very fast iteration
- ✅ Uses local Maven cache (`~/.m2`)
- ✅ No dependency downloads in Docker

**Requirements:**

- ⚠️ Requires local Maven/JDK setup
- ⚠️ Must run `./mvnw package` before Docker build

## Docker Layer Caching

### Production Build Layers

```
Layer 1: maven:3.9.6-eclipse-temurin-21 (base image)
Layer 2: COPY pom.xml                    ← Cached until pom.xml changes
Layer 3: RUN mvnw dependency:go-offline  ← Cached until pom.xml changes ⭐
Layer 4: COPY src                        ← Invalidated on code change
Layer 5: RUN mvnw package                ← Runs on every code change
```

**Key insight:** Dependencies (Layer 3) are cached separately from source code (Layer 4), so changing code doesn't re-download dependencies!

### Development Build Layers

```
Layer 1: maven:3.9.6-eclipse-temurin-21 (base image)
Layer 2-5: Skipped (USE_LOCAL_JAR=true)
Layer 6: COPY target/                    ← Copy pre-built JAR
```

**Key insight:** Skips all Maven layers, just copies the JAR built locally.

## Configuration

### docker-compose.dev.yml

```yaml
services:
  abada-engine:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        USE_LOCAL_JAR: "true"  # Enable dev mode
```

### docker-compose.prod.yml

```yaml
services:
  abada-engine:
    build: .  # USE_LOCAL_JAR defaults to false
```

### Dockerfile

```dockerfile
ARG USE_LOCAL_JAR=false

# Conditional Maven execution
RUN if [ "$USE_LOCAL_JAR" = "false" ]; then \
        ./mvnw dependency:go-offline -B; \
    fi

RUN if [ "$USE_LOCAL_JAR" = "false" ]; then \
        ./mvnw clean package spring-boot:repackage -DskipTests; \
    else \
        mkdir -p target; \
    fi

# Copy local JAR (only exists in dev builds)
COPY target/ ./target/
```

## Performance Comparison

| Scenario | Dev Build | Prod Build | Notes |
|----------|-----------|------------|-------|
| **First build** | ~14s | ~3min | Prod downloads all deps |
| **Code change** | ~14s | ~30s | Prod uses cached deps |
| **No changes** | ~5s | ~5s | Both fully cached |
| **pom.xml change** | ~14s | ~3min | Both re-download deps |

## Best Practices

### For Development

1. Use `./scripts/dev-build.sh` for fastest iteration
2. Keep local Maven cache (`~/.m2`) populated
3. Run `./mvnw clean` occasionally to clear local build artifacts

### For Production

1. Use `./scripts/prod/build-prod.sh` for deployments
2. Don't modify `pom.xml` frequently to maximize cache hits
3. In CI/CD, use Docker layer caching (e.g., `--cache-from`)

### For Both

1. Keep `.dockerignore` updated to exclude large directories
2. Don't include `target/` in `.dockerignore` (needed for dev builds)
3. Monitor Docker layer cache: `docker history abada-engine:latest`

## Troubleshooting

**Q: Prod build is downloading dependencies every time**

- Check if `pom.xml` is changing between builds
- Verify Docker layer cache isn't disabled
- Try: `docker builder prune` to clear corrupted cache

**Q: Dev build fails with "jar not found"**

- Run `./mvnw clean package spring-boot:repackage -DskipTests` first
- Or use `./scripts/dev-build.sh` which does this automatically

**Q: Which mode should I use?**

- Development: Use dev build for speed
- CI/CD: Use prod build for reproducibility
- Production deployment: Use prod build for self-contained images
