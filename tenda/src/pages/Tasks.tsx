import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@/router";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BpmnViewer } from "@/components/BpmnViewer";
import { Eye, GitBranch, RefreshCw, Search } from "lucide-react";
import {
  ActivityInstanceDto,
  apiClient,
  ProcessDefinition,
  ProcessInstanceDetailsDto,
  TaskDetailsDto,
  TaskStatus,
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, getTaskStatusColors } from "@/lib/utils";
import { ApiErrorToast } from "@/components/ApiErrorToast";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getProcessStatusColors(
  status: ProcessInstanceDetailsDto["status"] | TaskDetailsDto["processStatus"],
): string {
  switch (status) {
    case "RUNNING":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
    case "COMPLETED":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
    case "SUSPENDED":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
    case "FAILED":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
    case "CANCELLED":
      return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export default function Tasks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<TaskDetailsDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");

  const [isProcessSheetOpen, setIsProcessSheetOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskDetailsDto | null>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processInstance, setProcessInstance] =
    useState<ProcessInstanceDetailsDto | null>(null);
  const [processDefinition, setProcessDefinition] =
    useState<ProcessDefinition | null>(null);
  const [activityInstances, setActivityInstances] = useState<
    ActivityInstanceDto[]
  >([]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    const response = await apiClient.getTasks({
      status: statusFilter === "all" ? undefined : statusFilter,
    });
    if (response.data) {
      setTasks(response.data);
    } else {
      toast(
        ApiErrorToast({
          error: response.error,
          defaultMessage: "Failed to fetch tasks",
        }),
      );
    }
    setLoading(false);
  }, [statusFilter, toast]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const getStatusLabel = (status: TaskStatus) => {
    switch (status) {
      case "COMPLETED":
        return "Completed";
      case "CLAIMED":
        return "Claimed";
      case "AVAILABLE":
        return "Available";
      case "FAILED":
        return "Failed";
      default:
        return status;
    }
  };

  const getTaskStatusSinceLabel = (task: TaskDetailsDto) => {
    const sinceText = (() => {
      if (task.status === "COMPLETED" || task.status === "FAILED") {
        return formatDistanceToNow(task.endDate || task.startDate);
      }
      return formatDistanceToNow(task.startDate);
    })();

    switch (task.status) {
      case "AVAILABLE":
        return `Available since ${sinceText}`;
      case "CLAIMED":
        return `Claimed since ${sinceText}`;
      case "COMPLETED":
        return `Completed since ${sinceText}`;
      case "FAILED":
        return `Failed since ${sinceText}`;
      default:
        return sinceText;
    }
  };

  const formatAssignee = useCallback(
    (assignee?: string) => {
      if (!assignee) {
        return "Unassigned";
      }
      if (user && (assignee === user.id || assignee === user.username)) {
        return user.username;
      }
      if (UUID_PATTERN.test(assignee)) {
        return `User ${assignee.slice(0, 8)}`;
      }
      return assignee;
    },
    [user],
  );

  const filteredTasks = tasks.filter((task) => {
    const normalizedSearch = searchTerm.toLowerCase();
    return (
      task.name.toLowerCase().includes(normalizedSearch) ||
      formatAssignee(task.assignee).toLowerCase().includes(normalizedSearch) ||
      task.processDefinitionName?.toLowerCase().includes(normalizedSearch)
    );
  });

  const statusCounts = useMemo(
    () =>
      tasks.reduce(
        (summary, task) => {
          summary[task.status] += 1;
          return summary;
        },
        {
          AVAILABLE: 0,
          CLAIMED: 0,
          COMPLETED: 0,
          FAILED: 0,
        },
      ),
    [tasks],
  );

  const loadProcessContext = useCallback(
    async (task: TaskDetailsDto, withLoading = true) => {
      if (withLoading) {
        setProcessLoading(true);
      }

      const [instanceRes, definitionRes, activitiesRes] = await Promise.all([
        apiClient.getProcessInstance(task.processInstanceId),
        apiClient.getProcessDefinition(task.processDefinitionId),
        apiClient.getActivityInstances(task.processInstanceId),
      ]);

      if (instanceRes.data) {
        setProcessInstance(instanceRes.data);
      } else {
        setProcessInstance({
          id: task.processInstanceId,
          processDefinitionId: task.processDefinitionId,
          processDefinitionName: task.processDefinitionName,
          currentActivityId: task.currentActivityId,
          status: task.processStatus,
          suspended: task.processSuspended,
          startDate: task.processStartDate ?? task.startDate ?? "",
          endDate: task.processEndDate,
          startedBy: task.assignee ?? "unknown",
          variables: task.variables ?? {},
        });
      }

      if (definitionRes.data) {
        setProcessDefinition(definitionRes.data);
      } else {
        setProcessDefinition({
          id: task.processDefinitionId,
          name: task.processDefinitionName,
        });
      }

      setActivityInstances(activitiesRes.data?.childActivityInstances ?? []);
      setProcessLoading(false);

      const failure =
        instanceRes.error || definitionRes.error || activitiesRes.error;
      if (failure && withLoading) {
        toast(
          ApiErrorToast({
            error: failure,
            defaultMessage:
              "Some live process details could not be loaded. Showing available data.",
          }),
        );
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!isProcessSheetOpen || !selectedTask) {
      return;
    }
    const intervalId = window.setInterval(() => {
      loadProcessContext(selectedTask, false);
    }, 15000);
    return () => window.clearInterval(intervalId);
  }, [isProcessSheetOpen, selectedTask, loadProcessContext]);

  const openProcessSheet = async (task: TaskDetailsDto) => {
    setSelectedTask(task);
    setIsProcessSheetOpen(true);
    await loadProcessContext(task, true);
  };

  return (
    <Layout>
      <div className="container mx-auto px-6 py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">My Tasks</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage and track assigned work across your running processes.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={fetchTasks}
            disabled={loading}
            className="w-full sm:w-auto"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="border-border/80 bg-card/60">
            <CardContent className="py-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Total
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {tasks.length}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/60">
            <CardContent className="py-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Available
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {statusCounts.AVAILABLE}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/60">
            <CardContent className="py-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Claimed
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {statusCounts.CLAIMED}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/60">
            <CardContent className="py-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Completed
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {statusCounts.COMPLETED}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/80 bg-card/60">
            <CardContent className="py-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Failed
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">
                {statusCounts.FAILED}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-6 border-border/80 bg-card/80 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder="Search tasks..."
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="pl-10 text-sm placeholder:text-muted-foreground"
                  />
                </div>
              </div>
              <div className="w-full md:w-48">
                <Select
                  value={statusFilter}
                  onValueChange={(value) =>
                    setStatusFilter(value as TaskStatus | "all")
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Status: All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Status: All</SelectItem>
                    <SelectItem value="AVAILABLE">Available</SelectItem>
                    <SelectItem value="CLAIMED">Claimed</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="FAILED">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {filteredTasks.length} task
              {filteredTasks.length === 1 ? "" : "s"}
              {searchTerm ? ` matching "${searchTerm}"` : ""}.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-sm">
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-semibold tracking-wide">
                    TASK
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide">
                    PROCESS
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide">
                    ASSIGNEE
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide">
                    CANDIDATE GROUPS
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide">
                    STATUS SINCE
                  </TableHead>
                  <TableHead className="text-xs font-semibold tracking-wide">
                    STATUS
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold tracking-wide">
                    ACTIONS
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Loading tasks...
                    </TableCell>
                  </TableRow>
                ) : filteredTasks.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-10 text-center text-muted-foreground"
                    >
                      No tasks found with current filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTasks.map((task) => (
                    <TableRow key={task.id} className="group">
                      <TableCell>
                        <span className="font-semibold text-foreground">
                          {task.name}
                        </span>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {task.taskDefinitionKey}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className="text-left font-medium text-foreground">
                          {task.processDefinitionName}
                        </span>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">
                          {task.processDefinitionId}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatAssignee(task.assignee)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {task.candidateGroups?.join(", ") || "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {getTaskStatusSinceLabel(task)}
                      </TableCell>
                      <TableCell>
                        <Badge className={getTaskStatusColors(task.status)}>
                          {getStatusLabel(task.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => navigate(`/tasks/${task.id}`)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="View task details"
                            aria-label="View task details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void openProcessSheet(task)}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Open live process view"
                            aria-label="Open live process view"
                          >
                            <GitBranch className="h-4 w-4" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Sheet open={isProcessSheetOpen} onOpenChange={setIsProcessSheetOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-4xl">
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border px-6 py-4 text-left">
              <SheetTitle>
                {selectedTask?.processDefinitionName || "Process Details"}
              </SheetTitle>
              <SheetDescription>
                Live process instance view with diagram highlighting and runtime
                data.
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    selectedTask
                      ? void loadProcessContext(selectedTask, true)
                      : undefined
                  }
                  disabled={!selectedTask || processLoading}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
              </div>

              {processLoading ? (
                <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">
                  Loading process details...
                </div>
              ) : (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Process Runtime
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Instance ID
                        </p>
                        <p className="font-mono text-sm text-foreground">
                          {processInstance?.id ||
                            selectedTask?.processInstanceId ||
                            "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Status</p>
                        <Badge
                          className={getProcessStatusColors(
                            processInstance?.status ||
                              selectedTask?.processStatus ||
                              "RUNNING",
                          )}
                        >
                          {processInstance?.status ||
                            selectedTask?.processStatus ||
                            "-"}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Current Activity
                        </p>
                        <p className="font-mono text-sm text-foreground">
                          {processInstance?.currentActivityId ||
                            selectedTask?.currentActivityId ||
                            "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Started By
                        </p>
                        <p className="text-sm text-foreground">
                          {processInstance?.startedBy || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Started</p>
                        <p className="text-sm text-foreground">
                          {formatDistanceToNow(
                            processInstance?.startDate ||
                              selectedTask?.processStartDate,
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Ended</p>
                        <p className="text-sm text-foreground">
                          {formatDistanceToNow(
                            processInstance?.endDate ||
                              selectedTask?.processEndDate,
                          )}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Task Context</CardTitle>
                      <CardDescription>
                        Current selected task inside this process instance.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Task ID</p>
                        <p className="font-mono text-sm text-foreground">
                          {selectedTask?.id || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Task Name
                        </p>
                        <p className="text-sm text-foreground">
                          {selectedTask?.name || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Assignee
                        </p>
                        <p className="text-sm text-foreground">
                          {formatAssignee(selectedTask?.assignee)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Task Status
                        </p>
                        <Badge
                          className={getTaskStatusColors(
                            selectedTask?.status || "AVAILABLE",
                          )}
                        >
                          {selectedTask
                            ? getStatusLabel(selectedTask.status)
                            : "-"}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Live Diagram</CardTitle>
                      <CardDescription>
                        Active BPMN node is highlighted and updates during
                        refresh.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[420px]">
                        {processDefinition?.bpmnXml ? (
                          <BpmnViewer
                            xml={processDefinition.bpmnXml}
                            activeActivityIds={[
                              processInstance?.currentActivityId ||
                                selectedTask?.currentActivityId ||
                                "",
                            ]}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                            BPMN XML is not available for this process
                            definition.
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Process Variables
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs">
                        {JSON.stringify(
                          processInstance?.variables ??
                            selectedTask?.variables ??
                            {},
                          null,
                          2,
                        )}
                      </pre>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Activity Instances
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {activityInstances.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No activity instance data available.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {activityInstances.map((activity) => (
                            <div
                              key={activity.id}
                              className="rounded-lg border border-border/70 p-3"
                            >
                              <p className="font-medium text-foreground">
                                {activity.activityName ||
                                  activity.activityId ||
                                  activity.id}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {activity.activityType || "Unknown type"}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>
                                  Start:{" "}
                                  {formatDistanceToNow(activity.startTime)}
                                </span>
                                <span>
                                  End: {formatDistanceToNow(activity.endTime)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </Layout>
  );
}
