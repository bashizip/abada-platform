import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "@/router";
import { Card, Badge, Button, Modal, Input } from "./ui/Common.tsx";
import {
  Play,
  Pause,
  XCircle,
  Settings,
  Clock,
  Activity,
  FileText,
  Database,
  GitBranch,
  Loader2,
} from "lucide-react";
import {
  ProcessInstance,
  Variable,
  ActivityInstance,
  ActivityHistory,
} from "../types.ts";
import { api } from "../services/api.ts";
import { DataSurgeryModal } from "./DataSurgeryModal.tsx";
import { BPMNViewer } from "./BPMNViewer.tsx";
import { formatDateTime, calculateDuration } from "../utils.ts";

export const InstanceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [instance, setInstance] = useState<ProcessInstance | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "variables" | "diagram" | "history"
  >("overview");
  const [variables, setVariables] = useState<Variable[]>([]);
  const [activityInstances, setActivityInstances] = useState<
    ActivityInstance[]
  >([]);
  const [history, setHistory] = useState<ActivityHistory[]>([]);
  const [isSurgeryOpen, setIsSurgeryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bpmnXml, setBpmnXml] = useState<string | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "SUSPENDED" | "RUNNING" | "CANCELLED" | null
  >(null);
  const [cancelConfirmationString, setCancelConfirmationString] = useState("");
  const [cancelInputString, setCancelInputString] = useState("");

  const generateRandomString = () =>
    Math.random().toString(36).substring(2, 8).toUpperCase();

  const fetchInstanceData = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const [instData, varsData, activitiesData, historyData] = await Promise.all([
        api.getProcessInstance(id),
        api.getProcessVariables(id),
        api.getActivityInstances(id),
        api.getProcessHistory(id),
      ]);
      console.log("varsData:", varsData);
      console.log("Instance Data:", instData);
      setInstance(instData);
      if (Array.isArray(varsData)) {
        setVariables(varsData);
      } else {
        console.error("varsData is not an array:", varsData);
        setVariables([]);
      }
      setActivityInstances(activitiesData);
      setHistory(historyData);

      // Fetch definition to get XML
      // Check for definitionId or processDefinitionId
      const defId = instData.definitionId;

      if (defId) {
        console.log("Fetching definition for:", defId);
        try {
          const def = await api.getProcessDefinition(defId);
          console.log("Definition fetched:", def);
          if (def.bpmnXml) {
            console.log("BPMN XML found, length:", def.bpmnXml.length);
            setBpmnXml(def.bpmnXml);
          } else {
            console.warn("No BPMN XML in definition");
          }
        } catch (e) {
          console.error("Failed to load BPMN XML", e);
        }
      } else {
        console.warn("No definitionId in instance data");
      }
    } catch (err: unknown) {
      console.error("Failed to fetch instance details:", err);
      setError("Failed to load instance details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInstanceData();
  }, [id]);

  const handleStatusChange = (
    newStatus: "SUSPENDED" | "RUNNING" | "CANCELLED",
  ) => {
    setConfirmAction(newStatus);
    if (newStatus === "CANCELLED") {
      setCancelConfirmationString(generateRandomString());
      setCancelInputString("");
    }
    setConfirmModalOpen(true);
  };

  const executeStatusChange = async () => {
    if (!instance || !confirmAction) return;

    console.log(
      `[InstanceDetail] Changing status from ${instance.status} to ${confirmAction}`,
    );

    try {
      if (confirmAction === "SUSPENDED") {
        console.log(
          "[InstanceDetail] Calling suspendProcessInstance with suspended=true",
        );
        await api.suspendProcessInstance(instance.id, true);
      }
      if (confirmAction === "RUNNING") {
        console.log(
          "[InstanceDetail] Calling suspendProcessInstance with suspended=false",
        );
        await api.suspendProcessInstance(instance.id, false);
      }
      if (confirmAction === "CANCELLED") {
        console.log("[InstanceDetail] Calling cancelProcessInstance");
        await api.cancelProcessInstance(instance.id);
      }

      console.log(
        "[InstanceDetail] Status change API call completed, refreshing data...",
      );

      // Refresh data
      await fetchInstanceData();
      setConfirmModalOpen(false);

      console.log(
        "[InstanceDetail] Data refreshed, new status:",
        instance.status,
      );
    } catch (err: unknown) {
      console.error("[InstanceDetail] Failed to update status:", err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      alert(`Failed to update status: ${errorMessage}`);
      setConfirmModalOpen(false);
    }
  };

  const handleVariableUpdate = async (newVars: Variable[]) => {
    if (!instance) return;

    try {
      // Compare new variables with original variables and update changed/new ones
      const updatePromises: Promise<void>[] = [];

      for (const newVar of newVars) {
        const originalVar = variables.find((v) => v.name === newVar.name);

        if (!originalVar) {
          // This is a new variable - add it
          console.log(
            `Adding new variable ${newVar.name}: ${newVar.value} (${newVar.type})`,
          );
          updatePromises.push(
            api.updateProcessVariable(
              instance.id,
              newVar.name,
              newVar.value,
              newVar.type,
            ),
          );
        } else if (
          JSON.stringify(originalVar.value) !== JSON.stringify(newVar.value)
        ) {
          // This is an existing variable that has changed - update it
          console.log(
            `Updating variable ${newVar.name}: ${originalVar.value} -> ${newVar.value}`,
          );
          updatePromises.push(
            api.updateProcessVariable(
              instance.id,
              newVar.name,
              newVar.value,
              newVar.type,
            ),
          );
        }
      }

      // Wait for all updates to complete
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
        console.log(
          `Successfully updated/added ${updatePromises.length} variable(s)`,
        );
      }

      // Refresh data to show updated values
      await fetchInstanceData();
    } catch (err) {
      console.error("Failed to update variables:", err);
      alert(
        "Failed to update variables. Please check the console for details.",
      );
    }
  };

  if (loading)
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="animate-spin text-blue-500" />
      </div>
    );
  if (error || !instance)
    return (
      <div className="text-center p-12 text-red-500">
        {error || "Instance not found"}
      </div>
    );

  return (
    <div className="space-y-6">
      <DataSurgeryModal
        isOpen={isSurgeryOpen}
        onClose={() => setIsSurgeryOpen(false)}
        variables={variables}
        onSave={handleVariableUpdate}
      />

      <Modal
        isOpen={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        title={
          confirmAction === "SUSPENDED"
            ? "Suspend Process Instance"
            : confirmAction === "RUNNING"
              ? "Resume Process Instance"
              : "Cancel Process Instance"
        }
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button variant="ghost" onClick={() => setConfirmModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={confirmAction === "CANCELLED" ? "danger" : "primary"}
              onClick={executeStatusChange}
              disabled={
                confirmAction === "CANCELLED" &&
                cancelInputString !== cancelConfirmationString
              }
            >
              Confirm
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {confirmAction === "SUSPENDED" && (
            <p className="text-slate-300">
              Are you sure you want to suspend this process instance? It will be
              paused and no further activities will be executed until resumed.
            </p>
          )}
          {confirmAction === "RUNNING" && (
            <p className="text-slate-300">
              Are you sure you want to resume this process instance? Execution
              will continue from where it was paused.
            </p>
          )}
          {confirmAction === "CANCELLED" && (
            <>
              <p className="text-red-400 font-medium">
                Warning: You are about to cancel this process instance. This
                action cannot be undone.
              </p>
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
                <p className="text-sm text-slate-400 mb-2">
                  To confirm, please type{" "}
                  <span className="font-mono font-bold text-white select-all">
                    {cancelConfirmationString}
                  </span>{" "}
                  below:
                </p>
                <Input
                  value={cancelInputString}
                  onChange={(e) => setCancelInputString(e.target.value)}
                  placeholder="Type the confirmation code"
                  className="font-mono uppercase"
                />
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Header */}
      <Card className="p-6">
        <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-6">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <h1 className="text-2xl font-bold font-mono text-slate-100">
                {instance.id}
              </h1>
              <Badge status={instance.status} />
            </div>
            <div className="mb-3">
              <h2 className="text-xl font-semibold text-slate-100 flex items-center gap-2">
                <FileText size={18} /> {instance.definitionName}
              </h2>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div className="flex flex-col">
                <span className="text-slate-500 text-xs mb-1">Start Time</span>
                <span className="flex items-center gap-1 text-slate-200 font-medium">
                  <Clock size={14} />{" "}
                  {(() => {
                    const formatted = formatDateTime(instance.startTime);
                    return `${formatted.date} at ${formatted.time}`;
                  })()}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-500 text-xs mb-1">Duration</span>
                <span className="text-slate-200 font-medium">
                  {instance.duration ||
                    (instance.status === "RUNNING"
                      ? calculateDuration(instance.startTime)
                      : "-")}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-500 text-xs mb-1">Initiator</span>
                <span className="text-slate-200 font-medium">
                  {instance.startedBy}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {instance.status === "RUNNING" && (
              <Button
                variant="outline"
                onClick={() => handleStatusChange("SUSPENDED")}
              >
                <Pause size={16} className="mr-2" /> Suspend
              </Button>
            )}
            {instance.status === "SUSPENDED" && (
              <Button
                variant="primary"
                onClick={() => handleStatusChange("RUNNING")}
              >
                <Play size={16} className="mr-2" /> Resume
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setIsSurgeryOpen(true)}
              disabled={instance.status === "CANCELLED"}
              className={
                instance.status === "CANCELLED"
                  ? "opacity-50 cursor-not-allowed"
                  : ""
              }
            >
              <Database size={16} className="mr-2" /> Data Surgery
            </Button>
            {["RUNNING", "SUSPENDED"].includes(instance.status) && (
              <Button
                variant="danger"
                onClick={() => handleStatusChange("CANCELLED")}
              >
                <XCircle size={16} className="mr-2" /> Cancel
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="border-b border-slate-700">
        <nav className="flex gap-6">
          {[
            { id: "overview", label: "Overview", icon: <Activity size={16} /> },
            {
              id: "variables",
              label: "Variables",
              icon: <Database size={16} />,
            },
            { id: "diagram", label: "Diagram", icon: <GitBranch size={16} /> },
            { id: "history", label: "Audit Log", icon: <Clock size={16} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b border-slate-700 font-medium text-slate-200">
                Current State
              </div>
              <div className="p-4 space-y-4">
                <div className="flex justify-between py-2 border-b border-slate-800">
                  <span className="text-slate-400">Activity ID</span>
                  <span className="font-mono text-slate-200">
                    {instance.currentActivity || "-"}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-800">
                  <span className="text-slate-400">Duration</span>
                  <span className="font-medium text-blue-400">
                    {instance.duration || "-"}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-800">
                  <span className="text-slate-400">Assigned To</span>
                  <span className="text-slate-200">-</span>
                </div>
              </div>
            </Card>
            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b border-slate-700 font-medium text-slate-200 flex justify-between">
                <span>Key Variables</span>
                <button
                  className="text-xs text-blue-400 hover:underline"
                  onClick={() => setActiveTab("variables")}
                >
                  View All
                </button>
              </div>
              <table className="w-full text-sm text-left">
                <tbody className="divide-y divide-slate-800">
                  {variables.slice(0, 4).map((v, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                        {v.name}
                      </td>
                      <td className="px-4 py-3 text-slate-200 text-right">
                        {String(v.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {activeTab === "variables" && (
          <Card className="overflow-hidden">
            <div className="p-4 bg-slate-800/50 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-slate-200 font-medium">Process Variables</h3>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setIsSurgeryOpen(true)}
              >
                Edit
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-slate-400">
                <thead className="text-xs uppercase bg-slate-900/50 text-slate-300">
                  <tr>
                    <th className="px-6 py-3">Name</th>
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {variables.map((v, i) => (
                    <tr key={i} className="hover:bg-slate-750">
                      <td className="px-6 py-3 font-medium text-blue-300 font-mono">
                        {v.name}
                      </td>
                      <td className="px-6 py-3 text-xs font-mono">{v.type}</td>
                      <td
                        className="px-6 py-3 text-slate-200 max-w-md truncate"
                        title={String(v.value)}
                      >
                        {String(v.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {activeTab === "diagram" && (
          <Card className="p-6 h-[600px] flex flex-col">
            <h3 className="text-lg font-medium text-slate-200 mb-4 shrink-0">
              Process Flow
            </h3>
            {console.log("Activity Instances for Diagram:", activityInstances)}
            <div className="flex-1 min-h-0">
              <BPMNViewer
                xml={bpmnXml || ""}
                activeActivityIds={Array.from(
                  new Set([
                    ...activityInstances
                      .filter((a) => !a.status || a.status === "RUNNING")
                      .map((a) => a.activityId),
                    ...(instance.currentActivity
                      ? [instance.currentActivity]
                      : []),
                  ]),
                )}
              />
            </div>
          </Card>
        )}

        {activeTab === "history" && (
          <Card>
            <div className="p-6">
              <ol className="relative border-l border-slate-700 ml-3">
                {history.map((hist) => {
                  const failed = hist.eventType.includes("FAILED") || hist.eventType.includes("ERROR");
                  return (
                  <li className="mb-8 ml-6" key={hist.id}>
                    <span
                      className={`absolute flex items-center justify-center w-6 h-6 rounded-full -left-3 ring-8 ring-slate-900 ${failed ? "bg-red-500" : "bg-emerald-500"}`}
                    >
                      {failed ? (
                        <XCircle size={14} className="text-white" />
                      ) : (
                        <Activity size={14} className="text-white" />
                      )}
                    </span>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start">
                      <div>
                        <h3 className="flex items-center mb-1 text-lg font-semibold text-slate-100">
                          {hist.eventType}{" "}
                          <span className="text-xs font-normal text-slate-500 ml-2 font-mono">
                            ({hist.activityId || "process"})
                          </span>
                        </h3>
                        <time className="block mb-2 text-sm font-normal leading-none text-slate-400">
                          {new Date(hist.occurredAt).toLocaleString()} · {hist.actor}
                        </time>
                      </div>
                      <Badge status={failed ? "FAILED" : "COMPLETED"} />
                    </div>
                    <div className="p-3 text-xs italic font-mono text-slate-400 bg-slate-950 rounded border border-slate-800 mt-2">
                      {JSON.stringify(hist.details)}
                    </div>
                  </li>
                  );
                })}
              </ol>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
