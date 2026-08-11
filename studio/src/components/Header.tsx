import React from 'react';
import {
  Cpu,
  Play,
  Download,
  CheckCircle2,
  RotateCcw,
  ShieldCheck,
  BookOpen,
  GitCompare,
  FileText,
  Settings,
  FolderKanban,
} from 'lucide-react';
import { Project } from '@/api/projects';
import { WorkflowFile } from '@/types';
import { keycloak } from '@/auth/keycloakClient';
import { IconButton, TooltipProvider, UITooltip } from '@/components/ui';

interface HeaderProps {
  currentWorkflow: WorkflowFile;
  onRunSimulation: () => void;
  isSimulating: boolean;
  onExportJSON: () => void;
  onDeploy: () => void;
  isDeploying: boolean;
  onToggleLogPanel: () => void;
  showLogPanel: boolean;
  onOpenAiDiff?: () => void;
  isDiffActive?: boolean;
  onOpenProcessDetails?: () => void;
  onOpenSettings?: () => void;
  nodeCount: number;
  currentView?: 'designer' | 'inbox' | 'operations';
  onViewChange?: (view: 'designer' | 'inbox' | 'operations') => void;
  activeProject?: Project;
  onOpenProjects?: () => void;
  readOnlyInstance?: boolean;
}

/** Clean file identifier: process name only, no format/version pill noise. */
const cleanName = (name: string): string =>
  name.replace(/\.(apl\.yaml|bpmn|dmn|json|prompt)$/i, '');

