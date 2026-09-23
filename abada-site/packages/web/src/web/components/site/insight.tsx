import { Reveal, Section, SectionHead } from "./primitives";
import { CheckCircle2, Database, FileDiff, GitCommitVertical, Search } from "lucide-react";

const STAGES = [
  { icon: Database, name: "Facts", detail: "Terminal status · latency · fallback" },
  { icon: Search, name: "Findings", detail: "Failure rate · p95 regression · thrash" },
  { icon: FileDiff, name: "Proposal", detail: "Parser-validated · checksum-bound" },
  { icon: CheckCircle2, name: "Human review", detail: "Approve or reject under reviewer policy" },
  { icon: GitCommitVertical, name: "New version", detail: "Immutable deploy · running work untouched" },
];

const SIGNALS = [
  "External-task failure rate",
  "p95 latency above the historical baseline",
  "Decision-table fallback thrash",
];

export function Insight() {
  return (
    <Section id="insight">
      <div className="grid gap-14 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <SectionHead
            eyebrow="Insight engine · the governed improvement loop"
            title={
              <>
                Evidence becomes a proposal —
                <br />
                <span className="text-t3">never a silent rewrite</span>
              </>
            }
            lead="This is where a durable engine earns something a swarm cannot fake: the process observes its own execution, asks the model for a bounded improvement, validates the proposed source, and puts a diff in front of an accountable human."
          />

          <div className="mt-8 rounded-xl border border-hairline bg-surface/40 p-5">
            <p className="mono-label">Currently implemented signals</p>
            <ul className="mt-4 space-y-2.5">
              {SIGNALS.map((s, i) => (
                <li key={s} className="flex items-baseline gap-3 text-[14px] text-t2">
                  <span className="font-mono text-[11px] text-signal">{`0${i + 1}`}</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Reveal className="lg:col-span-6" delay={120}>
          <div className="rounded-xl border border-hairline bg-surface/50 p-6">
            <div className="space-y-0">
              {STAGES.map((stage, i) => {
                const Icon = stage.icon;
                const last = i === STAGES.length - 1;
                return (
                  <div key={stage.name} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-ink">
                        <Icon className={last ? "size-4 text-signal" : "size-4 text-t2"} />
                      </span>
                      {!last ? <span className="my-1 w-px flex-1 bg-hairline" /> : null}
                    </div>
                    <div className={last ? "pb-0" : "pb-6"}>
                      <p className="text-[14.5px] font-medium">{stage.name}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] leading-relaxed text-t3">
                        {stage.detail}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-2 rounded-lg border border-signal/25 bg-signal/[0.05] px-4 py-4">
              <div className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-signal" />
                <p className="font-mono text-[10px] tracking-[0.16em] text-signal uppercase">
                  Real local execution · Gemini 3.6 Flash
                </p>
              </div>
              <p className="mt-3 font-mono text-[12px] leading-relaxed text-t2">
                4 LOW runs → FALLBACK_THRASH detected → LLM proposal generated → proposal remains
                unapproved.
              </p>
              <p className="mt-2 text-[12.5px] text-t3">
                Adoption is a human decision. Rejection is a valid outcome.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
