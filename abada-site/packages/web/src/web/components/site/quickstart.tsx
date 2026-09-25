import { useState } from "react";
import { ArrowUpRight, Check, Copy, Terminal } from "lucide-react";
import { Reveal } from "./primitives";
import { DEMO_URL, DOCS_URL, GITHUB_URL, INSTALL_CMD } from "../../lib/links";

const STEPS = [
  {
    n: "1",
    title: "Run the installer",
    body: "Docker is the only prerequisite. The verified script pulls and starts the full stack.",
  },
  {
    n: "2",
    title: "Open Studio",
    body: "Studio, the engine, the agent worker and PostgreSQL come up together on your machine.",
  },
  {
    n: "3",
    title: "Execute a real process",
    body: "Run the Lead Triage example end to end — AI agent (Gemini by default), human task, persisted evidence.",
  },
];

export function Quickstart() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      id="quickstart"
      className="relative scroll-mt-20 overflow-hidden border-y border-signal/25 px-6 py-20 md:py-24"
      style={{
        background:
          "linear-gradient(180deg, rgba(52,211,153,0.13) 0%, rgba(52,211,153,0.045) 45%, rgba(5,7,10,1) 100%)",
      }}
    >
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
      <div className="glow-signal pointer-events-none absolute -top-52 left-1/2 h-[520px] w-[1000px] -translate-x-1/2" />

      <div className="relative mx-auto w-full max-w-[1200px]">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-signal/40 bg-signal/10 px-3 py-1.5">
              <Terminal className="size-3.5 text-signal" />
              <span className="font-mono text-[10px] tracking-[0.16em] text-signal uppercase">
                Quickstart · self-hosted
              </span>
            </div>

            <h2 className="h-section mt-6">
              Evaluate it on your own machine.
              <br />
              <span className="text-signal">No account, no sales call.</span>
            </h2>

            <p className="prose-lead mt-5 text-t2">
              One command brings up Studio, the engine, the agent worker and PostgreSQL on your own
              machine. Then run a real AI-driven process end to end and inspect every decision it
              recorded — the same components you would deploy on your servers.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a
                href={DOCS_URL}
                className="inline-flex items-center gap-1.5 text-[14px] font-medium text-t1 underline decoration-signal/40 underline-offset-4 transition-colors hover:decoration-signal"
              >
                Quickstart guide <ArrowUpRight className="size-3.5" />
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[14px] text-t2 transition-colors hover:text-t1"
              >
                Source on GitHub <ArrowUpRight className="size-3.5" />
              </a>
              <a
                href={DEMO_URL}
                className="inline-flex items-center gap-1.5 text-[14px] text-t2 transition-colors hover:text-t1"
              >
                Read the quickstart below
              </a>
            </div>
          </div>

          <Reveal className="w-full lg:max-w-[560px]">
            <div className="overflow-hidden rounded-xl border border-signal/30 bg-[#04120d] shadow-[0_0_60px_-15px_rgba(52,211,153,0.35)]">
              <div className="flex items-center gap-2 border-b border-signal/20 bg-signal/[0.07] px-4 py-2.5">
                <span className="size-2 rounded-full bg-signal/70" />
                <span className="size-2 rounded-full bg-signal/30" />
                <span className="size-2 rounded-full bg-signal/30" />
                <span className="ml-2 font-mono text-[10px] tracking-[0.16em] text-signal/80 uppercase">
                  bash
                </span>
              </div>

              <div className="p-5">
                <code className="flex gap-3 font-mono text-[12.5px] leading-relaxed break-all">
                  <span className="shrink-0 text-signal">$</span>
                  <span className="text-t1">{INSTALL_CMD}</span>
                </code>

                <button
                  type="button"
                  onClick={copy}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-signal px-4 py-3 text-[14px] font-semibold text-[#04150f] transition-opacity hover:opacity-90"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "Copied to clipboard" : "Copy install command"}
                </button>

                <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-t3">
                  Prefer not to pipe a script to your shell? Clone the repo and run{" "}
                  <span className="text-t2">docker compose up</span> — same stack.
                </p>
              </div>
            </div>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-signal/20 bg-signal/20 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 80}>
              <div className="h-full bg-[#070d0b] p-6">
                <span className="flex size-7 items-center justify-center rounded-md bg-signal/15 font-mono text-[12px] font-medium text-signal">
                  {step.n}
                </span>
                <p className="mt-4 text-[15px] font-semibold">{step.title}</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-t2">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
