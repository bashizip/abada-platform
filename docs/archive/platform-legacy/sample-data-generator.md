# Sample Data Generator

This utility generates sample data to preload the Abada Engine with process instances in various states for testing and demonstration purposes.

## Overview

The Sample Data Generator creates **6 process instances** using two BPMN processes:

- **recipe-cook.bpmn** (4 instances)
- **parallel-gateway-test.bpmn** (2 instances)

Each instance demonstrates different scenarios including completed processes, failed processes, in-progress processes at various stages, and processes with different variable values.

## Usage

### Option 1: Using the Shell Script (Recommended)

```bash
./scripts/generate-sample-data.sh
```

This script will:

1. Start the Abada Engine
2. Deploy the BPMN processes
3. Generate sample data
4. Leave the engine running with the sample data loaded

### Option 2: Using Maven Directly

```bash
./mvnw spring-boot:run -Dspring-boot.run.arguments="--abada.generate-sample-data=true"
```

### Option 3: Using Environment Variable

```bash
export ABADA_GENERATE_SAMPLE_DATA=true
./mvnw spring-boot:run
```

### Option 4: Using application.properties

Add the following to your `application.properties`:

```properties
abada.generate-sample-data=true
```

Then run the application normally:

```bash
./mvnw spring-boot:run
```

## Generated Scenarios

### Recipe Cook Process (recipe-cook.bpmn)

#### Scenario 1: Completed Recipe Process

- **User**: alice
- **State**: Completed
- **Flow**:
  1. Alice chooses a recipe (goodOne=true, recipeName="Spaghetti Carbonara")
  2. Bob cooks the recipe (cookingTime=30, rating=5)
  3. Process completes successfully

#### Scenario 2: Waiting at Choose Recipe

- **User**: jeannot
- **State**: In-progress
- **Flow**: Process started, waiting at `choose-recipe` task (not yet claimed)

#### Scenario 3: Back to Choose Recipe (Loop)

- **User**: black
- **State**: In-progress (looped back)
- **Flow**:
  1. Black chooses a recipe (goodOne=false, recipeName="Mystery Dish")
  2. Process loops back to `choose-recipe` task due to exclusive gateway condition

#### Scenario 4: Waiting at Cook Recipe

- **User**: alice (starter), waiting for cuistos group
- **State**: In-progress
- **Flow**:
  1. Alice chooses a recipe (goodOne=true, recipeName="Chicken Tikka Masala")
  2. Process advances to `cook-recipe` task
  3. Waiting for a cook (cuistos group) to claim and complete

#### Scenario 7: Explicitly Failed Process

- **User**: system
- **State**: Failed
- **Flow**:
  1. Process started
  2. Process explicitly failed via `abadaEngine.failProcess()`
  3. Status set to FAILED, end date set

#### Scenario 8: Explicitly Failed Task

- **User**: alice
- **State**: In-progress (Task Failed)
- **Flow**:
  1. Process started
  2. Alice claims `choose-recipe` task
  3. Task explicitly failed via `abadaEngine.failTask()`
  4. Task status set to FAILED

### Parallel Gateway Process (parallel-gateway-test.bpmn)

#### Scenario 5: Completed Parallel Process

- **User**: test-user
- **State**: Completed
- **Flow**:
  1. Complete InitialTask
  2. Process forks into TaskA and TaskB
  3. Both parallel tasks completed
  4. Process joins and completes

#### Scenario 6: One Parallel Branch Completed

- **User**: test-user
- **State**: In-progress (waiting at parallel join)
- **Flow**:
  1. Complete InitialTask
  2. Process forks into TaskA and TaskB
  3. TaskA completed
  4. TaskB still pending (parallel join not yet satisfied)

## User Roles

The generator uses the following users and groups as defined in the BPMN processes:

### Recipe Cook Process

- **Users**: alice, bob, black, jeannot
- **Groups**:
  - `customers` - Can start process and complete choose-recipe task
  - `cuistos` - Can complete cook-recipe task

### Parallel Gateway Process

- **Users**: test-user
- **Groups**: test-group

## Implementation Details

The sample data generator is implemented as a Spring Boot `CommandLineRunner` component that:

