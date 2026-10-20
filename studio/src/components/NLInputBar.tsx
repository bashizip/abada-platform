import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Sparkles, ArrowRight, Lightbulb, AlertCircle, X, Pin, Minimize2, EyeOff } from 'lucide-react';
import { enterExit, slideFrom, useMotionVariants } from '@/lib/motion';
import { NL_BAR_SHORTCUT_LABEL, isNLBarShortcut, useNLBarMode, type NLBarMode } from '@/lib/authoring/nlBarPrefs';

interface NLInputBarProps {
  /** Opens the AI draft workspace with this prompt; nothing reaches the canvas from the bar itself. */
  onGenerateWorkflow: (prompt: string, mode: 'new' | 'refine') => Promise<void> | void;
  isGenerating: boolean;
  /** The open process has steps, so a prompt can refine it instead of starting a new one. */
  hasActiveWorkflow: boolean;
  /** Why the last request produced no process; cleared when the next one starts. */
  error?: string | null;
  onDismissError?: () => void;
  /** While something else owns the screen (the workspace), the bar and its shortcut stand aside. */
  suspended?: boolean;
  /** Changing this number opens the bar, as ⌘K does (the toolbar's "Draft with AI"). */
  openSignal?: number;
}

const SAMPLE_PROMPTS = [
  'Automated invoice fraud analysis with DMN tax calculation and executive sign-off',
  'Corporate KYC verification with document OCR and sanctions check',
  'Supply chain escalation flow with dual AI risk evaluators and warehouse dispatch',
  'Insurance claim damage assessment with policy deductible matrix',
];

const MODE_CONTROLS: Array<{ mode: NLBarMode; label: string; Icon: typeof Pin }> = [
  { mode: 'pinned', label: 'Pin the bar open', Icon: Pin },
  { mode: 'collapsed', label: 'Collapse the bar to a button', Icon: Minimize2 },
  { mode: 'hidden', label: 'Hide the bar (⌘K brings it back)', Icon: EyeOff },
];

/**
 * The natural-language bar (M5 S12). Pinned, it stays open at the bottom of the canvas;
 * collapsed, it is a small button; hidden, nothing shows. ⌘K / Ctrl+K opens it for one prompt
 * whatever the mode ("peek"); Esc puts it back. The mode is remembered per user.
 */
