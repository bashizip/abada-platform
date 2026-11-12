import React, { useEffect, useState } from 'react';
import { m } from 'motion/react';
import { Bot, Database, GitBranch, UserCheck } from 'lucide-react';
import { duration, easing, enterExit, useMotionVariants, useReducedMotion } from '@/lib/motion';

/**
 * The sign-in screen's example run: the four roles of an Abada process, played
 * on a loop at the Studio's own playback pace, with the audit entries arriving
 * in step with the diagram, as they do in Operations. Sample content, labelled
 * as such; under reduced motion it shows the finished run and stays still.
 *
 * Smoothness: only `transform` and `opacity` animate (the edge scales, the
 * token translates), and every audit row is laid out from the start, so the
 * card keeps its height and nothing around it moves while the run plays.
 */

interface Step {
  title: string;
  role: string;
  icon: React.ElementType;
  /** Tailwind classes for the lit node. */
  tone: string;
  /** The audit entry's dot. */
  dot: string;
  entry: string;
  detail: string;
}

const STEPS: Step[] = [
  { title: 'Classify lead', role: 'Agent', icon: Bot, tone: 'border-amethyst-light text-amethyst-light bg-amethyst/15', dot: 'bg-amethyst-light',
    entry: 'Agent advised', detail: 'segment enterprise · confidence 91%' },
  { title: 'Check score', role: 'Rule', icon: GitBranch, tone: 'border-saffron text-saffron bg-saffron/15', dot: 'bg-saffron',
    entry: 'Rule 2 decided', detail: 'score >= 80 → route to sales' },
  { title: 'Approve', role: 'Human', icon: UserCheck, tone: 'border-mineral-teal-bright text-mineral-teal-bright bg-mineral-teal/15', dot: 'bg-mineral-teal-bright',
    entry: 'alice approved', detail: 'outcome approve · with a comment' },
  { title: 'Record', role: 'PostgreSQL', icon: Database, tone: 'border-sage-green text-sage-green bg-sage-green/15', dot: 'bg-sage-green',
    entry: 'Run completed', detail: 'every fact kept in PostgreSQL' },
];

/** How long each step holds: the Studio's calm playback dwell plus the token's travel. */
const STEP_MS = duration.calm + 400;
const FIRST_STEP_MS = 900;
/** How long the finished run stays on screen before it starts again. */
export const HOLD_MS = 3000;

