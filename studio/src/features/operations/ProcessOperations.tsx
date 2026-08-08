import React, { useEffect, useState } from 'react';
import { EngineAPI, ProcessInstanceDTO } from '@/api/engine';
import { Activity, XCircle, RefreshCcw } from 'lucide-react';

export const ProcessOperations: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const [instances, setInstances] = useState<ProcessInstanceDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInstances = async () => {
    setLoading(true);
    try {
      const data = await EngineAPI.getInstances(projectId);
      setInstances(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInstances();
  }, [projectId]);

  const handleFail = async (id: string) => {
    try {
      await EngineAPI.failInstance(id, projectId);
      fetchInstances();
    } catch (err) {
      console.error('Failed to fail instance', err);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-[#1A1614] text-[#EAE3D9]">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between border-b border-[#3A322E] pb-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="text-[#9D4EDD]" /> Process Operations
            </h1>
            <p className="text-sm text-[#A89F91] mt-1">Monitor and control running process instances across the cluster.</p>
          </div>
          <button onClick={fetchInstances} className="p-2 bg-[#25201D] border border-[#3A322E] rounded-lg hover:bg-[#2F2926] transition-all">
            <RefreshCcw className={`w-4 h-4 text-[#A89F91] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="bg-[#25201D] border border-[#3A322E] rounded-xl overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#1A1614] border-b border-[#3A322E] text-[#A89F91] text-xs uppercase">
              <tr>
                <th className="p-4 font-medium">Instance ID</th>
                <th className="p-4 font-medium">Process Definition</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">Started At</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && instances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-[#A89F91]">Loading operations data...</td>
                </tr>
              ) : instances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-[#A89F91]">No process instances found.</td>
                </tr>
              ) : (
                instances.map(inst => (
                  <tr key={inst.id} className="border-b border-[#3A322E]/50 hover:bg-[#2F2926]/50 transition-all">
                    <td className="p-4 font-mono text-[#EAE3D9]">{inst.id}</td>
                    <td className="p-4 text-[#A89F91]">{inst.processDefinitionId}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs border ${
                        inst.status === 'ACTIVE' ? 'bg-[#90A955]/10 text-[#90A955] border-[#90A955]/30' :
                        inst.status === 'COMPLETED' ? 'bg-[#9D4EDD]/10 text-[#9D4EDD] border-[#9D4EDD]/30' :
                        'bg-[#E76F51]/10 text-[#E76F51] border-[#E76F51]/30'
                      }`}>
                        {inst.status}
                      </span>
                    </td>
                    <td className="p-4 text-[#A89F91] font-mono">{new Date(inst.startDate).toLocaleString()}</td>
                    <td className="p-4 text-right">
                      {inst.status === 'ACTIVE' && (
                        <button 
                          onClick={() => handleFail(inst.id)}
                          className="px-3 py-1.5 bg-[#E76F51]/10 text-[#E76F51] rounded border border-[#E76F51]/30 hover:bg-[#E76F51]/20 transition-all text-xs flex items-center gap-1 ml-auto"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Fail Instance
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
