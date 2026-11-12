import React from 'react';
import { m } from 'motion/react';
import { ArrowRight, Eye, ShieldCheck, Workflow } from 'lucide-react';
import { keycloak } from '@/auth/keycloakClient';
import { SignInPreview } from '@/components/SignInPreview';
import { enterExit, listStagger, useMotionVariants } from '@/lib/motion';

const POINTS = [
  { icon: Workflow, text: 'Design processes in APL, or import BPMN' },
  { icon: Eye, text: 'Watch every run step by step, at a pace you can follow' },
  { icon: ShieldCheck, text: 'Keep an audit record of each AI decision and approval' },
];

/**
 * Full-screen entry point shown before the Keycloak session exists. The
 * workspace (canvas, dialogs, project tree) is not mounted until the user
 * signs in, so a fresh session starts here: what Abada does, an example run
 * playing on a loop, and the way in.
 */
export const SignInGate: React.FC = () => {
  const item = useMotionVariants(enterExit);
  const signIn = () => keycloak.login({ redirectUri: window.location.origin });

  return (
    <div className="relative h-screen w-screen overflow-y-auto bg-charcoal text-linen"
      style={{
        backgroundImage: 'radial-gradient(ellipse 60% 45% at 50% 0%, rgba(157, 78, 221, 0.16), transparent 70%), radial-gradient(circle, rgba(168, 159, 145, 0.10) 1.2px, transparent 1.2px)',
        backgroundSize: '100% 100%, 24px 24px',
      }}>
      <m.main variants={listStagger} initial="initial" animate="enter"
        className="mx-auto grid min-h-full max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-16">
        <m.div variants={listStagger} className="flex flex-col items-start gap-6">
          <m.div variants={item} className="flex items-center gap-3">
            <img src="/abada-app-icon.svg" alt="" className="h-12 w-12 rounded-[11px] glow-amethyst-subtle" />
            <div>
              <p className="text-xl font-bold tracking-wide">ABADA</p>
              <p className="text-[11px] text-sand">Studio</p>
            </div>
          </m.div>

          <m.h1 variants={item} className="max-w-xl text-3xl font-semibold leading-tight tracking-tight text-balance sm:text-4xl">
            AI processes you can watch, govern and audit.
          </m.h1>
          <m.p variants={item} className="max-w-lg text-sm leading-relaxed text-sand">
            Agents advise, rules decide, humans approve and PostgreSQL remembers. Abada runs your processes on your own
            infrastructure and shows you every step.
          </m.p>

          <m.ul variants={listStagger} className="flex flex-col gap-2.5">
            {POINTS.map(({ icon: Icon, text }) => (
              <m.li key={text} variants={item} className="flex items-center gap-2.5 text-[13px] text-linen-muted">
                <span className="grid h-6 w-6 place-items-center rounded-control border border-hairline bg-mocha-deep text-saffron">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {text}
              </m.li>
            ))}
          </m.ul>

          <m.div variants={item} className="flex flex-col items-start gap-2 pt-2">
            <button type="button" data-cuelume-tap onClick={signIn}
              className="group inline-flex items-center gap-2 rounded-card bg-amethyst px-6 py-3 text-sm font-semibold text-white shadow-warm-md transition-[background-color,transform,box-shadow] duration-[var(--duration-fast)] hover:-translate-y-px hover:bg-amethyst-bright hover:shadow-warm-lg active:translate-y-0 motion-reduce:transform-none">
              Sign in to the Studio
              <ArrowRight className="h-4 w-4 transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5 motion-reduce:transform-none" aria-hidden="true" />
            </button>
            <p className="text-[11px] text-sand">Single sign-on with your organisation's identity provider.</p>
          </m.div>
        </m.div>

        <m.div variants={item} className="flex justify-center lg:justify-end">
          <SignInPreview />
        </m.div>
      </m.main>
    </div>
  );
};
