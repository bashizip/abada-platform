import { ArrowUpRight, Check } from "lucide-react";
import { EXIT_DEMO_URL, GATE_REPORT_URL } from "../../lib/links";
import { RELEASE_GATE_TESTS, RELEASE_VERSION } from "../../lib/release";
import { Reveal, Section, SectionHead } from "./primitives";

const NUMBERS = [
  {
    k: RELEASE_GATE_TESTS ? String(RELEASE_GATE_TESTS) : "PostgreSQL",
    v: RELEASE_GATE_TESTS
      ? "engine tests against real PostgreSQL in the recorded release gate"
      : "restart, upgrade and concurrency suites",
  },
  { k: "V1 → V21", v: "schema upgrades tested from every prior version" },
  { k: "2 × 4", v: "slow agent tasks on two workers, one model call each" },
  { k: "amd64 · arm64", v: "native images for every component of this release" },
];

const CRITERIA = [
  "A malicious expression is rejected at deployment, and nothing executes",
  "An invalid answer goes to human review and is never written to the process",
  "A low-confidence answer goes to human review; a reviewer completes the case",
  "Slow model calls outlive their locks without a single duplicate call",
];

export function Proof() {
  return (
    <Section id="proof">
      <SectionHead
        eyebrow="Proof you can rerun"
        title="Don't trust the claims. Rerun the evidence."
        lead={`Release candidates are published only after a recorded gate. For ${RELEASE_VERSION}, the gate included an exit demo that exercises the governance claims end to end on a live stack — and the same script is in the repository for you to run.`}
      />

      <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
        {NUMBERS.map((n, i) => (
          <Reveal key={n.k} delay={i * 60}>
            <div className="h-full bg-surface/40 p-6">
              <p className="font-mono text-[1.6rem] leading-none font-medium text-t1">{n.k}</p>
              <p className="mt-3 text-[13px] leading-snug text-t2">{n.v}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <Reveal className="lg:col-span-7">
          <p className="mono-label">What the exit demo checks</p>
          <ul className="mt-5 space-y-3">
            {CRITERIA.map((c) => (
              <li key={c} className="flex gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-signal" strokeWidth={2.5} />
                <span className="text-[14.5px] leading-relaxed text-t1">{c}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[13px] leading-relaxed text-t3">
            The first run of this demo found a real race between lock heartbeats and completions.
            It was fixed, covered by new tests and rerun before the release was signed off — which
            is what a gate is for.
          </p>
        </Reveal>

        <Reveal className="lg:col-span-5" delay={100}>
          <div className="overflow-hidden rounded-xl border border-hairline bg-surface/60">
            <div className="border-b border-hairline px-4 py-2.5">
              <span className="font-mono text-[10px] tracking-[0.16em] text-t3 uppercase">
                Against your own dev stack
              </span>
            </div>
            <div className="p-5">
              <code className="block font-mono text-[12.5px] leading-relaxed break-all">
                <span className="text-signal">$ </span>
                <span className="text-t1">./scripts/test/m1-exit-demo/run.sh</span>
              </code>
              <p className="mt-3 font-mono text-[11px] leading-relaxed text-t3">
                Exits non-zero on the first criterion that fails.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            <a
              href={EXIT_DEMO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[13.5px] text-signal transition-opacity hover:opacity-80"
            >
              The demo script <ArrowUpRight className="size-3.5" />
            </a>
            <a
              href={GATE_REPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[13.5px] text-t2 transition-colors hover:text-t1"
            >
              The {RELEASE_VERSION} gate report <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