1. Only runs when `abada.generate-sample-data=true` is set
2. Deploys the required BPMN processes
3. Creates process instances with realistic data
4. Advances processes through various states
5. Uses proper user authentication and group membership
6. Sets meaningful process variables

## Code Location

- **Generator Class**: `src/main/java/com/abada/engine/util/SampleDataGenerator.java`
- **Shell Script**: `scripts/generate-sample-data.sh`
- **BPMN Files**:
  - `src/main/resources/bpmn/recipe-cook.bpmn`
  - `src/test/resources/bpmn/parallel-gateway-test.bpmn`

## Verification

After running the generator, you can verify the data using:

### API Endpoints

```bash
# List all process instances
curl http://localhost:8080/v1/processes/instances

# List all tasks
curl -H "X-User: alice" -H "X-Groups: customers" http://localhost:8080/v1/tasks

# Get user statistics
curl -H "X-User: alice" -H "X-Groups: customers" http://localhost:8080/v1/tasks/user-stats
```

### Database Queries

If using PostgreSQL:

```sql
-- View all process instances
SELECT id, process_definition_id, status, started_by, start_date, end_date 
FROM process_instances;

-- View all tasks
SELECT id, task_definition_key, name, assignee, status, start_date, end_date 
FROM tasks;
```

## Customization

To customize the sample data:

1. Edit `SampleDataGenerator.java`
2. Add new scenario methods
3. Modify existing scenarios with different variables or user assignments
4. Add more process instances by calling additional scenario methods

## Notes

- The generator runs automatically on application startup when enabled
- It's designed for development and testing environments only
- Sample data is created in-memory and persisted to the configured database
- The generator uses the same APIs as the test suite for consistency
- All scenarios follow the BPMN process definitions exactly

## Troubleshooting

### Generator doesn't run

- Ensure `abada.generate-sample-data=true` is set
- Check application logs for any errors during startup

### BPMN files not found

- Verify BPMN files exist in the expected locations
- Check that the classpath includes both `src/main/resources` and `src/test/resources`

### User/Group permission errors

- Verify that user and group assignments match the BPMN definitions
- Check the candidate users and groups defined in the BPMN files
# Docker Setup for Sample Data Generator

## Quick Answer

**Yes!** The `abada.generate-sample-data=true` property works in Docker. You just need to pass it as an environment variable.

## How to Enable in Docker

### Option 1: Environment Variable in docker-compose.yml

Add to the `abada-engine` service environment section:

```yaml
services:
  abada-engine:
    environment:
      - ABADA_GENERATE_SAMPLE_DATA=true
```

### Option 2: Using .env File

Create or edit `.env` file in the project root:

```bash
# .env
ABADA_GENERATE_SAMPLE_DATA=true
```

Then reference it in docker-compose.yml:

```yaml
services:
  abada-engine:
    environment:
      - ABADA_GENERATE_SAMPLE_DATA=${ABADA_GENERATE_SAMPLE_DATA:-false}
```

### Option 3: Command Line Override

```bash
# For dev environment
ABADA_GENERATE_SAMPLE_DATA=true docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# For prod environment
ABADA_GENERATE_SAMPLE_DATA=true docker-compose -f docker-compose.yml -f docker-compose.prod.yml up
```

## Complete Example: docker-compose.dev.yml

Here's what your `docker-compose.dev.yml` would look like with sample data enabled:

```yaml
version: '3.8'

services:
  abada-engine:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        USE_LOCAL_JAR: "true"
    image: abada-engine:dev
    container_name: abada-engine
    environment:
      - SPRING_PROFILES_ACTIVE=dev
      - SERVER_PORT=5601
      - DB_PASSWORD=${DB_PASSWORD:-abada123}
      - MANAGEMENT_TRACING_SAMPLING_PROBABILITY=1.0
      - MANAGEMENT_OTLP_TRACING_ENDPOINT=http://otel-collector:4318/v1/traces
      - MANAGEMENT_OTLP_METRICS_ENDPOINT=http://otel-collector:4318/v1/metrics
      - OTEL_RESOURCE_ATTRIBUTES_DEPLOYMENT_ENVIRONMENT=dev
      - OTEL_SERVICE_NAME=abada-engine-dev
      - OTEL_RESOURCE_ATTRIBUTES=project=abada,service.version=0.8.3-alpha
      # Enable sample data generation
      - ABADA_GENERATE_SAMPLE_DATA=${ABADA_GENERATE_SAMPLE_DATA:-false}
    ports:
      - "5601:5601"
    volumes:
      - ./data:/app/data:z
      - ./logs:/app/logs:z
    networks:
      - abada-network
    restart: unless-stopped
    healthcheck:
      test: [ "CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:5601/api/actuator/health" ]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      otel-collector:
        condition: service_started
```

