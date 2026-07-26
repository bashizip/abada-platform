# Abada Engine API Documentation

This document provides a detailed and accurate overview of the Abada Engine REST API endpoints. All request and response bodies are in JSON format.

---

## Service Information

`GET /v1/info` is the public service-discovery endpoint. It reports stable
product, release, API and BPMN contract metadata and links clients to the
OpenAPI document, Swagger UI and operational health probes.

```json
{
  "name": "Abada Engine",
  "service": "abada-engine",
  "description": "Open-source, self-hosted BPMN 2.0 workflow orchestration engine",
  "version": "1.0.0-rc.2",
  "api": {
    "version": "v1",
    "openApi": "/api/v3/api-docs",
    "swaggerUi": "/api/swagger-ui.html"
  },
  "engine": {
    "standard": "BPMN 2.0",
    "supportLevel": "documented-subset",
    "persistence": "PostgreSQL"
  },
  "health": {
    "liveness": "/api/actuator/health/liveness",
    "readiness": "/api/actuator/health/readiness"
  }
}
```

The endpoint does not report health itself. Use the advertised liveness and
readiness probes for operational decisions. The RC.2 response intentionally
replaces the earlier untyped payload: `status`, `profile`, host/JVM runtime
details and DMN/CMMN roadmap claims are no longer returned.

---

## Authentication

All API endpoints require the following headers to be sent with each request to establish the user's identity and permissions:

- `X-User`: The unique identifier for the user (e.g., `alice`).
- `X-Groups`: A comma-separated list of groups the user belongs to (e.g., `customers,managers`).

---

## Standard Error Response

When an API call fails due to a client-side error (e.g., providing an unknown ID, violating a business rule), the server will respond with a `400 Bad Request` status and a standardized JSON error body:

```json
{
  "status": 400,
  "message": "A clear, specific error message.",
  "path": "/v1/the-endpoint-that-was-called"
}
```

---

## Process Controller

### Deploy a Process

Deploys a new BPMN process definition from an XML file.

- **Method & URL**: `POST /v1/processes/deploy`
- **Request Type**: `multipart/form-data`
  - `file`: The BPMN 2.0 XML file.
- **Success Response** (`200 OK`):

  ```json
  {
    "status": "Deployed"
  }
  ```

### List Deployed Processes

Retrieves a list of all deployed process definitions.

- **Method & URL**: `GET /v1/processes`
- **Success Response** (`200 OK`):

  ```json
  [
    {
      "id": "process_1",
      "name": "My Process",
      "documentation": "This is the official process for handling customer orders."
    }
  ]
  ```

**Notes:**

- Process definitions may include `candidateStarterGroups` and `candidateStarterUsers` attributes in their BPMN XML
- These attributes define authorization rules for who can start the process
- Example in BPMN:

  ```xml
  <bpmn:process id="recipe-cook" 
                camunda:candidateStarterGroups="customers,managers"
                camunda:candidateStarterUsers="alice,bob">
  ```

- These values are parsed during deployment and stored in the database
- Client applications can use these values to control process start authorization in their UI

### Start a Process Instance

Starts a new instance of a deployed process.

- **Method & URL**: `POST /v1/processes/start`
- **Query Parameters**:
  - `processId` (string, required): The ID of the process to start. Example: `/v1/processes/start?processId=recipe-cook`
  - **`username` (string, optional)**: The username of the person starting the process. If not provided, defaults to `"system"`. Example: `/v1/processes/start?processId=recipe-cook&username=alice`
- **Success Response** (`200 OK`):

  ```json
  {
    "processInstanceId": "a1b2c3d4-e5f6-7890-1234-567890abcdef"
  }
  ```

- **Error Response** (`400 Bad Request`):

  ```json
  {
    "status": 400,
    "message": "Unknown process ID: invalid-process-id",
    "path": "/v1/processes/start"
  }
  ```

**Notes:**

- The `username` parameter enables audit tracking of who started each process instance
- The value is stored in the `startedBy` field of the process instance
- If omitted, the process is marked as started by `"system"`

### List Process Instances

Retrieves a bounded page of process instances.

