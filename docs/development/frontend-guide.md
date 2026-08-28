
# Frontend Development Prompt for Tenda & Orun

> **Reference guide.** This guide covers the legacy Tenda and Orun applications,
> which are retained as historical reference implementations only. They are
> **not built, published, or started by any supported Compose profile or release
> image set.** For the supported operator UI, see the
> [Studio app specification](studio-app-spec.md).

Hello! You are an expert Next.js developer tasked with building the `Tenda` (task list) and `Orun` (monitoring) frontends for the Abada BPMN engine. Your goal is to create a full-featured, desktop-first web application that interacts with the existing Abada backend API.

To begin, you must learn the project's context and API contract. Follow this two-step process:

**Step 1: High-Level Context & API Summary**

First, read these documentation files for a high-level overview of the architecture and a summary of the API.

* **Architecture Document:** `//docs/abada_architecture_doc.md`
* **API Documentation:** `//docs/api-documentation.md`

**Step 2: Definitive API Contract (Source of Truth)**

The documentation may not be perfectly up-to-date. Therefore, you **must** treat the following Java source files as the single source of truth for all data structures (DTOs), field names, and exact API endpoint behavior.

* **Task API:**
  * `//src/main/java/com/abada/engine/api/TaskController.java`
  * `//src/main/java/com/abada/engine/dto/TaskDetailsDto.java`
* **Process API:**
  * `//src/main/java/com/abada/engine/api/ProcessController.java`
  * `//src/main/java/com/abada/engine/dto/ProcessInstanceDTO.java`
* **Event API:**
  * `//src/main/java/com/abada/engine/api/EventController.java`

---

### **Application Requirements**

Based on the context you've learned, build a Next.js application with the following pages and features:

**1. Login Page**

* **Route:** `/login`
* **Functionality:** A form with `username` and `password` fields. On submission, it should call a (mocked for now) `/auth` endpoint, save the returned JWT, and redirect the user to `/tasks`.

**2. Task Management**

* **Task List Page:**
  * **Route:** `/tasks`
  * **Functionality:** Fetch data from `GET /v1/tasks`. Display a list of tasks showing `name`, `assignee`, `candidateGroups`, and `status`. Implement filters for status, assignee, and due date. The list should poll for updates every 15 seconds.
* **Task Detail Page:**
  * **Route:** `/tasks/[id]`
  * **Functionality:** Fetch data from `GET /v1/tasks/{id}`. Display all task metadata and process variables. Provide buttons to "Claim" (`POST /v1/tasks/claim`) and "Complete" (`POST /v1/tasks/complete` with a form for optional variables).

**3. Process Management**

* **Upload Process Page:**
  * **Route:** `/processes/upload`
  * **Functionality:** An upload form for a BPMN file that calls `POST /v1/processes/deploy`.
* **Process List Page:**
  * **Route:** `/processes`
  * **Functionality:** Fetch and display all deployed process definitions from `GET /v1/processes`.
* **Process Detail Page:**
  * **Route:** `/processes/[id]`
  * **Functionality:** Fetch data from `GET /v1/processes/{id}` and display the BPMN XML in a code viewer component.
* **Start Process Page:**
  * **Route:** `/processes/start`
  * **Functionality:** A form to select a `processId` from a dropdown and input initial variables as a JSON object. Calls `POST /v1/processes/start`.
* **Process Instances List Page:**
  * **Route:** `/processes/instances`
  * **Functionality:** Fetch data from `GET /v1/processes/instances`. Display a list of all instances with their `instanceId`, `currentActivityId`, `variables`, and `status` (waiting/completed).
* **Instance Detail Page:**
  * **Route:** `/processes/instances/[id]`
  * **Functionality:** Fetch and display detailed information for a single process instance from `GET /v1/processes/instances/{id}`.

**4. Event Management (Future-Ready)**

* **Functionality:** Include a simple UI to send message events (`POST /v1/events/messages`) and broadcast signal events (`POST /v1/events/signals`).

---

### **Proposed Code Structure**

Organize the project using the following structure:

* `/app/(auth)/login/page.tsx`
* `/app/tasks/page.tsx`
* `/app/tasks/[id]/page.tsx`
* `/app/processes/upload/page.tsx`
* `/app/processes/page.tsx`
* `/app/processes/[id]/page.tsx`
* `/app/processes/start/page.tsx`
* `/app/processes/instances/page.tsx`
* `/app/processes/instances/[id]/page.tsx`
* `/components/task-card.tsx`
* `/components/task-detail.tsx`
* `/components/process-upload.tsx`
* `/components/process-starter.tsx`
* `/components/instance-card.tsx`
* `/lib/api.ts` (A fetch wrapper that manages the baseURL and injects the JWT Authorization header).

---

### **Deliverables**

* A complete Next.js project with the structure and features described above.
* Working integration with the Abada Engine API endpoints.
* Provide example mocks for local development in case the backend is unavailable.
* A clean, responsive UI (desktop-first).