export const SignInPreview: React.FC = () => {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(reduced ? STEPS.length : 0);
  const [run, setRun] = useState(0);
  const itemVariants = useMotionVariants(enterExit);

  useEffect(() => {
    if (reduced) { setStep(STEPS.length); return; }
    const timer = step >= STEPS.length
      ? window.setTimeout(() => { setStep(0); setRun((current) => current + 1); }, HOLD_MS)
      : window.setTimeout(() => setStep((current) => current + 1), step === 0 ? FIRST_STEP_MS : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [step, reduced, run]);

  const done = step >= STEPS.length;

  return (
    <div className="w-full max-w-[34rem] rounded-panel border border-hairline bg-mocha-deep/95 shadow-warm-lg">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        <span className="text-[12px] font-semibold text-linen">Lead triage</span>
        <span className="rounded border border-amethyst/40 px-1 text-[10px] text-amethyst-light">v3</span>
        <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wider transition-colors duration-[var(--duration-base)] ${
          done ? 'border-sage-green/40 bg-sage-green/10 text-sage-green' : 'border-amethyst/40 bg-amethyst/10 text-amethyst-light'}`}>
          <span className={`h-1.5 w-1.5 rounded-full bg-current ${done ? '' : 'animate-pulse motion-reduce:animate-none'}`} />
          {done ? 'Completed' : 'Running'}
        </span>
      </div>

      {/* The diagram: nodes light up one at a time, the taken edge draws behind the token. */}
      <div className="relative px-4 pb-3 pt-5"
        style={{ backgroundImage: 'radial-gradient(circle, rgba(168, 159, 145, 0.10) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        <ol className="grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto] items-start" aria-label="Example run">
          {STEPS.map((item, index) => {
            const lit = step > index;
            const active = step === index + 1 && !done;
            const Icon = item.icon;
            return (
              <React.Fragment key={item.title}>
                <li className="flex w-[4.5rem] flex-col items-center gap-1.5 text-center sm:w-20" aria-current={active ? 'step' : undefined}>
                  <m.span
                    initial={false}
                    animate={{ scale: lit && !reduced ? [0.9, 1] : 1 }}
                    transition={{ duration: duration.base / 1000, ease: [...easing.emphasised] }}
                    className={`relative grid h-10 w-10 place-items-center rounded-card border transition-colors duration-[var(--duration-base)] ${
                      lit ? item.tone : 'border-hairline bg-charcoal text-sand'} ${index === 1 ? 'rotate-45 rounded-control' : ''}`}>
                    <Icon className={`h-4 w-4 ${index === 1 ? '-rotate-45' : ''}`} aria-hidden="true" />
                    {active && !reduced && (
                      <m.span className="absolute inset-0 rounded-[inherit] border border-current"
                        initial={{ opacity: 0.8, scale: 1 }} animate={{ opacity: 0, scale: 1.45 }}
                        transition={{ duration: duration.calm / 1000, ease: [...easing.standard] }} />
                    )}
                  </m.span>
                  <span className={`text-[10.5px] font-semibold leading-tight transition-colors ${lit ? 'text-linen' : 'text-sand'}`}>{item.title}</span>
                  <span className="text-[9.5px] uppercase tracking-wider text-sand">{item.role}</span>
                </li>
                {index < STEPS.length - 1 && (
                  <li aria-hidden="true" className="relative mx-1 mt-5 h-0.5 rounded-full bg-hairline">
                    <m.span data-edge className="absolute inset-0 origin-left rounded-full bg-mineral-teal-bright"
                      initial={{ scaleX: reduced ? 1 : 0 }}
                      animate={{ scaleX: step > index + 1 ? 1 : 0 }}
                      transition={{ duration: reduced || step <= index + 1 ? 0 : 0.4, ease: [...easing.standard] }} />
                    {step === index + 1 && !reduced && (
                      // The track minus the token's width: translating it by 100% lands the token at the end.
                      <m.span key={`token-${run}-${index}`} data-token
                        className="absolute -top-[3px] left-0 right-2 h-2 will-change-transform"
                        initial={{ x: '0%', opacity: 0 }}
                        animate={{ x: ['0%', '0%', '100%'], opacity: [0, 1, 1] }}
                        transition={{ duration: STEP_MS / 1000, times: [0, 0.55, 0.95], ease: 'easeInOut' }}>
                        <span className="absolute left-0 top-0 h-2 w-2 rounded-full bg-mineral-teal-bright shadow-[0_0_8px_var(--color-mineral-teal-bright)]" />
                      </m.span>
                    )}
                  </li>
                )}
              </React.Fragment>
            );
          })}
        </ol>
      </div>

      {/* The audit trail, entry by entry. */}
      {/* Every row is laid out from the start (hidden until reached) so the card never changes height. */}
      <div className="relative border-t border-hairline px-4 py-3">
        <ol className="space-y-1" aria-live="polite" aria-label="Audit trail">
          {STEPS.map((item, index) => {
            const shown = step > index;
            return (
              <m.li key={item.entry} variants={itemVariants} initial="exit" animate={shown ? 'enter' : 'exit'}
                aria-hidden={!shown} data-shown={shown || undefined}
                className="flex items-baseline gap-2 text-[11.5px]">
                <span className={`h-1.5 w-1.5 shrink-0 -translate-y-px rounded-full ${item.dot}`} />
                <span className="font-semibold text-linen">{item.entry}</span>
                <span className="min-w-0 truncate text-sand">{item.detail}</span>
              </m.li>
            );
          })}
        </ol>
        {step === 0 && <p className="absolute left-4 top-3 text-[11.5px] text-sand">Starting…</p>}
      </div>

      <p className="border-t border-hairline px-4 py-2 text-[10.5px] text-sand">
        Example run · the Studio replays real runs the same way
      </p>
    </div>
  );
};