- **Method & URL**: `GET /v1/processes/instances`
- **Query Parameters**:
  - `page` (integer, optional): Zero-based page number. Defaults to `0`.
  - `size` (integer, optional): Page size from `1` to `100`. Defaults to `50`.
- **Pagination Headers**: `X-Page`, `X-Page-Size`, `X-Total-Count`, `X-Total-Pages`.
- **Success Response** (`200 OK`):

  ```json
  [
    {
      "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      "processDefinitionId": "recipe-cook",
      "processDefinitionName": "Recipe Cook Process",
      "currentActivityId": "cook-recipe",
      "status": "RUNNING",
      "startDate": "2024-01-01T12:00:00Z",
      "endDate": null,
      "startedBy": "alice",
      "variables": {}
    }
  ]
  ```

### Get a Process Instance by ID

Retrieves a specific process instance by its ID.

- **Method & URL**: `GET /v1/processes/instances/{id}`
- **Path Parameters**:
  - `{id}` (string, required): The unique ID of the process instance. **This must be part of the URL path.**
- **Success Response** (`200 OK`):

  ```json
  {
    "id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
    "processDefinitionId": "recipe-cook",
    "processDefinitionName": "Recipe Cook Process",
    "currentActivityId": "cook-recipe",
    "status": "RUNNING",
    "startDate": "2024-01-01T12:00:00Z",
    "endDate": null,
    "startedBy": "alice",
    "variables": {
      "orderId": "order_456"
    }
  }
  ```

**Response Fields:**

- `id`: Unique identifier for the process instance
- `processDefinitionId`: ID of the process definition this instance is based on
- `processDefinitionName`: Human-readable name of the process definition
- `currentActivityId`: ID of the current activity (task/event) where the process is waiting
- `status`: Current status of the process instance (`RUNNING`, `COMPLETED`, `FAILED`)
- `startDate`: Timestamp when the process instance was started (ISO 8601 format)
- `endDate`: Timestamp when the process instance completed (null if still running)
- **`startedBy`**: Username of the person who started the process (or `"system"` for automated starts)
- `variables`: Key-value pairs of process variables

### Fail a Process Instance

Marks a running process instance as FAILED.

- **Method & URL**: `POST /v1/processes/instance/{id}/fail`
- **Path Parameters**:
  - `{id}` (string, required): The unique ID of the process instance to fail. **This must be part of the URL path.**
- **Success Response** (`200 OK`):

  ```json
  {
    "status": "Failed",
    "processInstanceId": "a1b2c3d4-e5f6-7890-1234-567890abcdef"
  }
  ```

### Get a Process Definition by ID

Retrieves a specific process definition by its ID.

- **Method & URL**: `GET /v1/processes/{id}`
- **Path Parameters**:
  - `{id}` (string, required): The ID of the process definition. **This must be part of the URL path.**
- **Success Response** (`200 OK`):

  ```json
  {
    "id": "recipe-cook",
    "name": "Recipe Cook Process",
    "documentation": "A simple process for cooking a recipe.",
    "bpmnXml": "<bpmn:definitions>..."
  }
  ```

---

## Task Controller

### List Visible Tasks

Retrieves a list of tasks visible to the current user.

- **Method & URL**: `GET /v1/tasks`
- **Query Parameters**:
  - `status` (string, optional): Filters tasks by their current status. (e.g., `AVAILABLE`, `CLAIMED`).
  - `page` (integer, optional): Zero-based page number. Defaults to `0`.
  - `size` (integer, optional): Page size from `1` to `100`. Defaults to `50`.
- **Pagination Headers**: `X-Page`, `X-Page-Size`, `X-Total-Count`, `X-Total-Pages`.
- **Success Response** (`200 OK`):

  ```json
  [
    {
      "id": "task_789",
      "taskDefinitionKey": "review-order",
      "name": "Review Order",
      "assignee": "patrick",
      "status": "CLAIMED",
      "startDate": "2024-01-01T12:00:00Z",
      "endDate": null,
      "candidateUsers": [],
      "candidateGroups": ["managers"],
      "processInstanceId": "process-instance-456",
      "processDefinitionId": "order-processing",
      "processDefinitionName": "Order Processing",
      "processStatus": "RUNNING",
      "processSuspended": false,
      "processStartDate": "2024-01-01T11:50:00Z",
      "processEndDate": null,
      "currentActivityId": "review-order",
      "variables": {
        "orderId": "order_456"
      }
    }
  ]
  ```

