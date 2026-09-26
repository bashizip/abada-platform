import { ArrowUpRight, Check, Minus } from "lucide-react";
import { RELEASE_NOTES_URL } from "../../lib/links";
import { RELEASE_VERSION } from "../../lib/release";
import { Reveal, Section, SectionHead } from "./primitives";

const READY = [
  "Self-hosted deployment with PostgreSQL",
  "Multiple engine replicas with durable work leases",
  "OIDC sign-in and backend role-based permissions",
  "APL processes: AI agents, rules, decision tables, human tasks",
  "BPMN import (documented subset)",
];

const NOT_YET = [
  "Enforced SLAs and bounded rework loops (1.1.0-rc.1)",
  "Tool-using agents with approved writes (1.1.0-rc.2)",
  "Public-cloud certification and independent security review",
  "Full BPMN 2.0 coverage",
];

export function Limits() {
  return (
    <Section id="status" alt>
      <SectionHead
        eyebrow="Status"
        title={`${RELEASE_VERSION} — evaluation release`}
      />

      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        <Reveal>
          <div className="h-full rounded-xl border border-hairline bg-surface/40 p-6">
            <p className="mono-label text-signal!">Available</p>
            <ul className="mt-5 space-y-3">
              {READY.map((item) => (
                <li key={item} className="flex gap-3">
                  <Check className="mt-0.5 size-4 shrink-0 text-signal" strokeWidth={2.5} />
                  <span className="text-[14px] leading-relaxed text-t1">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal delay={90}>
          <div className="h-full rounded-xl border border-hairline bg-surface/40 p-6">
            <p className="mono-label">Planned or not yet covered</p>
            <ul className="mt-5 space-y-3">
              {NOT_YET.map((item) => (
                <li key={item} className="flex gap-3">
                  <Minus className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={2.5} />
                  <span className="text-[14px] leading-relaxed text-t2">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>

      <a
        href={RELEASE_NOTES_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] text-t2 transition-colors hover:text-t1"
      >
        Release notes <ArrowUpRight className="size-3.5" />
      </a>
    </Section>
  );
}