## Environment Variable Naming

Spring Boot automatically converts environment variables:

- `ABADA_GENERATE_SAMPLE_DATA` → `abada.generate-sample-data`
- Underscores (`_`) become dots (`.`)
- Uppercase becomes lowercase

## Usage Examples

### Development with Sample Data

```bash
# Set environment variable
export ABADA_GENERATE_SAMPLE_DATA=true

# Start dev stack
./scripts/start-dev.sh

# Or directly with docker-compose
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### One-Time Sample Data Load

```bash
# Start with sample data, then stop
ABADA_GENERATE_SAMPLE_DATA=true docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Wait for data to be generated (check logs)
docker logs -f abada-engine

# Once you see "Sample Data Generation Complete", you can restart without the flag
docker-compose -f docker-compose.yml -f docker-compose.dev.yml restart abada-engine
```

### Production (Disabled by Default)

```yaml
# docker-compose.prod.yml
services:
  abada-engine:
    environment:
      # Explicitly disable in production
      - ABADA_GENERATE_SAMPLE_DATA=false
```

## Verification in Docker

After starting the container with sample data enabled:

```bash
# Check logs to see sample data generation
docker logs abada-engine | grep "Sample Data"

# Expected output:
# Starting Sample Data Generation
# Deployed recipe-cook.bpmn
# Deployed parallel-gateway-test.bpmn
# Scenario 1: Completed Recipe Process
# ...
# Sample Data Generation Complete

# Verify via API
curl http://localhost:5601/api/v1/processes/instances

# Check tasks
curl -H "X-User: alice" -H "X-Groups: customers" \
  http://localhost:5601/api/v1/tasks
```

## Important Notes

### Data Persistence

- **H2 (Dev)**: Data persists in `./data` volume
- **PostgreSQL (Prod)**: Data persists in database
- Sample data is generated **once** on startup
- Restarting the container won't regenerate data (unless you clear the database)

### When to Use

✅ **Good for:**

- Demo environments
- Development testing
- UI development
- Integration testing

❌ **Avoid for:**

- Production environments
- Performance testing (use dedicated test data)
- Load testing

### Troubleshooting

**Sample data not appearing:**

```bash
# Check if environment variable is set
docker exec abada-engine env | grep ABADA

# Check application logs
docker logs abada-engine | grep -i "sample"

# Verify the property is recognized
docker exec abada-engine cat /app/application.properties
```

**BPMN files not found:**

```bash
# Verify BPMN files are in the image
docker exec abada-engine ls -la /app/BOOT-INF/classes/bpmn/

# Check test resources are included
docker exec abada-engine find /app -name "*.bpmn"
```

## Shell Script for Docker

Create `scripts/start-dev-with-sample-data.sh`:

```bash
#!/bin/bash
set -e

echo "Starting Abada Engine (Dev) with Sample Data..."

export ABADA_GENERATE_SAMPLE_DATA=true

./scripts/start-dev.sh

echo ""
echo "Sample data will be generated on first startup."
echo "Check logs: docker logs -f abada-engine"
```

Make it executable:

```bash
chmod +x scripts/start-dev-with-sample-data.sh
```

## Summary

The sample data generator works seamlessly in Docker by:

1. Adding `ABADA_GENERATE_SAMPLE_DATA=true` to environment variables
2. Spring Boot automatically converts it to `abada.generate-sample-data=true`
3. The generator runs on container startup
4. Data persists in the configured database/volume

For the easiest setup, add the environment variable to your `.env` file or docker-compose configuration!