### Get Task by ID

Retrieves the details of a specific task by its ID.

- **Method & URL**: `GET /v1/tasks/{id}`
- **Path Parameters**:
  - `{id}` (string, required): The unique ID of the task. **This must be part of the URL path.**
- **Success Response** (`200 OK`):

  ```json
  {
    "id": "task_789",
    "taskDefinitionKey": "review-order",
    "name": "Review Order",
    "assignee": "patrick",
    "status": "CLAIMED",
    "startDate": "2024-01-01T12:00:00Z",
    "endDate": null,
    "candidateUsers": [],
    "candidateGroups": ["managers"],
    "processInstanceId": "process-instance-456",
    "processDefinitionId": "order-processing",
    "processDefinitionName": "Order Processing",
    "processStatus": "RUNNING",
    "processSuspended": false,
    "processStartDate": "2024-01-01T11:50:00Z",
    "processEndDate": null,
    "currentActivityId": "review-order",
    "variables": {
      "orderId": "order_456"
    }
  }
  ```

### Claim a Task

Claims an unassigned task for the current user.

- **Method & URL**: `POST /v1/tasks/claim`
- **Query Parameters**:
  - `taskId` (string, required): The ID of the task to claim. Example: `/v1/tasks/claim?taskId=task_789`
- **Success Response** (`200 OK`):

  ```json
  {
    "status": "Claimed",
    "taskId": "task_789"
  }
  ```

### Complete a Task

Completes a task currently assigned to the user.

- **Method & URL**: `POST /v1/tasks/complete`
- **Query Parameters**:
  - `taskId` (string, required): The ID of the task to complete.
- **Request Body** (JSON, optional):

  ```json
  {
    "approved": true,
    "comments": "Looks good."
  }
  ```

- **Success Response** (`200 OK`):

  ```json
  {
    "status": "Completed",
    "taskId": "task_789"
  }
  ```

- **Error Response** (`400 Bad Request`):

  ```json
  {
    "status": 400,
    "message": "Task not found: invalid-task-id",
    "path": "/v1/tasks/complete"
  }
  ```

### Fail a Task

Marks a task as FAILED.

- **Method & URL**: `POST /v1/tasks/fail`
- **Query Parameters**:
  - `taskId` (string, required): The ID of the task to fail.
- **Success Response** (`200 OK`):

  ```json
  {
    "status": "Failed",
    "taskId": "task_789"
  }
  ```

### Get User Statistics

Retrieves comprehensive statistics and activity data for the current user.

- **Method & URL**: `GET /v1/tasks/user-stats`
- **Success Response** (`200 OK`):

  ```json
  {
    "quickStats": {
      "activeTasks": 2,
      "completedTasks": 15,
      "runningProcesses": 3,
      "availableTasks": 1
    },
    "recentTasks": [
      {
        "id": "03b905d8-c251-4c40-8bb3-086a29299445",
        "name": "Review Order",
        "taskDefinitionKey": "review-order",
        "status": "COMPLETED",
        "startDate": "2024-01-15T10:30:00Z",
        "processInstanceId": "656f2037-dddd-4c0f-af68-02a8634ff0e4"
      },
      {
        "id": "c1067e06-5910-42cc-b172-c9bcf91b24d8",
        "name": "Approve Payment",
        "taskDefinitionKey": "approve-payment",
        "status": "CLAIMED",
        "startDate": "2024-01-15T09:15:00Z",
        "processInstanceId": "17278ff4-40d0-426c-88bd-c8b24c64c39e"
      }
    ],
    "tasksByStatus": {
      "AVAILABLE": 1,
      "CLAIMED": 2,
      "COMPLETED": 15,
      "FAILED": 0
    },
    "overdueTasks": [
      {
        "id": "overdue-task-123",
        "name": "Urgent Review",
        "taskDefinitionKey": "urgent-review",
        "startDate": "2024-01-08T14:00:00Z",
        "daysOverdue": 7,
        "processInstanceId": "process-instance-456"
      }
    ],
    "processActivity": {
      "recentlyStartedProcesses": [
        {
          "id": "bf395379-cf21-4129-84f1-ac39c68022f7",
          "processDefinitionId": "order-processing",
          "startDate": "2024-01-15T08:00:00Z",
          "currentActivityId": "review-order"
        },
        {
          "id": "656f2037-dddd-4c0f-af68-02a8634ff0e4",
          "processDefinitionId": "payment-approval",
          "startDate": "2024-01-14T16:30:00Z",
          "currentActivityId": null
        }
      ],
      "activeProcessCount": 3,
      "completionRate": 0.75
    }
  }
  ```

