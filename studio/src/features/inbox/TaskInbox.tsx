import React, { useEffect, useState } from 'react';
import { EngineAPI } from '@/api/engine';
import { CheckCircle, Clock, User, FileText } from 'lucide-react';

export const TaskInbox: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<any | null>(null);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const data = await EngineAPI.getTasks(undefined, projectId);
      setTasks(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [projectId]);

  const handleComplete = async () => {
    if (!selectedTask) return;
    try {
      await EngineAPI.completeTask(selectedTask.id, {
        decision: 'APPROVED',
        notes: 'Approved via Studio Task Inbox'
      }, projectId);
      setSelectedTask(null);
      fetchTasks();
    } catch (err) {
      console.error('Failed to complete task', err);
    }
  };

  return (
    <div className="flex flex-1 overflow-hidden bg-[#1A1614] text-[#EAE3D9]">
      {/* Task List */}
      <div className="w-1/3 border-r border-[#3A322E] flex flex-col bg-[#25201D]">
        <div className="p-4 border-b border-[#3A322E]">
          <h2 className="text-lg font-semibold text-[#EAE3D9] flex items-center gap-2">
            <CheckCircle className="text-[#2A9D8F]" />
            Human Inbox
          </h2>
          <p className="text-xs text-[#A89F91]">Manual reviews and escalations</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {loading ? (
            <div className="p-4 text-sm text-[#A89F91] text-center animate-pulse">Loading tasks...</div>
          ) : tasks.length === 0 ? (
            <div className="p-4 text-sm text-[#A89F91] text-center">No tasks assigned to you.</div>
          ) : (
            tasks.map(task => (
              <div 
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedTask?.id === task.id 
                    ? 'bg-[#1A1614] border-[#F4A261]/50 shadow-warm-md'
                    : 'bg-[#25201D] border-[#3A322E] hover:bg-[#2F2926]'
                }`}
              >
                <div className="font-semibold text-sm mb-1">{task.name || 'Unnamed Task'}</div>
                <div className="flex items-center justify-between text-xs text-[#A89F91]">
                  <span className="flex items-center gap-1"><FileText className="w-3 h-3"/> {task.processDefinitionId.split(':')[0]}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {new Date(task.created).toLocaleDateString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Task Details */}
      <div className="flex-1 flex flex-col">
        {selectedTask ? (
          <div className="p-8 max-w-3xl mx-auto w-full">
            <div className="mb-6 pb-6 border-b border-[#3A322E]">
              <h1 className="text-2xl font-bold text-[#EAE3D9] mb-2">{selectedTask.name || 'Unnamed Task'}</h1>
              <div className="flex items-center gap-4 text-sm text-[#A89F91]">
                <span className="flex items-center gap-1"><User className="w-4 h-4"/> Assignee: {selectedTask.assignee || 'Unassigned'}</span>
                <span className="flex items-center gap-1"><Clock className="w-4 h-4"/> Created: {new Date(selectedTask.created).toLocaleString()}</span>
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-[#25201D] border border-[#3A322E] rounded-xl p-4">
                <h3 className="text-sm font-semibold mb-2 text-[#F4A261]">Task Description</h3>
                <p className="text-sm text-[#A89F91]">
                  Please review the attached case details and provide your decision.
                </p>
              </div>

              <div className="bg-[#25201D] border border-[#3A322E] rounded-xl p-4">
                <h3 className="text-sm font-semibold mb-4 text-[#F4A261]">Required Actions</h3>
                <div className="flex gap-3">
                  <button onClick={handleComplete} className="px-4 py-2 bg-[#2A9D8F] text-[#1A1614] rounded-lg text-sm font-medium hover:bg-[#34bdae] transition-all">
                    Approve Request
                  </button>
                  <button onClick={handleComplete} className="px-4 py-2 bg-[#E76F51] text-[#1A1614] rounded-lg text-sm font-medium hover:bg-[#f07b5d] transition-all">
                    Reject Request
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#A89F91]">
            Select a task from the inbox to review.
          </div>
        )}
      </div>
    </div>
  );
};