export const Header: React.FC<HeaderProps> = ({
  currentWorkflow,
  onRunSimulation,
  isSimulating,
  onExportJSON,
  onDeploy,
  isDeploying,
  onToggleLogPanel,
  showLogPanel,
  onOpenAiDiff,
  isDiffActive,
  onOpenProcessDetails,
  onOpenSettings,
  nodeCount,
  currentView = 'designer',
  onViewChange,
  activeProject,
  onOpenProjects,
  readOnlyInstance = false,
}) => {
  return (
    <TooltipProvider delayDuration={0}>
      <header className="h-14 bg-[#25201D] border-b border-[#3A322E] px-4 flex items-center gap-3 z-20 shrink-0">
        {/* Brand + clean file identifier (left, never shrinks) */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#9D4EDD] to-[#25201D] border border-[#9D4EDD]/40 flex items-center justify-center glow-amethyst-subtle">
              <Cpu className="w-4 h-4 text-[#EAE3D9]" />
            </div>
            <span className="font-bold text-sm tracking-wide text-[#EAE3D9] hidden lg:inline">
              ABADA
            </span>
          </div>

          <div className="h-4 w-px bg-[#3A322E]" />

          <button type="button" onClick={onOpenProjects}
            className="flex items-center gap-1.5 text-xs text-[#A89F91] hover:text-[#F4A261] max-w-[180px]"
            title="New project / Open project">
            <FolderKanban className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{activeProject?.name || 'Open project'}</span>
          </button>

          <div className="h-4 w-px bg-[#3A322E]" />

          <button
            type="button"
            onClick={onOpenProcessDetails}
            className="flex items-center gap-1.5 text-xs font-mono text-[#EAE3D9] hover:text-[#F4A261] transition-colors max-w-[240px] truncate"
            title="View process details"
            aria-label="Open process details"
          >
            <FileText className="w-3.5 h-3.5 text-[#2A9D8F] shrink-0" />
            <span className="truncate">{cleanName(currentWorkflow.name)}</span>
          </button>
        </div>

        {/* Global View Navigation (isolated, always centered) */}
        <div className="flex-1 flex items-center justify-center min-w-0">
          <div className="flex items-center bg-[#1A1614] rounded-xl border border-[#3A322E] p-1 shrink-0">
            {(['designer', 'inbox', 'operations'] as const).map(view => (
              <button
                key={view}
                onClick={() => onViewChange?.(view)}
                className={`text-xs px-4 py-1.5 rounded-lg capitalize transition-all font-medium whitespace-nowrap ${
                  currentView === view
                    ? 'bg-[#25201D] text-[#EAE3D9] border border-[#3A322E]'
                    : 'text-[#A89F91] hover:text-[#EAE3D9] border border-transparent'
                }`}
              >
                {view === 'designer' ? 'Canvas' : view === 'inbox' ? 'Task Inbox' : 'Operations'}
              </button>
            ))}
          </div>
        </div>

        {/* Action Controls (right, never shrinks) */}
        <div className="flex items-center gap-3 shrink-0">
          {currentView === 'designer' && !readOnlyInstance && (
            <>
              <IconButton
                icon={<ShieldCheck className="w-4 h-4 text-[#9D4EDD]" />}
                label="Audit Stream"
                tooltip="Audit Stream — deploy/run/event log of the active workspace"
                onClick={onToggleLogPanel}
                active={showLogPanel}
              />

              <IconButton
                icon={<Download className="w-4 h-4 text-[#2A9D8F]" />}
                label="Export Schema"
                tooltip="Export Schema — download the workflow as a JSON definition"
                onClick={onExportJSON}
              />

              <IconButton
                icon={<GitCompare className="w-4 h-4 text-[#9D4EDD]" />}
                label="Review AI Optimization"
                tooltip="Review AI Optimization — inspect, approve or reject the pending governed Insight proposal"
                onClick={onOpenAiDiff}
                active={isDiffActive}
              />

              <UITooltip content="Dry Run — animate a local mocked scenario without saving, deploying, calling an LLM or creating an instance">
                <button
                  type="button"
                  onClick={onRunSimulation}
                  disabled={isSimulating}
                  className={`text-xs font-semibold px-4 py-1.5 rounded-xl transition-all flex items-center gap-2 shadow-warm-md ${
                    isSimulating
                      ? 'bg-[#F4A261]/50 text-[#1A1614] cursor-not-allowed'
                      : 'bg-[#F4A261] hover:bg-[#f5ad73] text-[#1A1614] active:scale-95'
                  }`}
                >
                  {isSimulating ? <><RotateCcw className="w-3.5 h-3.5 animate-spin" /><span>Dry Running…</span></>
                    : <><Play className="w-3.5 h-3.5 fill-[#1A1614]" /><span>Dry Run</span></>}
                </button>
              </UITooltip>

              <UITooltip content="Deploy & Start — save the APL, publish an immutable engine definition and create a live process instance">
                <button
                  type="button"
                  onClick={onDeploy}
                  disabled={isDeploying}
                  className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition-all flex items-center gap-2 ${
                    isDeploying
                      ? 'bg-[#2A9D8F]/50 text-[#1A1614] cursor-not-allowed'
                      : 'bg-[#2A9D8F] hover:bg-[#34bdae] text-[#1A1614] active:scale-95'
                  }`}
                >
                  {isDeploying ? <><RotateCcw className="w-3.5 h-3.5 animate-spin" /><span>Starting…</span></>
                    : <><CheckCircle2 className="w-3.5 h-3.5" /><span>Deploy & Start</span></>}
                </button>
              </UITooltip>
            </>
          )}

          <IconButton
            icon={<BookOpen className="w-4 h-4" />}
            label="Documentation"
            tooltip="Documentation — open the Abada docs site"
            onClick={() => window.open('http://docs.localhost', '_blank', 'noopener,noreferrer')}
          />

          <IconButton
            icon={<Settings className="w-4 h-4" />}
            label="Settings"
            tooltip="Settings — Insight Engine and LLM provider configuration"
            onClick={onOpenSettings}
          />

          <button
            type="button"
            onClick={() => {
              if (keycloak.authenticated) {
                keycloak.logout({ redirectUri: window.location.origin });
              } else {
                keycloak.login({ redirectUri: window.location.origin });
              }
            }}
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all shrink-0 ${
              keycloak.authenticated
                ? 'text-[#A89F91] border-[#3A322E] bg-[#1A1614]'
                : 'text-white border-transparent bg-[#9D4EDD] hover:bg-[#b56ef2]'
            }`}
          >
            {keycloak.authenticated ? 'Sign Out' : 'Sign In'}
          </button>
        </div>
      </header>
    </TooltipProvider>
  );
};
