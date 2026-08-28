# Orun - Active Operations Cockpit

> **Reference specification.** Orun is retained as a historical reference
> application only. It is **not built, published, or started by any supported
> Compose profile or release image set.** For the supported operator UI, see
> the [Studio app specification](studio-app-spec.md).

**Orun** (Yoruba for "divine realm") is the operations monitoring and management interface for the Abada BPMN Engine. It provides real-time visibility into running processes, failed jobs, and system health, enabling operators to troubleshoot and intervene when processes encounter issues.

---

## Overview

### Purpose

Orun serves as the **operations control center** for business process automation, designed for:

- **Operations teams** monitoring production processes
- **DevOps engineers** troubleshooting failed jobs and system issues
- **Business analysts** investigating process bottlenecks
- **Support teams** resolving stuck or failed process instances

### Key Capabilities

1. **Real-time Monitoring** - Live view of all running process instances
2. **Job Recovery** - Retry failed external tasks and service calls
3. **Data Surgery** - Modify process variables to unblock stuck instances
4. **Process Control** - Suspend, resume, or cancel process instances
5. **BPMN Visualization** - Visual representation of process flow with active token highlighting
6. **System Health** - Metrics and observability dashboards

---

## Feature Specifications

### 1. Dashboard (Home Page)

**Route:** `/`

**Purpose:** High-level overview of system health and active processes

#### Widgets

##### System Health Panel

- **Total Active Processes** - Count of RUNNING instances
- **Failed Jobs** - Count of jobs requiring attention (red badge if > 0)
- **Suspended Processes** - Count of manually paused instances
- **Completed Today** - Count of processes completed in last 24h

**Data Source:**

- `GET /v1/processes/instances` (filter by status)
- `GET /v1/jobs?withException=true&active=true`

##### Recent Activity Feed

- Last 20 process state changes (started, completed, failed, suspended)
- Timestamp, process name, instance ID, status change
- Click to navigate to instance detail

**Data Source:** `GET /v1/processes/instances` (sorted by recent activity)

##### Failed Jobs Alert Panel

- List of failed jobs requiring immediate attention
- Shows: Job ID, Process Instance, Activity Name, Exception Message
- Actions: "Retry", "View Stack Trace", "Go to Instance"
- Auto-refresh every 30 seconds

**Data Source:** `GET /v1/jobs?withException=true&active=true`

---

### 2. Process Instances

#### 2.1 Process Instances List

**Route:** `/instances`

**Purpose:** Browse and filter all process instances

##### Features

**Table Columns:**

- Instance ID (clickable link)
- Process Definition Name
- Status (badge: RUNNING=blue, COMPLETED=green, FAILED=red, CANCELLED=gray, SUSPENDED=yellow)
- Current Activity (if running)
- Started By
- Start Date/Time
- End Date/Time (if completed)
- Duration
- Actions (dropdown menu)

**Filters:**

- Status (multi-select: RUNNING, COMPLETED, FAILED, CANCELLED, SUSPENDED)
- Process Definition (dropdown)
- Date Range (start date)
- Started By (text search)

**Actions Menu (per row):**

- View Details
- View BPMN Diagram
- Suspend/Resume (if RUNNING)
- Cancel (if RUNNING or SUSPENDED)
- View Variables
- View History

**Pagination:** 50 items per page

**Data Source:** `GET /v1/processes/instances`

#### 2.2 Process Instance Detail

**Route:** `/instances/{id}`

**Purpose:** Detailed view of a single process instance

##### Sections

**Instance Header**

- Instance ID (copy button)
- Process Definition Name
- Status Badge (large, prominent)
- Started By
- Start Date/Time
- End Date/Time (if completed)
- Duration

**Action Buttons (top right):**

- Suspend/Resume (toggle)
- Cancel Process
- Edit Variables (opens Data Surgery modal)
- View BPMN Diagram

**Tabs:**

1. **Overview Tab**
   - Current Activity (if running)
   - Process Variables (read-only table)
   - Recent Events/History

2. **Variables Tab**
   - Full list of all process variables
   - Type, Name, Value columns
   - "Edit Variables" button → opens Data Surgery modal

3. **BPMN Diagram Tab**
   - Visual BPMN diagram with active tokens highlighted
   - Uses `GET /v1/process-instances/{id}/activity-instances`
   - Highlights current activities in yellow/orange
   - Shows completed activities in green (optional)

4. **History Tab**
   - Timeline of all state changes
   - Task completions, gateway decisions, event correlations
   - Timestamps and user information

**Data Sources:**

- `GET /v1/processes/instances/{id}`
- `GET /v1/process-instances/{id}/variables`
- `GET /v1/process-instances/{id}/activity-instances`

