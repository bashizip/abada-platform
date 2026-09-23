import { AlertTriangle, Boxes, Lock, ShieldCheck } from "lucide-react";
import { Reveal, Section, SectionHead } from "./primitives";

const COLUMNS = [
  {
    tone: "amber" as const,
    icon: Boxes,
    label: "AI agent frameworks",
    who: "LangGraph · CrewAI · AutoGen",
    title: "Chaotic swarms",
    points: [
      "Process state lives in memory or in a chat log",
      "Retries and routing depend on model improvisation",
      "A restart loses the work in flight",
      "No audit trail an operator or regulator can accept",
    ],
  },
  {
    tone: "muted" as const,
    icon: Lock,
    label: "Process engines",
    who: "Camunda · Temporal · Flowable",
    title: "Heavy to run, governance assembled",
    points: [
      "Durable and transactional, with growing agent support",
      "Production self-hosting often means a licence and a multi-service cluster",
      "Validation, evidence and review of AI output are yours to assemble",
      "Execution analytics rarely become a reviewed change to the process",
    ],
  },
  {
    tone: "signal" as const,
    icon: ShieldCheck,
    label: "Abada",
    who: "Open source · Self-hosted",
    title: "Governed autonomy",
    points: [
      "ACID-committed state, work, history and outbox in one transaction",
      "Prompt, output contract, confidence threshold and retry policy are versioned process assets",
      "The engine validates model output and routes weak or invalid answers to a person",
      "Execution evidence becomes a reviewable improvement proposal",
    ],
  },
];

export function Gap() {
  return (
    <Section id="gap" alt>
      <SectionHead
        eyebrow="Where Abada fits"
        title={
          <>
            Autonomy needs guarantees.
            <br />
            <span className="text-t3">Guarantees need to be light enough to run.</span>
          </>
        }
        lead="A model response takes seconds. A business process runs for days, touches money and people, and has to be explainable afterwards. Agent frameworks give autonomy without durable guarantees; process engines give guarantees but leave the governance of model output to you, on a heavy stack."
      />

      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        {COLUMNS.map((col, i) => {
          const Icon = col.icon;
          const isSignal = col.tone === "signal";
          return (
            <Reveal key={col.label} delay={i * 90}>
              <div
                className={
                  isSignal
                    ? "h-full rounded-xl border border-signal/35 bg-signal/[0.045] p-6"
                    : "h-full rounded-xl border border-hairline bg-surface/50 p-6"
                }
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={
                      col.tone === "amber"
                        ? "size-4 text-amber"
                        : isSignal
                          ? "size-4 text-signal"
                          : "size-4 text-t3"
                    }
                  />
                  <span className="mono-label">{col.label}</span>
                </div>

                <p className="mt-5 text-[1.35rem] font-semibold tracking-[-0.02em]">
                  {col.title}
                </p>
                <p className="mt-1 font-mono text-[11px] text-t3">{col.who}</p>

                <ul className="mt-6 space-y-3.5">
                  {col.points.map((p) => (
                    <li key={p} className="flex gap-2.5 text-[13.5px] leading-relaxed text-t2">
                      <span
                        className={
                          isSignal
                            ? "mt-[7px] size-1.5 shrink-0 rounded-full bg-signal"
                            : "mt-[7px] size-1.5 shrink-0 rounded-full bg-t3"
                        }
                      />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={280}>
        <div className="mt-8 flex items-start gap-3 rounded-lg border border-hairline bg-ink px-5 py-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber" />
          <p className="text-[13.5px] leading-relaxed text-t2">
            The constraint is structural, not cosmetic: a remote model call cannot sit inside a
            database transaction. Abada keeps the model call outside the workflow transaction, then
            re-admits its validated result through a durable worker contract that advances state
            atomically.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