export const NLInputBar: React.FC<NLInputBarProps> = ({
  onGenerateWorkflow,
  isGenerating,
  hasActiveWorkflow,
  error,
  onDismissError,
  suspended = false,
  openSignal,
}) => {
  const [prompt, setPrompt] = useState<string>('');
  const [mode, setMode] = useState<'new' | 'refine'>(hasActiveWorkflow ? 'refine' : 'new');
  const [barMode, setBarMode] = useNLBarMode();
  const [peek, setPeek] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const barVariants = useMotionVariants(slideFrom('bottom'));
  const buttonVariants = useMotionVariants(enterExit);

  // A process with steps is refined by default; an empty one is filled in.
  useEffect(() => { setMode(hasActiveWorkflow ? 'refine' : 'new'); }, [hasActiveWorkflow]);

  const open = !suspended && (barMode === 'pinned' || peek);

  const reveal = () => {
    setPeek(true);
    window.requestAnimationFrame(() => input.current?.focus());
  };

  useEffect(() => {
    if (suspended) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (isNLBarShortcut(event)) {
        event.preventDefault();
        reveal();
      } else if (event.key === 'Escape' && peek) {
        setPeek(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [suspended, peek]);

  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal !== undefined && openSignal !== lastSignal.current) reveal();
    lastSignal.current = openSignal;
  }, [openSignal]);

  const submit = async (text: string, submitMode: 'new' | 'refine') => {
    if (!text.trim() || isGenerating) return;
    setPeek(false);
    setPrompt('');
    await onGenerateWorkflow(text.trim(), submitMode);
  };

  const chooseMode = (next: NLBarMode) => {
    setBarMode(next);
    setPeek(false);
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <div key="bar" className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 w-full max-w-3xl px-4 pointer-events-none">
            <m.div variants={barVariants} initial="initial" animate="enter" exit="exit"
              role="region" aria-label="Draft with AI"
              className="bg-mocha border border-hairline rounded-2xl p-2.5 shadow-warm-lg pointer-events-auto space-y-2">
              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-desert-rose/40 bg-desert-rose/10 px-3 py-2 text-[11px] text-linen">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-desert-rose" />
                  <span className="min-w-0 whitespace-pre-line">{error}</span>
                  {onDismissError && (
                    <button type="button" onClick={onDismissError} aria-label="Dismiss"
                      className="ml-auto shrink-0 text-sand hover:text-linen">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              <form onSubmit={(event) => { event.preventDefault(); void submit(prompt, mode); }} className="flex items-center gap-2">
                <div className="pl-2 flex items-center justify-center text-amethyst">
                  <Sparkles className="w-5 h-5" />
                </div>

                {hasActiveWorkflow && (
                  <select
                    aria-label="What the prompt does"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as 'new' | 'refine')}
                    className="bg-charcoal border border-hairline rounded-lg px-2 py-1 text-xs text-linen focus:outline-none"
                  >
                    <option value="refine">Refine this process</option>
                    <option value="new">New process</option>
                  </select>
                )}

                <input
                  ref={input}
                  id="workflow-prompt"
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={mode === 'new' ? 'Describe a new business process…' : "E.g. 'Add a human approval step after fraud analysis'…"}
                  className="flex-1 min-w-0 bg-transparent border-none text-xs text-linen placeholder-sand focus:outline-none px-2 font-medium"
                  disabled={isGenerating}
                />

                <button
                  type="submit"
                  disabled={!prompt.trim() || isGenerating}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0 ${
                    !prompt.trim() || isGenerating
                      ? 'bg-hairline text-sand cursor-not-allowed'
                      : 'bg-gradient-to-r from-amethyst to-saffron text-white hover:opacity-90 active:scale-95 shadow-warm-md glow-amethyst-subtle'
                  }`}
                >
                  <span>Draft</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>

                <div role="group" aria-label="Bar display" className="flex shrink-0 overflow-hidden rounded-lg border border-hairline">
                  {MODE_CONTROLS.map(({ mode: option, label, Icon }) => (
                    <button key={option} type="button" aria-label={label} title={label}
                      aria-pressed={barMode === option}
                      onClick={() => chooseMode(option)}
                      className={`flex h-7 w-7 items-center justify-center transition-colors ${
                        barMode === option ? 'bg-mocha-hover text-linen' : 'text-sand hover:text-linen'}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  ))}
                </div>
              </form>

              <div className="flex items-center gap-1.5 overflow-x-auto pt-1 text-[10px] text-sand no-scrollbar">
                <span className="flex items-center gap-1 font-semibold text-saffron shrink-0">
                  <Lightbulb className="w-3 h-3 text-saffron" />
                  Try:
                </span>
                {SAMPLE_PROMPTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void submit(s, 'new')}
                    className="px-2 py-0.5 rounded-full bg-charcoal hover:bg-mocha-hover border border-hairline text-linen hover:border-amethyst/50 transition-all shrink-0 whitespace-nowrap"
                  >
                    {s.length > 42 ? `${s.slice(0, 42)}…` : s}
                  </button>
                ))}
              </div>
            </m.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!suspended && barMode === 'collapsed' && !peek && (
          <m.button key="fab" type="button" variants={buttonVariants} initial="initial" animate="enter" exit="exit"
            onClick={reveal} aria-label={`Draft with AI (${NL_BAR_SHORTCUT_LABEL})`}
            className="absolute bottom-5 right-5 z-20 flex h-10 items-center gap-2 rounded-full border border-amethyst/50 bg-mocha pl-3 pr-3.5 text-xs text-linen shadow-warm-lg hover:bg-mocha-hover">
            <Sparkles className="h-4 w-4 text-amethyst" />
            Draft with AI
            <kbd className="rounded border border-hairline-strong px-1 font-mono text-[10px] text-sand">{NL_BAR_SHORTCUT_LABEL}</kbd>
          </m.button>
        )}
      </AnimatePresence>
    </>
  );
};
