import React from 'react';
import {
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
import { getGroupsFromToken } from '@/auth/keycloakClient';
import { IconButton, TooltipProvider, UITooltip } from '@/components/ui';
import { SoundToggle } from '@/components/SoundToggle';
import { ViewNav } from '@/components/ViewNav';
import type { NavTab, StudioView } from '@/lib/studioViews';

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
  currentView?: StudioView;
  onViewChange?: (view: NavTab) => void;
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
      <header className="h-14 bg-mocha border-b border-hairline px-4 flex items-center gap-3 z-20 shrink-0">
        {/* Brand + clean file identifier (left, never shrinks) */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <img src="/abada-app-icon.svg" alt="" className="w-8 h-8 rounded-[7px] glow-amethyst-subtle" />
            <span className="font-bold text-sm tracking-wide text-linen hidden lg:inline">
              ABADA
            </span>
          </div>

          <div className="h-4 w-px bg-hairline" />

          <button type="button" onClick={onOpenProjects}
            className="flex items-center gap-1.5 text-xs text-sand hover:text-saffron max-w-[180px]"
            title="New project / Open project">
            <FolderKanban className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{activeProject?.name || 'Open project'}</span>
          </button>

          <div className="h-4 w-px bg-hairline" />

          <button
            type="button"
            onClick={onOpenProcessDetails}
            className="flex items-center gap-1.5 text-xs font-mono text-linen hover:text-saffron transition-colors max-w-[240px] truncate"
            title="View process details"
            aria-label="Open process details"
          >
            <FileText className="w-3.5 h-3.5 text-mineral-teal shrink-0" />
            <span className="truncate">{cleanName(currentWorkflow.name)}</span>
          </button>
        </div>

        {/* Global View Navigation (isolated, always centered) */}
        <div className="flex-1 flex items-center justify-center min-w-0">
          <ViewNav currentView={currentView} onViewChange={onViewChange}
            showAdmin={getGroupsFromToken().includes('abada-admin')} />
        </div>

        {/* Action Controls (right, never shrinks) */}
        <div className="flex items-center gap-3 shrink-0">
          {currentView === 'designer' && !readOnlyInstance && (
            <>
              <IconButton
                icon={<ShieldCheck className="w-4 h-4 text-amethyst" />}
                label="Audit Stream"
                tooltip="Audit Stream — deploy/run/event log of the active workspace"
                onClick={onToggleLogPanel}
                active={showLogPanel}
              />

              <IconButton
                icon={<Download className="w-4 h-4 text-mineral-teal" />}
                label="Export APL"
                tooltip="Export APL — download the canonical abada.io/v1 YAML process document"
                onClick={onExportJSON}
              />

              <IconButton
                icon={<GitCompare className="w-4 h-4 text-amethyst" />}
                label="Review AI Optimization"
                tooltip="Review AI Optimization — inspect, approve or reject the pending governed Insight proposal"
                onClick={onOpenAiDiff}
                active={isDiffActive}
              />

              <UITooltip content="Dry Run — animate a local mocked scenario without saving, deploying, calling an LLM or creating an instance">
                <button
                  type="button"
                  data-cuelume-tap
                  onClick={onRunSimulation}
                  disabled={isSimulating}
                  className={`text-xs font-semibold px-4 py-1.5 rounded-xl transition-all flex items-center gap-2 shadow-warm-md ${
                    isSimulating
                      ? 'bg-saffron/50 text-charcoal cursor-not-allowed'
                      : 'bg-saffron hover:bg-saffron-bright text-charcoal active:scale-95'
                  }`}
                >
                  {isSimulating ? <><RotateCcw className="w-3.5 h-3.5 animate-spin" /><span>Dry Running…</span></>
                    : <><Play className="w-3.5 h-3.5 fill-charcoal" /><span>Dry Run</span></>}
                </button>
              </UITooltip>

              <UITooltip content="Deploy & Start — save the APL, publish an immutable engine definition and create a live process instance">
                <button
                  type="button"
                  data-cuelume-tap
                  onClick={onDeploy}
                  disabled={isDeploying}
                  className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition-all flex items-center gap-2 ${
                    isDeploying
                      ? 'bg-mineral-teal/50 text-charcoal cursor-not-allowed'
                      : 'bg-mineral-teal hover:bg-mineral-teal-bright text-charcoal active:scale-95'
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

          <SoundToggle />

          <IconButton
            icon={<Settings className="w-4 h-4" />}
            label="Settings"
            tooltip="Settings — Insight Engine and LLM provider configuration"
            onClick={onOpenSettings}
          />

          <button
            type="button"
            data-cuelume-tap={keycloak.authenticated ? 'close' : 'tap'}
            onClick={() => {
              if (keycloak.authenticated) {
                keycloak.logout({ redirectUri: window.location.origin });
              } else {
                keycloak.login({ redirectUri: window.location.origin });
              }
            }}
            className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all shrink-0 ${
              keycloak.authenticated
                ? 'text-sand border-hairline bg-charcoal'
                : 'text-white border-transparent bg-amethyst hover:bg-amethyst-bright'
            }`}
          >
            {keycloak.authenticated ? 'Sign Out' : 'Sign In'}
          </button>
        </div>
      </header>
    </TooltipProvider>
  );
};
