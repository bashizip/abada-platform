import React from 'react';
import { LogIn } from 'lucide-react';
import { keycloak } from '@/auth/keycloakClient';
import { SoundToggle } from '@/components/SoundToggle';

/**
 * Full-screen entry point shown before the Keycloak session exists. The
 * workspace (canvas, dialogs, project tree) is not mounted until the user
 * signs in, so a fresh session starts at a clear sign-in surface instead of
 * an empty canvas.
 */
export const SignInGate: React.FC = () => (
  <div className="relative flex flex-col items-center justify-center h-screen w-screen bg-charcoal text-linen">
    <SoundToggle className="absolute top-4 right-4" />
    <div className="flex items-center gap-3 mb-8">
      <img src="/abada-app-icon.svg" alt="" className="w-12 h-12 rounded-[11px] glow-amethyst-subtle" />
      <div>
        <h1 className="font-bold text-xl tracking-wide">ABADA</h1>
        <p className="text-[11px] text-sand">Studio</p>
      </div>
    </div>

    <div className="max-w-sm text-center space-y-4">
      <h2 className="text-sm font-semibold">Welcome to Abada Studio</h2>
      <p className="text-xs text-sand leading-relaxed">
        Design, test and run governed AI processes written in APL. Sign in to
        reach your projects, processes, forms and workflows.
      </p>
      <button type="button"
        data-cuelume-tap
        onClick={() => keycloak.login({ redirectUri: window.location.origin })}
        className="mx-auto flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-semibold bg-amethyst hover:bg-amethyst-bright text-white shadow-warm-md transition-colors">
        <LogIn className="w-4 h-4" />
        Sign in
      </button>
    </div>
  </div>
);