import { useState, useEffect, useCallback } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Eye } from "lucide-react";
import { Link } from "@/router";
import { apiClient, ProcessDefinition } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ApiErrorToast } from "@/components/ApiErrorToast";
import {
  TaskVariableEditor,
  TaskVariableRow,
  TaskVariableType,
} from "@/components/TaskVariableEditor";

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

export default function Processes() {
  const [processes, setProcesses] = useState<ProcessDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProcess, setSelectedProcess] =
    useState<ProcessDefinition | null>(null);
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [editorMode, setEditorMode] = useState<"form" | "json">("form");
  const [variableRows, setVariableRows] = useState<TaskVariableRow[]>([]);
  const [variableErrors, setVariableErrors] = useState<Record<string, string>>(
    {},
  );
  const [jsonDraft, setJsonDraft] = useState("{}");
  const [jsonRequiresValidation, setJsonRequiresValidation] = useState(false);
  const [jsonEditorError, setJsonEditorError] = useState<string | null>(null);
  const [startingProcess, setStartingProcess] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const { toast } = useToast();

  const buildVariablesFromRows = (rows: TaskVariableRow[]) => {
    const nextErrors: Record<string, string> = {};
    const parsedVariables: Record<string, unknown> = {};
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
          parsedVariables[trimmedName] = row.value === "true";
        } else if (row.type === "Integer" || row.type === "Long") {
          const value = Number.parseInt(row.value, 10);
          if (Number.isNaN(value)) throw new Error("must be an integer");
          parsedVariables[trimmedName] = value;
        } else if (row.type === "Double" || row.type === "Float") {
          const value = Number.parseFloat(row.value);
          if (Number.isNaN(value)) throw new Error("must be a number");
          parsedVariables[trimmedName] = value;
        } else if (row.type === "Json") {
          parsedVariables[trimmedName] = JSON.parse(row.value || "null");
        } else {
          parsedVariables[trimmedName] = row.value;
        }
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "invalid value";
        nextErrors[row.id] = `Value ${description}`;
      }
    }

    return {
      variables: parsedVariables,
      errors: nextErrors,
      isValid: Object.keys(nextErrors).length === 0,
    };
  };

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.getProcessDefinitions();
      if (response.data) {
        setProcesses(response.data);
      } else {
        setProcesses([]);
        toast(
          ApiErrorToast({
            error: response.error,
            defaultMessage: "Failed to fetch processes",
          }),
        );
      }
    } catch (error) {
      toast(
        ApiErrorToast({
          error: error,
          defaultMessage: "Failed to fetch processes",
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchProcesses();
  }, [fetchProcesses]);

  const handleStartProcess = async () => {
    if (!selectedProcess) return;

    let variablesToSubmit: Record<string, unknown> | undefined;

    if (editorMode === "form") {
      const result = buildVariablesFromRows(variableRows);
      setVariableErrors(result.errors);
      if (!result.isValid) {
        toast({
          variant: "destructive",
          title: "Invalid variable input",
          description: "Fix highlighted rows before starting this process.",
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
            "Click Validate JSON after your latest edits before starting.",
        });
        return;
      }
      variablesToSubmit =
        Object.keys(variables).length > 0 ? variables : undefined;
    }

    setStartingProcess(true);
    try {
      const response = await apiClient.startProcess(
        selectedProcess.id,
        variablesToSubmit,
      );
      if (response.data) {
        toast({
          title: "Process started",
          description: `Process instance ${response.data.processInstanceId} created successfully`,
        });
        setIsConfirmOpen(false);
        setVariables({});
        setVariableRows([]);
        setVariableErrors({});
        setJsonDraft("{}");
        setJsonRequiresValidation(false);
        setJsonEditorError(null);
      } else {
        toast(
          ApiErrorToast({
            error: response.error,
            defaultMessage: "Failed to start process",
          }),
        );
      }
    } catch (error) {
      toast(
        ApiErrorToast({
          error: error,
          defaultMessage: "Failed to start process",
        }),
      );
    } finally {
      setStartingProcess(false);
    }
  };

  const handleOpenConfirmDialog = (process: ProcessDefinition) => {
    setSelectedProcess(process);
    setIsConfirmOpen(true);
    setVariables({});
    setVariableRows([]);
    setVariableErrors({});
    setEditorMode("form");
    setJsonDraft("{}");
    setJsonRequiresValidation(false);
    setJsonEditorError(null);
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
      setVariables(result.variables);
      setJsonDraft(JSON.stringify(result.variables, null, 2));
      setJsonRequiresValidation(false);
      setJsonEditorError(null);
    } else {
      setVariableRows(objectToRows(variables));
      setVariableErrors({});
    }

    setEditorMode(nextMode);
  };

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
      setVariables(parsed as Record<string, unknown>);
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
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Process List</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Browse and start available processes.
            </p>
          </div>
          <Link to="/processes/upload">
            <Button className="bg-accent hover:bg-accent/90">
              <Upload className="mr-2 h-4 w-4" />
              Deploy Process
            </Button>
          </Link>
        </div>

        {/* Process Grid */}
        {loading ? (
          <div className="text-center p-8">Loading processes...</div>
        ) : processes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {processes.map((process) => (
              <Card
                key={process.id}
                className="hover:shadow-md transition-shadow flex flex-col"
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-semibold">
                      {process.name}
                    </CardTitle>
                  </div>
                  <CardDescription className="text-sm text-muted-foreground pt-2">
                    {process.documentation || "No documentation available."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="mt-auto flex items-center space-x-2 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 border-info text-info hover:bg-info hover:text-info-foreground text-sm font-medium"
                    onClick={() => handleOpenConfirmDialog(process)}
                  >
                    Start
                  </Button>
                  <Link to={`/processes/${process.id}`} className="flex-1">
                    <Button variant="secondary" size="sm" className="w-full">
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center p-8 border rounded-md">
            <h3 className="text-lg font-semibold">No Processes Found</h3>
            <p className="text-muted-foreground">
              There are no available processes to display.
            </p>
          </div>
        )}
      </div>

      {selectedProcess && (
        <Dialog
          open={isConfirmOpen}
          onOpenChange={(open) => {
            setIsConfirmOpen(open);
            if (!open) {
              setVariableErrors({});
              setJsonRequiresValidation(false);
              setJsonEditorError(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-[760px]">
            <DialogHeader>
              <DialogTitle>Start Process: {selectedProcess.name}</DialogTitle>
              <DialogDescription>
                Enter initial variables using form inputs or raw JSON.
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
                  <Label
                    htmlFor="process-variables-json"
                    className="text-sm font-medium"
                  >
                    Initial Variables (JSON object)
                  </Label>
                  <Textarea
                    id="process-variables-json"
                    value={jsonDraft}
                    onChange={(event) => {
                      setJsonDraft(event.target.value);
                      setJsonRequiresValidation(true);
                      setJsonEditorError(null);
                    }}
                    className="mt-2 min-h-[260px] font-mono"
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
                        JSON changed. Validate before starting.
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
              <Button onClick={handleStartProcess} disabled={startingProcess}>
                {startingProcess ? "Starting..." : "Confirm & Start"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Layout>
  );
}