**Response Fields Description:**

- **quickStats**: Summary statistics for the user
  - `activeTasks`: Number of tasks currently in CLAIMED status by the user
  - `completedTasks`: Number of tasks completed by the user
  - `runningProcesses`: Number of process instances that have tasks for the user
  - `availableTasks`: Number of tasks the user can claim (AVAILABLE status + eligible)

- **recentTasks**: Array of the 10 most recent tasks assigned to the user, ordered by start date (newest first)
  - `id`: Unique task identifier
  - `name`: Human-readable task name
  - `taskDefinitionKey`: BPMN task definition key
  - `status`: Current task status
  - `startDate`: When the task was created
  - `processInstanceId`: ID of the process instance containing this task

- **tasksByStatus**: Object with task counts grouped by status
  - Keys are task status values (AVAILABLE, CLAIMED, COMPLETED, FAILED, etc.)
  - Values are the count of tasks in that status for the user

- **overdueTasks**: Array of tasks that are overdue (CLAIMED for more than 7 days)
  - `id`: Unique task identifier
  - `name`: Human-readable task name
  - `taskDefinitionKey`: BPMN task definition key
  - `startDate`: When the task was created
  - `daysOverdue`: Number of days the task has been overdue
  - `processInstanceId`: ID of the process instance containing this task

- **processActivity**: Information about processes related to the user
  - `recentlyStartedProcesses`: Array of recently started processes that have tasks for the user
    - `id`: Unique process instance identifier
    - `processDefinitionId`: ID of the process definition
    - `startDate`: When the process instance was started
    - `currentActivityId`: Current activity ID (null if process is completed)
  - `activeProcessCount`: Number of active (RUNNING) process instances with user's tasks
  - `completionRate`: Decimal value (0.0 to 1.0) representing the completion rate for processes with user's tasks

---

## Event Controller

### Correlate a Message Event

- **Method & URL**: `POST /v1/events/messages`
- **Request Body** (JSON, required):

  ```json
  {
    "messageName": "order_shipped",
    "correlationKey": "order_456",
    "variables": {}
  }
  ```

- **Success Response**: `202 Accepted` (No response body)
- **Error Response** (`400 Bad Request`):

  ```json
  {
    "status": 400,
    "message": "No process instance found for correlation key: invalid_key",
    "path": "/v1/events/messages"
  }
  ```

### Broadcast a Signal Event

- **Method & URL**: `POST /v1/events/signals`
- **Request Body** (JSON, required):

  ```json
  {
    "signalName": "system_maintenance",
    "variables": {}
  }
  ```

- **Success Response**: `202 Accepted` (No response body)

---

## Operations Cockpit API

The following endpoints support the "Orun Active Operations Cockpit" for managing and troubleshooting running processes.

**Controller Organization:**

- **Process Management** endpoints are handled by `ProcessController` under `/v1/processes`
- **Operations Cockpit** endpoints are handled by `CockpitController` under `/v1/process-instances`
- **Job Management** endpoints are handled by `JobController` under `/v1/jobs`

This separation provides clear organization between core process operations and operational/troubleshooting features.

### Job Management ("Fix It" Endpoints)

#### List Failed Jobs

Lists all failed jobs (external tasks) that require attention.

