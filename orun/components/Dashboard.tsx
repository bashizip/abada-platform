import React, { useEffect, useState } from "react";
import { Card, Badge } from "./ui/Common.tsx";
import {
  Activity,
  AlertOctagon,
  CheckCircle,
  PauseCircle,
  PlayCircle,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useNavigate } from "@/router";
import { api } from "../services/api.ts";
import { ProcessInstance, Job } from "../types.ts";
import { getRelativeTime } from "../utils.ts";

const StatCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  subtext?: string;
}> = ({ title, value, icon, color, subtext }) => (
  <Card className="p-6 flex items-start justify-between relative overflow-hidden group">
    <div className="z-10 relative">
      <p className="text-slate-400 text-sm font-medium mb-1">{title}</p>
      <h3 className="text-3xl font-bold text-slate-100">{value}</h3>
      {subtext && <p className="text-xs text-slate-500 mt-2">{subtext}</p>}
    </div>
    <div className={`p-3 rounded-lg ${color} bg-opacity-20 text-white z-10`}>
      {icon}
    </div>
    {/* Glow Effect */}
    <div
      className={`absolute -right-6 -bottom-6 w-24 h-24 rounded-full ${color} opacity-5 blur-2xl group-hover:opacity-10 transition-opacity`}
    ></div>
  </Card>
);

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [instances, setInstances] = useState<ProcessInstance[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [instancesData, jobsData] = await Promise.all([
          api.getProcessInstances(),
          api.getJobs(),
        ]);
        setInstances(instancesData);
        setJobs(jobsData);
      } catch (err: unknown) {
        console.error("Failed to fetch dashboard data:", err);
        setError(
          "Failed to load dashboard data. Please check if the API is running.",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const activeCount = instances.filter((i) => i.status === "RUNNING").length;
  const failedJobsCount = jobs.length;
  const suspendedCount = instances.filter(
    (i) => i.status === "SUSPENDED",
  ).length;
  const completedToday = instances.filter(
    (i) => i.status === "COMPLETED",
  ).length; // Ideally filter by date

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-500" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-900/20 border border-red-900/50 rounded-lg text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-100">
          Operations Overview
        </h1>
        <span className="text-sm text-slate-500">Last updated: Just now</span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Processes"
          value={activeCount}
          icon={<PlayCircle size={24} />}
          color="bg-blue-500"
          subtext="+12% from yesterday"
        />
        <StatCard
          title="Failed Jobs"
          value={failedJobsCount}
          icon={<AlertOctagon size={24} />}
          color="bg-red-500"
          subtext="Requires attention"
        />
        <StatCard
          title="Suspended"
          value={suspendedCount}
          icon={<PauseCircle size={24} />}
          color="bg-amber-500"
        />
        <StatCard
          title="Completed Today"
          value={completedToday}
          icon={<CheckCircle size={24} />}
          color="bg-emerald-500"
          subtext="98.5% Success Rate"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Failed Jobs Alert Panel */}
        <div className="lg:col-span-2">
          <Card className="h-full flex flex-col">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-red-900/10">
              <div className="flex items-center gap-2">
                <AlertOctagon className="text-red-500" size={20} />
                <h2 className="font-semibold text-slate-100">
                  Failed Jobs Alert
                </h2>
              </div>
              <button
                onClick={() => navigate("/jobs")}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium"
              >
                View All
              </button>
            </div>
            <div className="p-0 flex-1 overflow-auto">
              {failedJobsCount === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  No failed jobs. System healthy.
                </div>
              ) : (
                <div className="divide-y divide-slate-700">
                  {jobs.slice(0, 3).map((job) => (
                    <div
                      key={job.id}
                      className="p-4 hover:bg-slate-750 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-sm font-medium text-slate-200">
                          {job.processDefinitionName}
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(job.failureTime).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-xs text-red-400 font-mono mb-2 truncate bg-red-950/30 p-1.5 rounded border border-red-900/30">
                        {job.exceptionMessage}
                      </div>
                      <div className="flex justify-between items-center">
                        <div className="text-xs text-slate-400">
                          Activity: {job.activityName}
                        </div>
                        <button
                          onClick={() =>
                            navigate(`/instances/${job.processInstanceId}`)
                          }
                          className="text-xs flex items-center gap-1 text-blue-400 hover:text-blue-300"
                        >
                          Inspect <ArrowRight size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Recent Activity Feed */}
        <div>
          <Card className="h-full flex flex-col">
            <div className="p-4 border-b border-slate-700">
              <h2 className="font-semibold text-slate-100 flex items-center gap-2">
                <Activity size={18} className="text-blue-400" />
                Recent Activity
              </h2>
            </div>
            <div className="p-0 flex-1 overflow-auto">
              <div className="divide-y divide-slate-700/50">
                {instances.slice(0, 6).map((inst, i) => (
                  <div
                    key={i}
                    className="p-4 hover:bg-slate-750 transition-colors cursor-pointer"
                    onClick={() => navigate(`/instances/${inst.id}`)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-mono text-slate-500">
                        {inst.id}
                      </span>
                      <span className="text-xs text-slate-500">
                        {getRelativeTime(inst.startTime)}
                      </span>
                    </div>
                    <div className="text-base font-semibold text-slate-100 mb-2">
                      {inst.definitionName}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge status={inst.status} />
                        {inst.currentActivity && (
                          <span className="text-xs text-slate-400 truncate max-w-[120px]">
                            &bull; {inst.currentActivity}
                          </span>
                        )}
                      </div>
                      {inst.duration && (
                        <span className="text-xs text-slate-400">
                          Duration: {inst.duration}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
