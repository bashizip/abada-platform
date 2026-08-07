import React from 'react';
import { 
  Cpu, 
  Play, 
  Download, 
  Share2, 
  Plus, 
  CheckCircle2, 
  Sparkles, 
  Settings,
  Layers,
  FileCode,
  RotateCcw,
  BookOpen
} from 'lucide-react';
import { WorkflowFile } from '@/types';
import { keycloak } from '@/auth/keycloakClient';

interface HeaderProps {
  currentWorkflow: WorkflowFile;
  onRunSimulation: () => void;
  isSimulating: boolean;
  onNewWorkflow: () => void;
  onExportJSON: () => void;
  onDeploy: () => void;
  isDeploying: boolean;
  onToggleLogPanel: () => void;
  showLogPanel: boolean;
  nodeCount: number;
  currentView?: 'designer' | 'inbox' | 'operations';
  onViewChange?: (view: 'designer' | 'inbox' | 'operations') => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentWorkflow,
  onRunSimulation,
  isSimulating,
  onNewWorkflow,
  onExportJSON,
  onDeploy,
  isDeploying,
  onToggleLogPanel,
  showLogPanel,
  nodeCount,
  currentView = 'designer',
  onViewChange,
}) => {
  return (
    <header className="h-14 bg-[#25201D] border-b border-[#3A322E] px-4 flex items-center justify-between z-20 shrink-0">
      {/* Brand & File Info */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#9D4EDD] to-[#25201D] border border-[#9D4EDD]/40 flex items-center justify-center glow-amethyst-subtle">
            <Cpu className="w-4 h-4 text-[#EAE3D9]" />
          </div>
          <div>
            <span className="font-bold text-base tracking-wide text-[#EAE3D9] flex items-center gap-1.5">
              ABADA <span className="text-[#F4A261] text-xs font-semibold px-1.5 py-0.5 rounded bg-[#F4A261]/10 border border-[#F4A261]/20">STUDIO</span>
            </span>
          </div>
        </div>

        <div className="h-4 w-px bg-[#3A322E] mx-1" />

        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-[#A89F91] px-2 py-0.5 rounded bg-[#1A1614] border border-[#3A322E] flex items-center gap-1">
            <FileCode className="w-3 h-3 text-[#2A9D8F]" />
            {currentWorkflow.name}
          </span>
          <span className="text-[10px] text-[#A89F91] bg-[#1A1614] px-1.5 py-0.5 rounded border border-[#3A322E]">
            v{currentWorkflow.version}
          </span>
          <span className="text-[10px] text-[#90A955] bg-[#90A955]/10 px-2 py-0.5 rounded-full border border-[#90A955]/30 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#90A955] animate-pulse" />
            Active ({nodeCount})
          </span>
        </div>
      </div>

      {/* Global View Navigation */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center bg-[#1A1614] rounded-xl border border-[#3A322E] p-1">
        {(['designer', 'inbox', 'operations'] as const).map(view => (
          <button
            key={view}
            onClick={() => onViewChange?.(view)}
            className={`text-xs px-4 py-1.5 rounded-lg capitalize transition-all font-medium ${
              currentView === view
                ? 'bg-[#25201D] text-[#EAE3D9] shadow-warm-md border border-[#3A322E]'
                : 'text-[#A89F91] hover:text-[#EAE3D9] border border-transparent'
            }`}
          >
            {view === 'designer' ? 'Canvas' : view === 'inbox' ? 'Task Inbox' : 'Operations'}
          </button>
        ))}
      </div>

      {/* Action Controls */}
      <div className="flex items-center space-x-2.5">
        {currentView === 'designer' && (
          <>
            <button
              onClick={onNewWorkflow}
              className="text-xs text-[#EAE3D9] hover:text-[#F4A261] bg-[#1A1614] hover:bg-[#2F2926] px-3 py-1.5 rounded-xl border border-[#3A322E] transition-all flex items-center gap-1.5"
              title="Create New Workflow Canvas"
            >
              <Plus className="w-3.5 h-3.5 text-[#F4A261]" />
              <span>New Canvas</span>
            </button>

            <button
              onClick={onToggleLogPanel}
              className={`text-xs px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1.5 ${
                showLogPanel 
                  ? 'bg-[#9D4EDD]/20 text-[#EAE3D9] border-[#9D4EDD]/50 glow-amethyst-subtle'
                  : 'bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9] border-[#3A322E]'
              }`}
              title="Toggle Simulation Logs"
            >
              <Layers className="w-3.5 h-3.5 text-[#9D4EDD]" />
              <span>Audit Stream</span>
            </button>

            <button
              onClick={onExportJSON}
              className="text-xs text-[#A89F91] hover:text-[#EAE3D9] bg-[#1A1614] hover:bg-[#2F2926] px-3 py-1.5 rounded-xl border border-[#3A322E] transition-all flex items-center gap-1.5"
              title="Export BPMN / DMN JSON"
            >
              <Download className="w-3.5 h-3.5 text-[#2A9D8F]" />
              <span>Export Schema</span>
            </button>

            <button
              onClick={onRunSimulation}
              disabled={isSimulating}
              title="Run the workflow live on the Abada Engine"
              className={`text-xs font-semibold px-4 py-1.5 rounded-xl transition-all flex items-center gap-2 shadow-warm-md ${
                isSimulating
                  ? 'bg-[#F4A261]/50 text-[#1A1614] cursor-not-allowed'
                  : 'bg-[#F4A261] hover:bg-[#f5ad73] text-[#1A1614] active:scale-95'
              }`}
            >
              {isSimulating ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5 animate-spin text-[#1A1614]" />
                  <span>Running…</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-[#1A1614]" />
                  <span>Run</span>
                </>
              )}
            </button>

            <button
              onClick={onDeploy}
              disabled={isDeploying}
              className={`text-xs font-semibold px-4 py-1.5 rounded-xl transition-all flex items-center gap-2 shadow-warm-md ${
                isDeploying
                  ? 'bg-[#2A9D8F]/50 text-[#1A1614] cursor-not-allowed'
                  : 'bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] active:scale-95'
              }`}
            >
              {isDeploying ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5 animate-spin text-[#1A1614]" />
                  <span>Deploying...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#1A1614]" />
                  <span>Deploy to Engine</span>
                </>
              )}
            </button>
          </>
        )}
        
        <a
          href="http://docs.localhost"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[#A89F91] hover:text-[#EAE3D9] bg-[#1A1614] hover:bg-[#2F2926] px-3 py-1.5 rounded-xl border border-[#3A322E] transition-all flex items-center gap-1.5 ml-2"
          title="Open Abada Documentation"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Docs</span>
        </a>

        {/* Auth Button */}
        <button
          onClick={() => {
            if (keycloak.authenticated) {
              keycloak.logout({ redirectUri: window.location.origin });
            } else {
              keycloak.login({ redirectUri: window.location.origin });
            }
          }}
          className={`text-xs px-4 py-1.5 rounded-xl border transition-all flex items-center gap-1.5 ml-2 ${
            keycloak.authenticated
              ? 'bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9] border-[#3A322E]'
              : 'bg-[#9D4EDD] hover:bg-[#b56ef2] text-white border-transparent'
          }`}
        >
          {keycloak.authenticated ? 'Sign Out' : 'Sign In'}
        </button>
      </div>
    </header>
  );
};
