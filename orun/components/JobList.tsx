import React, { useState, useEffect } from "react";
import { Card, Button, Modal } from "./ui/Common.tsx";
import {
  AlertTriangle,
  RefreshCw,
  Terminal,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useNavigate } from "@/router";
import { api } from "../services/api.ts";
import { Job } from "../types.ts";

export const JobList: React.FC = () => {
  const navigate = useNavigate();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<"RETRY" | "STACKTRACE" | null>(
    null,
  );
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stacktrace, setStacktrace] = useState<string>("");

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const data = await api.getJobs();
      setJobs(data);
    } catch (err: unknown) {
      console.error("Failed to fetch jobs:", err);
      setError("Failed to load jobs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const selectedJob = jobs.find((j) => j.id === selectedJobId);

  const handleOpenRetry = (id: string) => {
    setSelectedJobId(id);
    setModalType("RETRY");
  };

  const handleOpenStack = async (id: string) => {
    setSelectedJobId(id);
    setModalType("STACKTRACE");
    try {
      const trace = await api.getJobStacktrace(id);
      setStacktrace(trace);
    } catch (err) {
      setStacktrace("Failed to load stack trace.");
    }
  };

  const handleRetry = async () => {
    if (!selectedJobId) return;
    try {
      await api.retryJob(selectedJobId);
      closeModal();
      fetchJobs();
    } catch (err) {
      alert("Failed to retry job");
    }
  };

  const closeModal = () => {
    setModalType(null);
    setSelectedJobId(null);
    setStacktrace("");
  };

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
      <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
        <AlertTriangle className="text-red-500" />
        Failed Jobs Management
      </h1>

      {/* Stack Trace Modal */}
      <Modal
        isOpen={modalType === "STACKTRACE"}
        onClose={closeModal}
        title="Exception Stack Trace"
        maxWidth="max-w-4xl"
      >
        <div className="bg-slate-950 p-4 rounded-md font-mono text-xs text-red-300 overflow-auto h-[60vh] whitespace-pre">
          {stacktrace || "Loading stack trace..."}
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigator.clipboard.writeText(stacktrace)}
          >
            Copy to Clipboard
          </Button>
        </div>
      </Modal>

      {/* Retry Modal */}
      <Modal
        isOpen={modalType === "RETRY"}
        onClose={closeModal}
        title="Retry Job"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button onClick={handleRetry}>Confirm Retry</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm">
            You are about to increment the retries for job{" "}
            <span className="font-mono text-blue-300">{selectedJobId}</span>.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Number of Retries
            </label>
            <input
              type="number"
              defaultValue={3}
              className="bg-slate-900 border border-slate-700 text-slate-100 rounded px-3 py-2 w-full"
            />
          </div>
        </div>
      </Modal>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-400">
            <thead className="text-xs uppercase bg-slate-900/50 text-slate-300">
              <tr>
                <th className="px-6 py-4">Job ID</th>
                <th className="px-6 py-4">Exception</th>
                <th className="px-6 py-4">Process</th>
                <th className="px-6 py-4">Failed At</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="hover:bg-slate-750 transition-colors"
                >
                  <td className="px-6 py-4 font-mono text-xs text-slate-300">
                    {job.id}
                  </td>
                  <td className="px-6 py-4">
                    <div
                      className="max-w-xs truncate text-red-400 font-medium"
                      title={job.exceptionMessage}
                    >
                      {job.exceptionMessage}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Activity: {job.activityName}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-slate-200">
                      {job.processDefinitionName}
                    </div>
                    <button
                      onClick={() =>
                        navigate(`/instances/${job.processInstanceId}`)
                      }
                      className="text-xs text-blue-400 hover:underline flex items-center gap-1 mt-1"
                    >
                      {job.processInstanceId} <ArrowRight size={10} />
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs">
                    {new Date(job.failureTime).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenStack(job.id)}
                      >
                        <Terminal size={14} className="mr-1" /> Trace
                      </Button>
                      <Button size="sm" onClick={() => handleOpenRetry(job.id)}>
                        <RefreshCw size={14} className="mr-1" /> Retry
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-slate-500"
                  >
                    No failed jobs found.
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
