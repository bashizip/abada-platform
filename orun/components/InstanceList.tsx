import React, { useState, useMemo, useEffect } from "react";
import { useNavigate } from "@/router";
import { Card, Badge, Button, Modal, Input } from "./ui/Common.tsx";
import {
  Search,
  Filter,
  Play,
  Pause,
  XCircle,
  Eye,
  Loader2,
} from "lucide-react";
import { api } from "../services/api.ts";
import { ProcessInstance, ProcessDefinition } from "../types.ts";
import { formatDateTime, calculateDuration } from "../utils.ts";

export const InstanceList: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [definitionFilter, setDefinitionFilter] = useState<string>("ALL");
  const [instances, setInstances] = useState<ProcessInstance[]>([]);
  const [definitions, setDefinitions] = useState<ProcessDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Confirmation Modal State
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<
    "suspend" | "resume" | "cancel" | null
  >(null);
  const [cancelConfirmationString, setCancelConfirmationString] = useState("");
  const [cancelInputString, setCancelInputString] = useState("");

  const generateRandomString = () =>
    Math.random().toString(36).substring(2, 8).toUpperCase();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [instancesData, definitionsData] = await Promise.all([
          api.getProcessInstances(),
          api.getProcessDefinitions(),
        ]);
        setInstances(instancesData);
        setDefinitions(definitionsData);
      } catch (err: unknown) {
        console.error("Failed to fetch instances:", err);
        setError("Failed to load instances. Please check API connection.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleAction = (
    action: "suspend" | "resume" | "cancel",
    id: string,
  ) => {
    setSelectedInstanceId(id);
    setConfirmAction(action);
    if (action === "cancel") {
      setCancelConfirmationString(generateRandomString());
      setCancelInputString("");
    }
    setConfirmModalOpen(true);
  };

  const executeAction = async () => {
    if (!selectedInstanceId || !confirmAction) return;

    try {
      if (confirmAction === "suspend")
        await api.suspendProcessInstance(selectedInstanceId, true);
      if (confirmAction === "resume")
        await api.suspendProcessInstance(selectedInstanceId, false);
      if (confirmAction === "cancel")
        await api.cancelProcessInstance(selectedInstanceId);

      // Refresh list
      const updated = await api.getProcessInstances();
      setInstances(updated);
      setConfirmModalOpen(false);
    } catch (err) {
      console.error(`Failed to ${confirmAction} instance:`, err);
      alert(`Failed to ${confirmAction} instance`);
      setConfirmModalOpen(false);
    }
  };

  const filteredInstances = useMemo(() => {
    return instances.filter((inst) => {
      const matchesSearch =
        inst.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inst.startedBy.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus =
        statusFilter === "ALL" || inst.status === statusFilter;
      const matchesDef =
        definitionFilter === "ALL" || inst.definitionId === definitionFilter;
      return matchesSearch && matchesStatus && matchesDef;
    });
  }, [searchTerm, statusFilter, definitionFilter, instances]);

  if (loading)
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="animate-spin text-blue-500" />
      </div>
    );
  if (error)
    return (
      <div className="p-4 text-red-400 bg-red-900/20 rounded border border-red-900/50">
        {error}
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-100">Process Instances</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Filter size={16} className="mr-2" /> Advanced Filters
          </Button>
        </div>
      </div>

      <Modal
        isOpen={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        title={
          confirmAction === "suspend"
            ? "Suspend Process Instance"
            : confirmAction === "resume"
              ? "Resume Process Instance"
              : "Cancel Process Instance"
        }
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button variant="ghost" onClick={() => setConfirmModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={confirmAction === "cancel" ? "danger" : "primary"}
              onClick={executeAction}
              disabled={
                confirmAction === "cancel" &&
                cancelInputString !== cancelConfirmationString
              }
            >
              Confirm
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {confirmAction === "suspend" && (
            <p className="text-slate-300">
              Are you sure you want to suspend instance{" "}
              <span className="font-mono text-white">{selectedInstanceId}</span>
              ? It will be paused and no further activities will be executed
              until resumed.
            </p>
          )}
          {confirmAction === "resume" && (
            <p className="text-slate-300">
              Are you sure you want to resume instance{" "}
              <span className="font-mono text-white">{selectedInstanceId}</span>
              ? Execution will continue from where it was paused.
            </p>
          )}
          {confirmAction === "cancel" && (
            <>
              <p className="text-red-400 font-medium">
                Warning: You are about to cancel instance{" "}
                <span className="font-mono text-white">
                  {selectedInstanceId}
                </span>
                . This action cannot be undone.
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

      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search
              className="absolute left-3 top-2.5 text-slate-500"
              size={18}
            />
            <input
              type="text"
              placeholder="Search by ID or Initiator..."
              className="w-full bg-slate-900 border border-slate-700 text-slate-100 pl-10 pr-4 py-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none placeholder-slate-600"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="w-full md:w-48">
            <select
              className="w-full bg-slate-900 border border-slate-700 text-slate-100 px-4 py-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="RUNNING">Running</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
          <div className="w-full md:w-64">
            <select
              className="w-full bg-slate-900 border border-slate-700 text-slate-100 px-4 py-2 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={definitionFilter}
              onChange={(e) => setDefinitionFilter(e.target.value)}
            >
              <option value="ALL">All Processes</option>
              {definitions.map((def) => (
                <option key={def.id} value={def.id}>
                  {def.name} (v{def.version})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-400">
            <thead className="text-xs uppercase bg-slate-900/50 text-slate-300 border-b border-slate-700">
              <tr>
                <th className="px-6 py-4">Instance ID</th>
                <th className="px-6 py-4">Process Name</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Start Time</th>
                <th className="px-6 py-4">Duration</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredInstances.map((inst) => (
                <tr
                  key={inst.id}
                  className="hover:bg-slate-750 transition-colors group"
                >
                  <td
                    className="px-6 py-4 font-mono text-blue-400 font-medium cursor-pointer hover:underline"
                    onClick={() => navigate(`/instances/${inst.id}`)}
                  >
                    {inst.id}
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-100 text-base">
                      {inst.definitionName}
                    </div>
                    {inst.currentActivity && (
                      <div className="text-xs text-slate-500 mt-1">
                        Current: {inst.currentActivity}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <Badge status={inst.status} />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {(() => {
                      const formatted = formatDateTime(inst.startTime);
                      return (
                        <>
                          <div className="text-slate-200">{formatted.date}</div>
                          <div className="text-xs text-slate-500">
                            {formatted.time}
                          </div>
                        </>
                      );
                    })()}
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-medium text-slate-200">
                      {inst.duration ||
                        (inst.status === "RUNNING"
                          ? calculateDuration(inst.startTime)
                          : "-")}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => navigate(`/instances/${inst.id}`)}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
                        title="View Details"
                      >
                        <Eye size={16} />
                      </button>
                      {inst.status === "RUNNING" && (
                        <button
                          onClick={() => handleAction("suspend", inst.id)}
                          className="p-1 hover:bg-slate-700 rounded text-amber-500 hover:text-amber-400"
                          title="Suspend"
                        >
                          <Pause size={16} />
                        </button>
                      )}
                      {inst.status === "SUSPENDED" && (
                        <button
                          onClick={() => handleAction("resume", inst.id)}
                          className="p-1 hover:bg-slate-700 rounded text-emerald-500 hover:text-emerald-400"
                          title="Resume"
                        >
                          <Play size={16} />
                        </button>
                      )}
                      {["RUNNING", "SUSPENDED", "FAILED"].includes(
                        inst.status,
                      ) && (
                        <button
                          onClick={() => handleAction("cancel", inst.id)}
                          className="p-1 hover:bg-slate-700 rounded text-red-500 hover:text-red-400"
                          title="Cancel"
                        >
                          <XCircle size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredInstances.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-slate-500"
                  >
                    No process instances found matching your criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