- **Method & URL**: `GET /v1/jobs`
- **Query Parameters**:
  - `withException` (boolean, optional, default: `true`): Filter to include only jobs with exception information
  - `active` (boolean, optional, default: `true`): Filter to include only jobs that can be retried
- **Success Response** (`200 OK`):

  ```json
  [
    {
      "id": "job-123",
      "processInstanceId": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
      "activityId": "send-email-task",
      "exceptionMessage": "SMTP connection failed",
      "retries": 2
    }
  ]
  ```

**Use Case**: Orun displays this list in the "Attention Required" panel to show operators which jobs need intervention.

#### Retry a Failed Job

Sets the retry count for a failed job, allowing it to be re-executed.

- **Method & URL**: `POST /v1/jobs/{jobId}/retries`
- **Path Parameters**:
  - `{jobId}` (string, required): The ID of the failed job
- **Request Body**:

  ```json
  {
    "retries": 3
  }
  ```

- **Success Response** (`200 OK`): Empty response
- **Error Response** (`404 Not Found`): Job not found

**Use Case**: Operators use the "Retry" button in Orun to give a failed job another chance to execute.

#### Get Job Stack Trace

Retrieves the full stack trace of a failed job for debugging.

- **Method & URL**: `GET /v1/jobs/{jobId}/stacktrace`
- **Path Parameters**:
  - `{jobId}` (string, required): The ID of the failed job
- **Success Response** (`200 OK`):

  ```
  java.net.ConnectException: Connection refused
      at java.base/sun.nio.ch.Net.pollConnect(Native Method)
      at java.base/sun.nio.ch.Net.pollConnectNow(Net.java:672)
      ...
  ```

  **Content-Type**: `text/plain`

- **Error Response** (`404 Not Found`): Job not found

**Use Case**: When operators click "Show Error" in Orun, they can view the detailed stack trace to diagnose the root cause.

### Variable Management ("Data Surgery" Endpoints)

#### List Process Variables

Gets all variables for a specific process instance with type information.

- **Method & URL**: `GET /v1/process-instances/{instanceId}/variables`
- **Path Parameters**:
  - `{instanceId}` (string, required): The ID of the process instance
- **Success Response** (`200 OK`):

  ```json
  {
    "orderId": {
      "value": 12345,
      "type": "Integer"
    },
    "customerName": {
      "value": "Alice Smith",
      "type": "String"
    },
    "approved": {
      "value": true,
      "type": "Boolean"
    },
    "totalAmount": {
      "value": 299.99,
      "type": "Double"
    }
  }
  ```

- **Error Response** (`404 Not Found`): Process instance not found

**Use Case**: Orun displays the current state of all process variables, allowing operators to inspect the data before making corrections.

#### Modify Process Variables

Patches (modifies) variables for a specific process instance.

- **Method & URL**: `PATCH /v1/process-instances/{instanceId}/variables`
- **Path Parameters**:
  - `{instanceId}` (string, required): The ID of the process instance
- **Request Body**:

  ```json
  {
    "modifications": {
      "approved": {
        "value": false,
        "type": "Boolean"
      },
      "totalAmount": {
        "value": 399.99,
        "type": "Double"
      }
    }
  }
  ```

- **Success Response** (`200 OK`): Empty response
- **Error Response** (`404 Not Found`): Process instance not found

**Use Case**: When a process is stuck due to incorrect variable values, operators can use Orun's "Data Surgery" feature to fix the state and unblock execution.

**Supported Types**:

- `Integer`
- `Long`
- `Double`
- `Float`
- `Boolean`
- `String`

### Instance Management ("Control Room" Endpoints)

#### Cancel Process Instance

Terminates a running process instance immediately. The status changes to `CANCELLED`.

- **Method & URL**: `DELETE /v1/process-instances/{id}`
- **Path Parameters**:
  - `{id}` (string, required): The ID of the process instance
- **Request Body** (JSON, optional):

  ```json
  {
    "reason": "Customer cancelled the order"
  }
  ```

- **Success Response** (`204 No Content`): Empty response
- **Error Response** (`404 Not Found`): Process instance not found

