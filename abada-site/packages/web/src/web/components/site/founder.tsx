import { Reveal, Section, SectionHead } from "./primitives";
import { ArrowUpRight, Mail } from "lucide-react";
import { CALENDAR_URL, EMAIL, GITHUB_URL } from "../../lib/links";

const CREDS = [
  {
    k: "Battle-tested critical infrastructure",
    h: "Built for high-stakes environments",
    v: "Architected and operated complex distributed platforms at scale — from high-volume payment switches and fintech systems to national-scale digital infrastructure. When running systems where failure is costly, “eventual consistency” isn’t enough: strict state determinism and transactional integrity are mandatory.",
  },
  {
    k: "Senior SRE & systems architecture",
    h: "Resilience & observability by design",
    v: "Grounded in deep Site Reliability Engineering principles. Built to withstand real-world network instability, edge-case failures and concurrency spikes without losing state — applying that exact architectural discipline directly to autonomous agent execution.",
  },
  {
    k: "Production engineering rigor",
    h: "Engineered with zero-fluff precision",
    v: "Shipped the complete Abada platform — Engine, Studio, Agent Worker and the self-correcting Insight loop — as a production-grade system backed by pure GitOps governance and a strict 323-test automated release gate.",
  },
];

const FOCUS = [
  {
    n: "01",
    title: "Governed function calling",
    body: "Structured external actions with operator-controlled tools, inside the durable process boundary.",
  },
  {
    n: "02",
    title: "Multimodal agent nodes",
    body: "Document and image understanding as process steps — KYC files, invoices, field photos.",
  },
  {
    n: "03",
    title: "African-language evaluation",
    body: "Measure and improve process interactions across local languages, with results persisted as evidence.",
  },
];

export function Founder() {
  return (
    <Section id="founder" alt>
      <div className="grid gap-14 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <SectionHead
            eyebrow="Founder"
            title="Patrick Bashizi"
            lead="Democratic Republic of the Congo. A decade of engineering mission-critical platforms, now applied to the execution layer autonomous agents are missing."
          />

          <figure className="mt-8 border-l-2 border-signal/60 pl-5">
            <blockquote className="text-[1.0625rem] leading-relaxed text-t1">
              &ldquo;I didn&rsquo;t arrive at durable orchestration from an AI framework — I arrived
              from a decade of engineering high-stakes, mission-critical platforms where a dropped
              transaction is real revenue lost and every execution path must be
              reconstructible.&rdquo;
            </blockquote>
          </figure>

          <div className="mt-8 space-y-px overflow-hidden rounded-xl border border-hairline bg-hairline">
            {CREDS.map((c) => (
              <div key={c.k} className="bg-surface/40 p-5">
                <p className="mono-label">{c.k}</p>
                <p className="mt-3 text-[14.5px] font-medium text-t1">{c.h}</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-t2">{c.v}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={CALENDAR_URL}
              className="inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3 text-[14.5px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
            >
              <Mail className="size-4" />
              {EMAIL}
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-hairline-strong px-5 py-3 text-[14.5px] text-t1 transition-colors hover:border-signal/50"
            >
              GitHub <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        </div>

        <Reveal className="lg:col-span-6" delay={120}>
          <div className="rounded-xl border border-hairline bg-surface/50 p-6">
            <p className="mono-label text-signal!">Three-month focus</p>
            <p className="mt-4 text-[1.15rem] font-semibold tracking-[-0.015em]">
              Turn Gemini capabilities into reliable workflow primitives
            </p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-t2">
              The frontier model keeps getting more capable. What is missing is the operational
              contract that lets an institution trust it with a process that matters.
            </p>

            <div className="mt-7 space-y-5">
              {FOCUS.map((f) => (
                <div key={f.n} className="flex gap-4">
                  <span className="font-mono text-[11px] text-signal">{f.n}</span>
                  <div>
                    <p className="text-[14.5px] font-medium">{f.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-t2">{f.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
