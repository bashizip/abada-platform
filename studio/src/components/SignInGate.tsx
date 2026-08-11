import React from 'react';
import { Cpu, LogIn } from 'lucide-react';
import { keycloak } from '@/auth/keycloakClient';

/**
 * Full-screen entry point shown before the Keycloak session exists. The
 * workspace (canvas, dialogs, project tree) is not mounted until the user
 * signs in, so a fresh session starts at a clear sign-in surface instead of
 * an empty canvas.
 */
export const SignInGate: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-screen w-screen bg-[#1A1614] text-[#EAE3D9]">
    <div className="flex items-center gap-3 mb-8">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#9D4EDD] to-[#25201D] border border-[#9D4EDD]/40 flex items-center justify-center glow-amethyst-subtle">
        <Cpu className="w-6 h-6 text-[#EAE3D9]" />
      </div>
      <div>
        <h1 className="font-bold text-xl tracking-wide">ABADA</h1>
        <p className="text-[11px] text-[#A89F91]">Studio</p>
      </div>
    </div>

    <div className="max-w-sm text-center space-y-4">
      <h2 className="text-sm font-semibold">Welcome to Abada Studio</h2>
      <p className="text-xs text-[#A89F91] leading-relaxed">
        Design, preview and deploy BPMN processes as APL documents. Sign in to
        reach your projects, processes, forms and workflows.
      </p>
      <button type="button"
        onClick={() => keycloak.login({ redirectUri: window.location.origin })}
        className="mx-auto flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-semibold bg-[#9D4EDD] hover:bg-[#b56ef2] text-white shadow-warm-md transition-colors">
        <LogIn className="w-4 h-4" />
        Sign in
      </button>
    </div>
  </div>
);