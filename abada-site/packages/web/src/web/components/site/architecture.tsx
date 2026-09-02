import { Reveal, Section, SectionHead } from "./primitives";
import { Activity, Database, GitBranch, Users } from "lucide-react";

const LIFECYCLE = [
  {
    n: "01",
    label: "Create or import",
    layer: "Studio",
    icon: GitBranch,
    body: "Visual designer, AI-assisted authoring, reviewable native APL source, or the documented BPMN subset. Dry Run stays local and mocked.",
  },
  {
    n: "02",
    label: "Run",
    layer: "Engine + PostgreSQL",
    icon: Activity,
    body: "Gemini agents, deterministic decisions, human tasks, events and external systems advance the same versioned process state.",
  },
  {
    n: "03",
    label: "Observe",
    layer: "Durable facts",
    icon: Database,
    body: "Persisted results, confidence, attempts, latency, failures, incidents and human work — queryable after the fact.",
  },
  {
    n: "04",
    label: "Improve",
    layer: "Insight Engine",
    icon: Users,
    body: "Bounded execution signals become validated proposals that an authorized person approves or rejects.",
  },
];

const PIPELINE = [
  { name: "Studio", detail: "Model · prompt · output contract" },
  { name: "Engine", detail: "Durable agent work · PostgreSQL state" },
  { name: "Agent Worker", detail: "Bounded timeout · validation · retry" },
  { name: "Gemini", detail: "Structured result · confidence" },
];

export function Architecture() {
  return (
    <Section id="architecture" alt>
      <SectionHead
        eyebrow="One operational lifecycle"
        title="From process idea to better process"
        lead="Abada connects design, execution, operations and controlled evolution in one runtime instead of leaving teams to assemble four separate tools."
      />

      <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:grid-cols-2 lg:grid-cols-4">
        {LIFECYCLE.map((step, i) => {
          const Icon = step.icon;
          return (
            <Reveal key={step.n} delay={i * 80} className="bg-ink">
              <div className="h-full bg-surface/40 p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-signal">{step.n}</span>
                  <Icon className="size-4 text-t3" />
                </div>
                <p className="mt-5 text-[1.05rem] font-semibold tracking-[-0.01em]">{step.label}</p>
                <p className="mono-label mt-1">{step.layer}</p>
                <p className="mt-4 text-[13.5px] leading-relaxed text-t2">{step.body}</p>
              </div>
            </Reveal>
          );
        })}
      </div>

      <div className="mt-20 grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionHead
            eyebrow="Governed AI execution"
            title="Gemini becomes a governed workflow participant"
            lead="The model call is not hidden behind an opaque automation. Its prompt, selected inputs, output contract, confidence threshold and recovery policy are part of the versioned process."
          />
          <ul className="mt-8 space-y-3.5">
            {[
              "Structured outputs for deterministic downstream routing",
              "Durable jobs with retry metadata and persisted results",
              "Human review when the business process requires it",
              "Model calls stay outside workflow-state transactions",
            ].map((item) => (
              <li key={item} className="flex gap-3 text-[14px] leading-relaxed text-t2">
                <span className="mt-[8px] size-1.5 shrink-0 rounded-full bg-signal" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <Reveal className="lg:col-span-7" delay={120}>
          <div className="rounded-xl border border-hairline bg-surface/50 p-6">
            <p className="mono-label">Execution path</p>
            <div className="mt-6 space-y-3">
              {PIPELINE.map((node, i) => (
                <div key={node.name}>
                  <div className="flex items-center gap-4 rounded-lg border border-hairline bg-ink px-4 py-3.5">
                    <span className="font-mono text-[11px] text-t3">{`0${i + 1}`}</span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium">{node.name}</p>
                      <p className="font-mono text-[10.5px] text-t3">{node.detail}</p>
                    </div>
                  </div>
                  {i < PIPELINE.length - 1 ? (
                    <div className="ml-8 h-4 w-px bg-wire/40" />
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-lg border border-hairline bg-ink px-4 py-4">
              <p className="mono-label">Persisted attempt metadata</p>
              <p className="mt-2 font-mono text-[11.5px] leading-relaxed text-t2">
                resolved model · provider · attempt · duration · confidence · tools · error type ·
                prompt hash
              </p>
            </div>
            <p className="mt-4 text-[12.5px] text-t3">
              Validated output drives deterministic routing to a person or a system. Delivery is
              at-least-once through a transactional outbox.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