**Use Case**: When a process needs to be stopped permanently (e.g., duplicate order, business decision).

#### Suspend/Activate Process Instance

Suspends (pauses) or activates (resumes) a process instance. A suspended process cannot advance or complete tasks.

- **Method & URL**: `PUT /v1/process-instances/{id}/suspension`
- **Path Parameters**:
  - `{id}` (string, required): The ID of the process instance
- **Request Body** (JSON, required):

  ```json
  {
    "suspended": true
  }
  ```

- **Success Response** (`200 OK`): Empty response
- **Error Response** (`404 Not Found`): Process instance not found

**Use Case**: Temporarily pausing a process to investigate issues or wait for external conditions without terminating it.

### Visualizer Endpoint

#### Get Active Activity Instances

Retrieves the currently active activity instances (tokens) for BPMN visualization.

- **Method & URL**: `GET /v1/process-instances/{id}/activity-instances`
- **Path Parameters**:
  - `{id}` (string, required): The ID of the process instance
- **Success Response** (`200 OK`):

  ```json
  {
    "instanceId": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
    "childActivityInstances": [
      {
        "activityId": "UserTask_1",
        "activityName": "Review Order",
        "executionId": "exec-a1b2c3d4..."
      }
    ]
  }
  ```

- **Error Response** (`404 Not Found`): Process instance not found

**Use Case**: Orun uses this to highlight the current position of the token on the BPMN diagram.

---

## Summary

The Abada Engine API provides comprehensive endpoints for:

- Deploying and managing BPMN process definitions
- Starting and tracking process instances
- Managing user tasks and assignments
- External task worker patterns
- Event-based process coordination (messages, signals, timers)
- **Operations management** (job recovery, variable surgery)

All endpoints follow RESTful conventions and return structured JSON responses for easy integration with client applications like Orun.

---

## Complete API Endpoint Reference

### ProcessController (`/v1/processes`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/processes/deploy` | Deploy a BPMN process definition |
| GET | `/v1/processes` | List all deployed process definitions |
| GET | `/v1/processes/{id}` | Get a specific process definition by ID |
| POST | `/v1/processes/start` | Start a new process instance |
| GET | `/v1/processes/instances` | List all process instances |
| GET | `/v1/processes/instances/{id}` | Get a specific process instance by ID |
| POST | `/v1/processes/instance/{id}/fail` | Mark a process instance as FAILED |

### CockpitController (`/v1/process-instances`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/process-instances/{id}/variables` | Get all variables for a process instance |
| PATCH | `/v1/process-instances/{id}/variables` | Modify variables for a process instance (Data Surgery) |
| DELETE | `/v1/process-instances/{id}` | Cancel a process instance |
| PUT | `/v1/process-instances/{id}/suspension` | Suspend or activate a process instance |
| GET | `/v1/process-instances/{id}/activity-instances` | Get active activity instances for BPMN visualization |

### JobController (`/v1/jobs`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/jobs` | List failed jobs (with filters) |
| POST | `/v1/jobs/{jobId}/retries` | Set retry count for a failed job |
| GET | `/v1/jobs/{jobId}/stacktrace` | Get stack trace for a failed job |

### TaskController (`/v1/tasks`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/tasks` | List visible tasks for current user |
| GET | `/v1/tasks/{id}` | Get task details by ID |
| POST | `/v1/tasks/claim` | Claim a task |
| POST | `/v1/tasks/complete` | Complete a task |
| POST | `/v1/tasks/fail` | Mark a task as FAILED |
| GET | `/v1/tasks/user-stats` | Get user statistics and activity data |

### EventController (`/v1/events`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/events/messages` | Correlate a message event |
| POST | `/v1/events/signals` | Broadcast a signal event |

---

## Controller Architecture

The Abada Engine API is organized into specialized controllers for better separation of concerns:

- **ProcessController**: Core process lifecycle management (deploy, start, query)
- **CockpitController**: Operations and troubleshooting features for Orun
- **JobController**: External task and job management
- **TaskController**: User task management and assignment
- **EventController**: Event-based process coordination

This architecture ensures clean separation between business process operations and operational/monitoring capabilities.
