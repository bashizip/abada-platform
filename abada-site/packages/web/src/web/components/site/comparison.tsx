import { ArrowRight, Check, Minus, X } from "lucide-react";
import { Reveal, Section, SectionHead } from "./primitives";

type Cell = "yes" | "no" | "partial";

const ROWS: { capability: string; note?: string; frameworks: Cell; legacy: Cell; abada: Cell }[] = [
  {
    capability: "Durable, ACID-committed process state",
    note: "State, work, history and outbox commit together",
    frameworks: "no",
    legacy: "yes",
    abada: "yes",
  },
  {
    capability: "Survives restarts and multi-day waits",
    note: "Leases, retries, restart-safe acquisition",
    frameworks: "no",
    legacy: "yes",
    abada: "yes",
  },
  {
    capability: "AI agent as a first-class process participant",
    note: "Same durable work model as any external participant",
    frameworks: "yes",
    legacy: "no",
    abada: "yes",
  },
  {
    capability: "Prompt, output schema and confidence under version control",
    frameworks: "no",
    legacy: "no",
    abada: "yes",
  },
  {
    capability: "Deterministic routing from validated model output",
    note: "Structured outputs, not free text parsing",
    frameworks: "partial",
    legacy: "partial",
    abada: "yes",
  },
  {
    capability: "Human approval and exception handling as a primitive",
    frameworks: "no",
    legacy: "yes",
    abada: "yes",
  },
  {
    capability: "Full attempt evidence persisted per model call",
    note: "Provider, attempt, duration, confidence, tools, error type, prompt hash",
    frameworks: "no",
    legacy: "no",
    abada: "yes",
  },
  {
    capability: "Process improves itself from execution evidence",
    frameworks: "no",
    legacy: "no",
    abada: "yes",
  },
  {
    capability: "No silent mutation — change requires human approval",
    frameworks: "no",
    legacy: "partial",
    abada: "yes",
  },
  {
    capability: "Self-hosted, data-location control",
    frameworks: "partial",
    legacy: "yes",
    abada: "yes",
  },
];

function Mark({ value, strong }: { value: Cell; strong?: boolean }) {
  if (value === "yes")
    return (
      <Check
        className={strong ? "mx-auto size-[18px] text-signal" : "mx-auto size-[18px] text-t2"}
        strokeWidth={2.5}
      />
    );
  if (value === "partial") return <Minus className="mx-auto size-[18px] text-amber" strokeWidth={2.5} />;
  return <X className="mx-auto size-[18px] text-t3" strokeWidth={2.5} />;
}

export function Comparison({ showVsLink = true }: { showVsLink?: boolean }) {
  return (
    <Section id="comparison">
      <SectionHead
        eyebrow="Why not Camunda, why not a swarm"
        title="The moat is the intersection"
        lead="Each capability below exists somewhere in the market. The defensible position is holding all of them in one runtime, under one versioned process definition."
      />

      <Reveal>
        <div className="mt-12 overflow-x-auto rounded-xl border border-hairline bg-surface/40">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline">
                <th className="w-[46%] px-5 py-4 font-mono text-[10.5px] tracking-[0.16em] text-t3 uppercase">
                  Capability
                </th>
                <th className="px-4 py-4 text-center">
                  <span className="block font-mono text-[10.5px] tracking-[0.16em] text-t3 uppercase">
                    Agent frameworks
                  </span>
                  <span className="mt-1 block text-[11px] text-t3">LangGraph · CrewAI</span>
                </th>
                <th className="px-4 py-4 text-center">
                  <span className="block font-mono text-[10.5px] tracking-[0.16em] text-t3 uppercase">
                    Legacy engines
                  </span>
                  <span className="mt-1 block text-[11px] text-t3">Camunda · Temporal</span>
                </th>
                <th className="border-l border-signal/25 bg-signal/[0.05] px-4 py-4 text-center">
                  <span className="block font-mono text-[10.5px] tracking-[0.16em] text-signal uppercase">
                    Abada
                  </span>
                  <span className="mt-1 block text-[11px] text-t3">Open source</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.capability} className="border-b border-hairline/70 last:border-b-0">
                  <td className="px-5 py-4 align-top">
                    <p className="text-[14px] leading-snug text-t1">{row.capability}</p>
                    {row.note ? (
                      <p className="mt-1 font-mono text-[10.5px] leading-relaxed text-t3">
                        {row.note}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4 text-center align-top">
                    <Mark value={row.frameworks} />
                  </td>
                  <td className="px-4 py-4 text-center align-top">
                    <Mark value={row.legacy} />
                  </td>
                  <td className="border-l border-signal/25 bg-signal/[0.05] px-4 py-4 text-center align-top">
                    <Mark value={row.abada} strong />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>

      <div className="mt-6 flex flex-wrap items-center gap-6">
        <span className="inline-flex items-center gap-2 text-[12px] text-t3">
          <Check className="size-3.5 text-t2" strokeWidth={2.5} /> Supported
        </span>
        <span className="inline-flex items-center gap-2 text-[12px] text-t3">
          <Minus className="size-3.5 text-amber" strokeWidth={2.5} /> Partial or deployment-dependent
        </span>
        <span className="inline-flex items-center gap-2 text-[12px] text-t3">
          <X className="size-3.5 text-t3" strokeWidth={2.5} /> Not part of the model
        </span>
      </div>

      <p className="mt-8 max-w-3xl text-[13px] leading-relaxed text-t3">
        Assessment of default capabilities as designed, not a benchmark. Abada does not claim full
        BPMN 2.0 coverage: unsupported execution semantics fail explicitly rather than being
        accepted ambiguously.
      </p>

      {showVsLink ? (
        <a
          href="/vs-camunda"
          className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] text-signal transition-opacity hover:opacity-80"
        >
          Full side-by-side: Abada vs Camunda <ArrowRight className="size-3.5" />
        </a>
      ) : null}
    </Section>
  );
}
