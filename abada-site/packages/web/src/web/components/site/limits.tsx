import { ArrowUpRight, Check, Minus } from "lucide-react";
import { RELEASE_NOTES_URL } from "../../lib/links";
import { RELEASE_VERSION } from "../../lib/release";
import { Reveal, Section, SectionHead } from "./primitives";

const READY = [
  "Docker Compose deployment on your servers, with PostgreSQL as the authority",
  "Several engine replicas sharing work through durable leases",
  "OIDC sign-in and role-based permissions enforced by the backend",
  "Processes in APL with AI agents, CEL rules, decision tables and human tasks",
  "BPMN import for a documented subset, with unsupported constructs rejected",
];

const NOT_YET = [
  "Enforced SLAs, timeouts and bounded rework loops — planned for 1.1.0-rc.1",
  "Agents that use tools (MCP), with human approval for writes — planned for 1.1.0-rc.2",
  "Certified public-cloud reference deployments, rolling upgrades and an independent security review — not yet scheduled",
  "Full BPMN 2.0 coverage — not planned; APL is the primary language",
];

export function Limits() {
  return (
    <Section id="status" alt>
      <SectionHead
        eyebrow="Where it stands"
        title={`${RELEASE_VERSION} is an evaluation release. Here is exactly what that means.`}
        lead="You should know what you are evaluating before you commit a process to it."
      />

      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        <Reveal>
          <div className="h-full rounded-xl border border-hairline bg-surface/40 p-6">
            <p className="mono-label text-signal!">Ready to evaluate today</p>
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
            <p className="mono-label">Not yet</p>
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
        Full {RELEASE_VERSION} release notes and known limitations <ArrowUpRight className="size-3.5" />
      </a>
    </Section>
  );
}