---

### 3. Failed Jobs Management

**Route:** `/jobs`

**Purpose:** Monitor and recover failed external tasks

##### Features

**Table Columns:**

- Job ID
- Process Instance ID (clickable link)
- Activity ID
- Activity Name
- Exception Message (truncated, expandable)
- Retries Remaining
- Last Failure Time
- Actions

**Actions (per row):**

- Retry (button) - Opens retry dialog
- View Stack Trace (button) - Opens modal with full stack trace
- Go to Instance (link)

**Retry Dialog:**

- Input field: Number of retries (default: 3)
- Confirm button
- Calls `POST /v1/jobs/{jobId}/retries`

**Stack Trace Modal:**

- Full-screen modal with monospace font
- Copy to clipboard button
- Calls `GET /v1/jobs/{jobId}/stacktrace`

**Auto-refresh:** Every 30 seconds

**Data Source:** `GET /v1/jobs?withException=true&active=true`

---

### 4. Data Surgery (Variable Editor)

**Route:** Modal dialog from instance detail page

**Purpose:** Modify process variables to unblock stuck instances

##### Features

**Variable List:**

- Table showing all current variables
- Columns: Name, Type, Current Value, New Value (editable)

**Supported Types:**

- String (text input)
- Integer (number input)
- Long (number input)
- Double (number input with decimals)
- Float (number input with decimals)
- Boolean (checkbox/toggle)

**Workflow:**

1. User clicks "Edit Variables" on instance detail page
2. Modal opens with current variable values
3. User modifies values in "New Value" column
4. User clicks "Save Changes"
5. Confirmation dialog: "Are you sure? This will modify the process state."
6. On confirm, calls `PATCH /v1/process-instances/{instanceId}/variables`
7. Success message and modal closes
8. Instance detail page refreshes

**Validation:**

- Type checking (ensure integers are integers, etc.)
- Required fields
- Confirmation before saving

**Data Sources:**

- `GET /v1/process-instances/{instanceId}/variables`
- `PATCH /v1/process-instances/{instanceId}/variables`

---

### 5. Process Control Actions

#### 5.1 Suspend/Resume Process

**Trigger:** Button on instance detail page or instances list

**Workflow:**

1. User clicks "Suspend" or "Resume" button
2. Confirmation dialog
3. Calls `PUT /v1/process-instances/{id}/suspension`
4. Success message
5. UI updates to reflect new state

**Visual Feedback:**

- Suspended instances show yellow badge
- "Resume" button replaces "Suspend" button when suspended

#### 5.2 Cancel Process

**Trigger:** Button on instance detail page or instances list

**Workflow:**

1. User clicks "Cancel Process" button
2. Dialog opens with reason input field (optional)
3. User enters cancellation reason
4. User clicks "Confirm Cancel"
5. Calls `DELETE /v1/process-instances/{id}` with reason in body
6. Success message
7. Redirect to instances list or update status to CANCELLED

**Confirmation:**

- "Are you sure you want to cancel this process? This action cannot be undone."
- Reason field (optional): "Reason for cancellation"

---

### 6. BPMN Visualization

**Route:** `/instances/{id}/diagram` or tab within instance detail

**Purpose:** Visual representation of process flow with active token highlighting

##### Features

**BPMN Rendering:**

- Use library like `bpmn-js` or `react-bpmn` to render BPMN XML
- Fetch BPMN XML from process definition
- Overlay active tokens on diagram

**Active Token Highlighting:**

- Fetch active activity instances: `GET /v1/process-instances/{id}/activity-instances`
- Highlight active activities in yellow/orange
- Show activity name tooltip on hover

**Optional Enhancements:**

- Show completed activities in green
- Show failed activities in red
- Click on activity to see details (variables, timestamps)

**Data Sources:**

- `GET /v1/processes/{processDefinitionId}` (for BPMN XML)
- `GET /v1/process-instances/{id}/activity-instances` (for active tokens)

---

### 7. System Metrics & Observability

**Route:** `/metrics`

**Purpose:** System health and performance monitoring

##### Features

**Metrics Dashboards:**

- Embed Grafana dashboards (iframe)
- Link to Jaeger traces
- Link to Prometheus metrics

**Key Metrics to Display:**

- Process instance creation rate
- Process completion rate
- Process failure rate
- Average process duration
- Task completion rate
- Task waiting time (p95, p99)
- Job failure rate

**Integration:**

- Grafana: `http://localhost:3000` (configurable)
- Jaeger: `http://localhost:16686` (configurable)
- Prometheus: `http://localhost:9090` (configurable)

