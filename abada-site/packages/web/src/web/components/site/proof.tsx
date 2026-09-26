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
  "Unsafe expressions are rejected at deployment",
  "Invalid answers are routed to a reviewer, never written",
  "Low-confidence answers are routed to a reviewer",
  "Slow model calls do not cause duplicate calls",
];

export function Proof() {
  return (
    <Section id="proof">
      <SectionHead
        eyebrow="Evidence"
        title="Verified before release. Rerunnable by you."
        lead="Release candidates pass a recorded gate, including an end-to-end test of the governance guarantees on a live stack."
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
          <p className="mono-label">What the release test proves</p>
          <ul className="mt-5 space-y-3">
            {CRITERIA.map((c) => (
              <li key={c} className="flex gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-signal" strokeWidth={2.5} />
                <span className="text-[14.5px] leading-relaxed text-t1">{c}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal className="lg:col-span-5" delay={100}>
          <div className="overflow-hidden rounded-xl border border-hairline bg-surface/60">
            <div className="border-b border-hairline px-4 py-2.5">
              <span className="font-mono text-[10px] tracking-[0.16em] text-t3 uppercase">
                Run it yourself
              </span>
            </div>
            <div className="p-5">
              <code className="block font-mono text-[12.5px] leading-relaxed break-all">
                <span className="text-signal">$ </span>
                <span className="text-t1">./scripts/test/m1-exit-demo/run.sh</span>
              </code>
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
