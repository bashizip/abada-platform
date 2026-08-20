import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "@/router";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Star, CheckCircle, XCircle, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { apiClient, TaskDetailsDto, TaskStatus, ProjectResourceContentDTO } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, getTaskStatusColors } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiErrorToast } from "@/components/ApiErrorToast";
import {
  TaskVariableEditor,
  TaskVariableRow,
  TaskVariableType,
} from "@/components/TaskVariableEditor";
import { FormViewer } from "@/components/FormViewer";

const VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function inferVariableType(value: unknown): TaskVariableType {
  if (typeof value === "boolean") return "Boolean";
  if (typeof value === "number")
    return Number.isInteger(value) ? "Integer" : "Double";
  if (typeof value === "object" && value !== null) return "Json";
  return "String";
}

function objectToRows(variables: Record<string, unknown>): TaskVariableRow[] {
  return Object.entries(variables).map(([name, value]) => {
    const type = inferVariableType(value);
    const rawValue =
      type === "Json"
        ? JSON.stringify(value)
        : type === "Boolean"
          ? String(Boolean(value))
          : String(value ?? "");

    return {
      id: crypto.randomUUID(),
      name,
      type,
      value: rawValue,
    };
  });
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetailsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [isClaimConfirmOpen, setIsClaimConfirmOpen] = useState(false);
  const [isCompleteConfirmOpen, setIsCompleteConfirmOpen] = useState(false);
  const [isFailConfirmOpen, setIsFailConfirmOpen] = useState(false);
  const [completionVariables, setCompletionVariables] = useState<
    Record<string, unknown>
  >({});
  const [editorMode, setEditorMode] = useState<"form" | "json">("form");
  const [variableRows, setVariableRows] = useState<TaskVariableRow[]>([]);
  const [variableErrors, setVariableErrors] = useState<Record<string, string>>(
    {},
  );
  const [jsonDraft, setJsonDraft] = useState("{}");
  const [jsonRequiresValidation, setJsonRequiresValidation] = useState(false);
  const [jsonEditorError, setJsonEditorError] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProjectResourceContentDTO | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [formList, setFormList] = useState<ProjectResourceContentDTO[]>([]);
  const [formListLoading, setFormListLoading] = useState(false);
  const { toast } = useToast();

  const buildVariablesFromRows = (rows: TaskVariableRow[]) => {
    const nextErrors: Record<string, string> = {};
    const variables: Record<string, unknown> = {};
    const seen = new Set<string>();

    for (const row of rows) {
      const trimmedName = row.name.trim();
      if (!trimmedName) {
        nextErrors[row.id] = "Name is required";
        continue;
      }

      if (!VARIABLE_NAME_PATTERN.test(trimmedName)) {
        nextErrors[row.id] =
          "Use letters, numbers, underscore. Start with letter/underscore.";
        continue;
      }

      if (seen.has(trimmedName)) {
        nextErrors[row.id] = "Duplicate variable name";
        continue;
      }

      seen.add(trimmedName);

      try {
        if (row.type === "Boolean") {
          variables[trimmedName] = row.value === "true";
        } else if (row.type === "Integer" || row.type === "Long") {
          const parsed = Number.parseInt(row.value, 10);
          if (Number.isNaN(parsed)) {
            throw new Error("must be an integer");
          }
          variables[trimmedName] = parsed;
        } else if (row.type === "Double" || row.type === "Float") {
          const parsed = Number.parseFloat(row.value);
          if (Number.isNaN(parsed)) {
            throw new Error("must be a number");
          }
          variables[trimmedName] = parsed;
        } else if (row.type === "Json") {
          variables[trimmedName] = JSON.parse(row.value || "null");
        } else {
          variables[trimmedName] = row.value;
        }
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "invalid value";
        nextErrors[row.id] = `Value ${description}`;
      }
    }

    return {
      variables,
      errors: nextErrors,
      isValid: Object.keys(nextErrors).length === 0,
    };
  };

  const fetchForm = useCallback(
    async (projectId: string, resourceId: string) => {
      setFormLoading(true);
      const response = await apiClient.getResource(projectId, resourceId);
      setFormLoading(false);
      if (response.data) {
        setFormData(response.data);
      }
    },
    [],
  );

  const fetchTask = useCallback(
    async (taskId: string) => {
      setLoading(true);
      const response = await apiClient.getTask(taskId);
      setLoading(false);
      if (response.data) {
        setTask(response.data);
        // Fetch form if task has a formKey and projectId
        if (response.data.formKey && response.data.projectId) {
          fetchForm(response.data.projectId, response.data.formKey);
          // Fetch form list
          setFormListLoading(true);
          apiClient.listForms(response.data.projectId).then((resp) => {
            setFormListLoading(false);
            if (resp.data) {
              setFormList(resp.data);
            }
          }).catch(() => {
            setFormListLoading(false);
          });
        }
      } else {
        toast(
          ApiErrorToast({
            error: response.error,
            defaultMessage: "Failed to fetch task details",
          }),
        );
      }
    },
    [toast, fetchForm, apiClient, setFormList],
  );

  useEffect(() => {
    if (id) {
      fetchTask(id);
    }
  }, [id, fetchTask]);

  const handleClaim = async () => {
    if (!task) return;

    setActionLoading(true);
    const response = await apiClient.claimTask(task.id);
    setActionLoading(false);
    setIsClaimConfirmOpen(false);

    if (response.data?.status === "Claimed") {
      toast({
        title: "Task claimed",
        description: "You have successfully claimed this task",
      });
      fetchTask(task.id);
    } else {
      toast(
        ApiErrorToast({
          error: response.error,
          defaultMessage: "Failed to claim task",
        }),
      );
    }
  };

  const handleComplete = async () => {
    if (!task) return;

    let variablesToSubmit: Record<string, unknown> | undefined;

    if (editorMode === "form") {
      const result = buildVariablesFromRows(variableRows);
      setVariableErrors(result.errors);
      if (!result.isValid) {
        toast({
          variant: "destructive",
          title: "Invalid variable input",
          description: "Fix highlighted rows before completing this task.",
        });
        return;
      }
      variablesToSubmit =
        Object.keys(result.variables).length > 0 ? result.variables : undefined;
    } else {
      if (jsonRequiresValidation || jsonEditorError) {
        toast({
          variant: "destructive",
          title: "Validate JSON first",
          description:
            "Click Validate JSON after your latest edits before submitting.",
        });
        return;
      }
      variablesToSubmit =
        Object.keys(completionVariables).length > 0
          ? completionVariables
          : undefined;
    }

    setActionLoading(true);
    const response = await apiClient.completeTask(task.id, variablesToSubmit);
    setActionLoading(false);
    setIsCompleteConfirmOpen(false);

    if (response.data?.status === "Completed") {
      toast({
        title: "Task completed",
        description: "Task has been marked as completed",
      });
      navigate("/tasks");
    } else {
      toast(
        ApiErrorToast({
          error: response.error,
          defaultMessage: "Failed to complete task",
        }),
      );
    }
  };

  const handleFail = async () => {
    if (!task) return;

    setActionLoading(true);
    const response = await apiClient.failTask(task.id);
    setActionLoading(false);
    setIsFailConfirmOpen(false);

    if (response.data?.status === "Failed") {
      toast({
        title: "Task failed",
        description: "Task has been marked as failed",
      });
      fetchTask(task.id);
    } else {
      toast(
        ApiErrorToast({
          error: response.error,
          defaultMessage: "Failed to fail task",
        }),
      );
    }
  };

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

  const handleEditorModeChange = (nextMode: "form" | "json") => {
    if (nextMode === editorMode) return;

    if (nextMode === "json") {
      const result = buildVariablesFromRows(variableRows);
      setVariableErrors(result.errors);
      if (!result.isValid) {
        toast({
          variant: "destructive",
          title: "Cannot switch to JSON",
          description: "Fix invalid rows first so values can be converted.",
        });
        return;
      }
      setCompletionVariables(result.variables);
      setJsonDraft(JSON.stringify(result.variables, null, 2));
      setJsonRequiresValidation(false);
      setJsonEditorError(null);
    } else {
      setVariableRows(objectToRows(completionVariables));
      setVariableErrors({});
    }

    setEditorMode(nextMode);
  };

  if (loading) {
    return (
      <Layout>
        <div className="container mx-auto px-6 py-8">
          <div className="text-center">
            <p className="text-muted-foreground">Loading task details...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!task) {
    return (
      <Layout>
        <div className="container mx-auto px-6 py-8">
          <div className="text-center">
            <p className="text-muted-foreground">Task not found</p>
            <Button onClick={() => navigate("/tasks")} className="mt-4">
              Back to Tasks
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  const handleValidateJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      if (
        parsed === null ||
        Array.isArray(parsed) ||
        typeof parsed !== "object"
      ) {
        setJsonEditorError("JSON must be an object (key-value map).");
        setJsonRequiresValidation(true);
        return;
      }
      setCompletionVariables(parsed as Record<string, unknown>);
      setJsonEditorError(null);
      setJsonRequiresValidation(false);
    } catch (error) {
      setJsonEditorError(
        error instanceof Error ? error.message : "Invalid JSON syntax",
      );
      setJsonRequiresValidation(true);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate("/tasks")}
            className="mb-4"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tasks
          </Button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Task Details
              </h1>
              <p className="text-muted-foreground mt-1">
                View and manage the details of the selected task.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {/* Task Information */}
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Task Information
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Task ID</p>
                <p className="font-medium text-foreground">#{task.id}</p>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Task Name</p>
                <p className="font-medium text-foreground">{task.name}</p>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Assignee</p>
                <p className="font-medium text-foreground">
                  {task.assignee || "Unassigned"}
                </p>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Status</p>
                <Badge className={getTaskStatusColors(task.status)}>
                  {getStatusLabel(task.status)}
                </Badge>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Start Date</p>
                <p className="font-medium text-foreground">
                  {formatDistanceToNow(task.startDate)}
                </p>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">End Date</p>
                <p className="font-medium text-foreground">
                  {formatDistanceToNow(task.endDate)}
                </p>
              </div>
            </div>
          </div>

          {/* Process Information */}
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Process Information
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">
                  Process Definition
                </p>
                <p className="font-medium text-foreground">
                  {task.processDefinitionName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {task.processDefinitionId}
                </p>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">
                  Process Instance
                </p>
                <p
                  className="font-medium text-foreground truncate"
                  title={task.processInstanceId}
                >
                  #{task.processInstanceId.slice(0, 8)}
                </p>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">
                  Process Status
                </p>
                <Badge
                  variant={
                    task.processStatus === "RUNNING" ? "default" : "secondary"
                  }
                >
                  {task.processStatus}
                </Badge>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">
                  Process Started
                </p>
                <p className="font-medium text-foreground">
                  {task.processStartDate
                    ? formatDistanceToNow(task.processStartDate)
                    : "-"}
                </p>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">
                  Process Ended
                </p>
                <p className="font-medium text-foreground">
                  {task.processEndDate
                    ? formatDistanceToNow(task.processEndDate)
                    : "Running"}
                </p>
              </div>

              <div className="bg-muted p-4 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">
                  Current Activity
                </p>
                <p className="font-medium text-foreground">
                  {task.currentActivityId || "-"}
                </p>
              </div>

              {task.processSuspended && (
                <div className="bg-muted p-4 rounded-lg border-2 border-destructive">
                  <p className="text-sm text-destructive font-semibold mb-1">
                    ⚠️ Process Suspended
                  </p>
                  <p className="text-xs text-muted-foreground">
                    This process is currently suspended
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Variables */}
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Variables
            </h2>
            <div className="bg-slate-800 p-4 rounded-lg">
              <pre className="text-sm font-mono text-white overflow-x-auto">
                <code className="text-white">
                  {JSON.stringify(task.variables || {}, null, 2)}
                </code>
              </pre>
            </div>
          </div>

          {/* Form */}
          {task.formKey && (
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-4">
                Form
              </h2>
              {formListLoading ? (
                <div className="bg-muted p-4 rounded-lg text-center">
                  <p className="text-muted-foreground">Loading forms...</p>
                </div>
              ) : formList.length > 0 ? (
                <div className="bg-slate-800 p-4 rounded-lg">
                  <select
                    onChange={(e) => {
                      const selectedForm = formList.find((f) => f.name === e.target.value);
                      if (selectedForm) {
        fetchForm(selectedForm.projectId, selectedForm.id);
        setFormData(selectedForm);
      }
                    }}
                    className="bg-slate-950/60 border-slate-800 text-slate-200 rounded p-2 cursor-pointer w-full mb-2">
                    <option disabled>Select a form...</option>
                    {formList.map((f) => (
                      <option key={f.id} value={f.name}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="bg-muted p-4 rounded-lg text-center">
                  <p className="text-muted-foreground">
                    Form not found: {task.formKey}
                  </p>
                </div>
              )}
              {formData && !formListLoading && (
                <div className="bg-slate-800 p-4 rounded-lg">
                  <FormViewer formData={formData} />
                </div>
              )}
            </div>
          )}

          {/* Actions */}

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4">
            <Button
              variant="outline"
              onClick={() => setIsClaimConfirmOpen(true)}
              disabled={actionLoading || task.status !== "AVAILABLE"}
              className="bg-blue-500 text-white border-blue-500 hover:bg-blue-600 hover:border-blue-600"
            >
              <Star className="mr-2 h-4 w-4" />
              Claim
            </Button>

            <Button
              onClick={() => {
                setCompletionVariables({});
                setVariableRows([]);
                setVariableErrors({});
                setJsonDraft("{}");
                setJsonRequiresValidation(false);
                setJsonEditorError(null);
                setEditorMode("form");
                setIsCompleteConfirmOpen(true);
              }}
              disabled={actionLoading || task.status !== "CLAIMED"}
              className="bg-green-500 text-white hover:bg-green-600"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Complete
            </Button>

            <Button
              variant="destructive"
              onClick={() => setIsFailConfirmOpen(true)}
              disabled={
                actionLoading ||
                task.status === "COMPLETED" ||
                task.status === "FAILED"
              }
            >
              <XCircle className="mr-2 h-4 w-4" />
              Fail
            </Button>
          </div>
        </div>
      </div>
      <Dialog open={isClaimConfirmOpen} onOpenChange={setIsClaimConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              This will claim the task for the current user.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleClaim} disabled={actionLoading}>
              {actionLoading ? "Claiming..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={isCompleteConfirmOpen}
        onOpenChange={(open) => {
          setIsCompleteConfirmOpen(open);
          if (!open) {
            setVariableErrors({});
            setJsonRequiresValidation(false);
            setJsonEditorError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>Complete Task</DialogTitle>
            <DialogDescription>
              Enter variables using form inputs or raw JSON before completing.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Tabs
              value={editorMode}
              onValueChange={(value) =>
                handleEditorModeChange(value as "form" | "json")
              }
            >
              <TabsList className="mb-4">
                <TabsTrigger value="form">Form Editor</TabsTrigger>
                <TabsTrigger value="json">JSON Editor</TabsTrigger>
              </TabsList>
              <TabsContent value="form">
                <TaskVariableEditor
                  rows={variableRows}
                  onChange={setVariableRows}
                  errors={variableErrors}
                />
              </TabsContent>
              <TabsContent value="json">
                <Textarea
                  value={jsonDraft}
                  onChange={(event) => {
                    setJsonDraft(event.target.value);
                    setJsonRequiresValidation(true);
                    setJsonEditorError(null);
                  }}
                  className="min-h-[260px] font-mono"
                  placeholder='{"approved": true, "amount": 1200}'
                />
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleValidateJson}
                  >
                    Validate JSON
                  </Button>
                  {jsonRequiresValidation && !jsonEditorError && (
                    <p className="text-xs text-muted-foreground">
                      JSON changed. Validate before submitting.
                    </p>
                  )}
                </div>
                {jsonEditorError && (
                  <p className="mt-2 text-sm text-destructive">
                    JSON error: {jsonEditorError}
                  </p>
                )}
                {!jsonRequiresValidation && !jsonEditorError && (
                  <p className="mt-2 text-sm text-green-600 dark:text-green-400">
                    JSON is valid and ready to submit.
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleComplete} disabled={actionLoading}>
              {actionLoading ? "Completing..." : "Confirm & Complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isFailConfirmOpen} onOpenChange={setIsFailConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              This will mark the task as failed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleFail}
              disabled={actionLoading}
              variant="destructive"
            >
              {actionLoading ? "Failing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