---

## User Interface Design

### Navigation Structure

#### Top Navigation Bar

```
[Orun Logo] | Dashboard | Instances | Jobs | Metrics | [User Menu]
```

**User Menu (dropdown):**

- Profile
- Settings
- Documentation
- Logout

#### Breadcrumbs

```
Home > Instances > recipe-cook-instance-123
```

### Layout

**Desktop-First Design:**

- Minimum width: 1280px
- Responsive down to 1024px (tablet landscape)
- Fixed top navigation
- Sidebar for filters (on list pages)
- Main content area

**Color Scheme (Dark Theme Only):**

Orun uses an **exclusive dark theme** with Navy Blue as the foundation, creating a professional operations center aesthetic.

**Background Colors:**

- Primary Background: Deep Navy (#0f172a) - main app background
- Secondary Background: Dark Navy (#1e293b) - cards, panels, modals
- Elevated Background: Slate (#334155) - hover states, active elements

**Accent Colors:**

- Primary Accent: Navy Blue (#3b82f6) - buttons, links, highlights
- Secondary Accent: Golden Yellow (#fbbf24) - important alerts, accents
- Success: Emerald (#10b981) - completed processes, success states
- Warning: Amber (#f59e0b) - suspended processes, warnings
- Error: Red (#ef4444) - failed jobs, errors
- Info: Sky Blue (#0ea5e9) - informational messages

**Text Colors:**

- Primary Text: Slate 100 (#f1f5f9) - main content
- Secondary Text: Slate 400 (#94a3b8) - labels, metadata
- Muted Text: Slate 500 (#64748b) - timestamps, secondary info

**Border Colors:**

- Default Border: Slate 700 (#334155)
- Hover Border: Slate 600 (#475569)
- Focus Border: Blue 500 (#3b82f6)

**Dark Theme Design Principles:**

1. **High Contrast** - Ensure text readability with minimum 4.5:1 contrast ratio
2. **Subtle Depth** - Use subtle shadows and borders to create visual hierarchy
3. **Blue-tinted Grays** - All grays have a slight blue tint to match Navy theme
4. **Glowing Accents** - Use subtle glows on interactive elements (buttons, cards)
5. **Reduced Brightness** - Avoid pure white (#ffffff), use Slate 100 (#f1f5f9) instead

**Visual Effects:**

- Card shadows: `shadow-xl shadow-navy-900/50`
- Button glows: `ring-2 ring-blue-500/20`
- Hover states: Lighten background by one shade
- Active states: Add blue glow effect

**Status Indicators:**

- Use colored badges with dark backgrounds
- RUNNING: Blue badge on dark navy background
- COMPLETED: Green badge on dark emerald background
- FAILED: Red badge on dark red background
- SUSPENDED: Amber badge on dark amber background

**Typography:**

- Headers: Inter or Roboto (bold)
- Body: Inter or Roboto (regular)
- Code/Monospace: JetBrains Mono or Fira Code

---

## Navigation Flow

### Primary User Journeys

#### Journey 1: Monitor Running Processes

```
Dashboard → View "Active Processes" count → Click "View All" → Instances List → Filter by RUNNING → Click instance → Instance Detail → View BPMN Diagram
```

#### Journey 2: Recover Failed Job

```
Dashboard → See "Failed Jobs" alert → Click "View All Failed Jobs" → Jobs List → Click "View Stack Trace" → Analyze error → Click "Retry" → Set retry count → Confirm → Job retries
```

#### Journey 3: Unblock Stuck Process

```
Instances List → Filter by RUNNING → Find stuck instance → Click instance → Instance Detail → Click "Edit Variables" → Data Surgery Modal → Modify variable → Save → Process continues
```

#### Journey 4: Cancel Duplicate Process

```
Instances List → Search by process name → Identify duplicate → Click "Cancel" → Enter reason → Confirm → Process cancelled
```

#### Journey 5: Investigate Process History

```
Instances List → Click instance → Instance Detail → History Tab → Review timeline → Click BPMN Diagram Tab → See completed path
```

---

## Technical Implementation

### Technology Stack

**Frontend:**

- Next.js 14+ (App Router)
- React 18+
- TypeScript
- TailwindCSS (styling with custom dark theme)
- shadcn/ui (component library with dark mode variants)
- bpmn-js (BPMN rendering with dark theme)
- Recharts or Chart.js (metrics charts with dark color schemes)

**Dark Theme Configuration (tailwind.config.js):**

```javascript
{
  darkMode: 'class', // Always enabled
  theme: {
    extend: {
      colors: {
        navy: {
          900: '#0f172a', // Primary background
          800: '#1e293b', // Secondary background
          700: '#334155', // Elevated elements
        }
      }
    }
  }
}
```

**Component Styling:**

- All components use `dark:` variants
- Base HTML has `class="dark"` applied by default
- No light mode toggle (dark mode only)

**State Management:**

- React Query (data fetching, caching)
- Zustand or Context API (global state)

**API Integration:**

- Axios or Fetch API
- Base URL: `/v1` (configurable)
- Authentication: JWT tokens in headers

### Key Components

```
/app/
├── (dashboard)/
│   └── page.tsx                    # Dashboard
├── instances/
│   ├── page.tsx                    # Instances list
│   └── [id]/
│       ├── page.tsx                # Instance detail
│       └── diagram/
│           └── page.tsx            # BPMN diagram (optional separate page)
├── jobs/
│   └── page.tsx                    # Failed jobs list
├── metrics/
│   └── page.tsx                    # Metrics dashboards
└── layout.tsx                      # Root layout with navigation

/components/
├── ui/                             # shadcn/ui components
├── dashboard/
│   ├── system-health-panel.tsx
│   ├── recent-activity-feed.tsx
│   └── failed-jobs-alert.tsx
├── instances/
│   ├── instance-table.tsx
│   ├── instance-filters.tsx
│   ├── instance-detail-header.tsx
│   ├── instance-tabs.tsx
│   └── bpmn-viewer.tsx
├── jobs/
│   ├── job-table.tsx
│   ├── retry-dialog.tsx
│   └── stack-trace-modal.tsx
├── data-surgery/
│   └── variable-editor-modal.tsx
└── layout/
    ├── top-nav.tsx
    └── breadcrumbs.tsx

/lib/
├── api.ts                          # API client
├── types.ts                        # TypeScript types
└── utils.ts                        # Utility functions
```

---

## API Endpoints Reference

### Process Management

- `GET /v1/processes` - List process definitions
- `GET /v1/processes/{id}` - Get process definition (includes BPMN XML)
- `GET /v1/processes/instances` - List all process instances
- `GET /v1/processes/instances/{id}` - Get process instance details

### Operations Cockpit

- `GET /v1/jobs` - List failed jobs
- `POST /v1/jobs/{jobId}/retries` - Retry failed job
- `GET /v1/jobs/{jobId}/stacktrace` - Get job stack trace
- `GET /v1/process-instances/{id}/variables` - Get process variables
- `PATCH /v1/process-instances/{id}/variables` - Modify process variables
- `DELETE /v1/process-instances/{id}` - Cancel process instance
- `PUT /v1/process-instances/{id}/suspension` - Suspend/resume process
- `GET /v1/process-instances/{id}/activity-instances` - Get active tokens for BPMN visualization

---

## Future Enhancements

### Phase 2 Features

- **Process Analytics** - Historical trends, completion rates, bottleneck analysis
- **Alerts & Notifications** - Email/Slack alerts for failed jobs or stuck processes
- **Bulk Operations** - Cancel/suspend multiple instances at once
- **Process Comparison** - Compare two instances side-by-side
- **Variable History** - Track variable changes over time
- **User Activity Log** - Audit trail of all operator actions

### Phase 3 Features

- **AI-Powered Insights** - Anomaly detection, predictive failure analysis
- **Custom Dashboards** - User-configurable widgets and metrics
- **Mobile App** - iOS/Android app for on-the-go monitoring
- **Integration Hub** - Connect to external monitoring tools (PagerDuty, Datadog)

---

## Success Metrics

### Key Performance Indicators (KPIs)

1. **Mean Time to Recovery (MTTR)** - Average time from job failure to successful retry
2. **Process Completion Rate** - Percentage of processes that complete successfully
3. **Operator Intervention Rate** - Percentage of processes requiring manual intervention
4. **Failed Job Resolution Time** - Time from failure to resolution
5. **Data Surgery Frequency** - Number of variable modifications per day/week

### User Experience Metrics

1. **Page Load Time** - < 2 seconds for all pages
2. **Time to First Interaction** - < 1 second
3. **Auto-refresh Latency** - < 500ms for real-time updates
4. **User Satisfaction Score** - Target: 4.5/5

---

## Conclusion

Orun provides operations teams with the visibility and control they need to manage business process automation at scale. By combining real-time monitoring, proactive alerting, and powerful intervention tools, Orun ensures that processes run smoothly and issues are resolved quickly.

The interface is designed to be intuitive for operators while providing the depth of information needed for troubleshooting complex process failures. With its focus on actionable insights and efficient workflows, Orun is the command center for modern business process operations.
