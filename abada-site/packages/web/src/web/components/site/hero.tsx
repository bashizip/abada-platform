import { ArrowUpRight, Terminal } from "lucide-react";
import { GITHUB_URL, PILOT_URL } from "../../lib/links";
import { RELEASE_GATE_TESTS, RELEASE_VERSION } from "../../lib/release";

const KEPT = [
  { k: "Code", v: "AGPL-3.0 — every line auditable" },
  { k: "Data", v: "PostgreSQL you operate" },
  { k: "Identity", v: "Your OIDC provider" },
  { k: "Models", v: "An OpenAI-compatible endpoint you choose, in your network if you want" },
  { k: "Telemetry", v: "Off by default" },
];

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden px-6 pt-28 pb-0">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-70" />
      <div className="glow-signal pointer-events-none absolute -top-40 left-1/2 h-[620px] w-[1100px] -translate-x-1/2" />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
        style={{ background: "linear-gradient(to top, #05070A, transparent)" }}
      />

      <div className="relative mx-auto w-full max-w-[1200px]">
        <div className="rise-0 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface/70 px-3 py-1.5">
          <span className="size-1.5 rounded-full bg-signal" />
          <span className="font-mono text-[10px] tracking-[0.16em] text-t2 uppercase">
            Open source · AGPL-3.0 · Self-hosted · {RELEASE_VERSION}
          </span>
        </div>

        <h1 className="h-display rise-80 mt-7 text-[clamp(2.4rem,5.4vw,4.5rem)]">
          AI in your critical processes.
          <br />
          <span className="text-signal">On infrastructure you control.</span>
        </h1>

        <div className="mt-8 grid items-start gap-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="rise-160 prose-lead text-[1.125rem]">
              Abada is an open-source runtime for business processes where AI agents, rules and
              people work together — deployed on your servers, with PostgreSQL as its only
              database. The engine checks every AI answer before it can change anything.
            </p>

            <div className="rise-240 mt-9 flex flex-wrap items-center gap-3">
              <a
                href={PILOT_URL}
                className="inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3 text-[15px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
              >
                Start a design-partner pilot
              </a>
              <a
                href="#quickstart"
                className="inline-flex items-center gap-2 rounded-lg border border-hairline-strong bg-surface/60 px-5 py-3 text-[15px] font-medium text-t1 transition-colors hover:border-signal/50"
              >
                <Terminal className="size-4" />
                Run it yourself
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-1 py-3 text-[14px] text-t2 transition-colors hover:text-t1"
              >
                Read the source <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          </div>

          <div className="rise-200 lg:col-span-5">
            <div className="rounded-xl border border-hairline bg-surface/70 p-5 backdrop-blur-sm">
              <p className="mono-label">What stays with you</p>
              <dl className="mt-4 space-y-3.5">
                {KEPT.map((item) => (
                  <div key={item.k} className="grid grid-cols-[88px_1fr] gap-4">
                    <dt className="font-mono text-[12px] text-signal">{item.k}</dt>
                    <dd className="text-[13.5px] leading-snug text-t1">{item.v}</dd>
                  </div>
                ))}
              </dl>
              <div className="my-5 h-px bg-hairline" />
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-[13px] text-t1">{RELEASE_VERSION}</span>
                <span className="text-right text-[12.5px] text-t3">
                  {RELEASE_GATE_TESTS
                    ? `${RELEASE_GATE_TESTS} tests in the recorded release gate`
                    : "Evaluation release candidate"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
