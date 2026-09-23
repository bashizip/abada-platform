import { Play } from "lucide-react";
import { CALENDAR_URL, GITHUB_URL } from "../../lib/links";
import { RELEASE_LABEL, RELEASE_VERSION } from "../../lib/release";

const FACTS = [
  { k: RELEASE_VERSION, v: RELEASE_LABEL },
  { k: "PostgreSQL-tested", v: "Restart, upgrade and concurrency suites" },
  { k: "PostgreSQL", v: "Authoritative runtime state" },
  { k: "Self-hosted", v: "Your infrastructure, your data" },
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
        <div className="grid items-start gap-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="rise-0 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface/70 px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-signal" />
              <span className="font-mono text-[10px] tracking-[0.16em] text-t2 uppercase">
                Open source · Self-hosted · {RELEASE_VERSION}
              </span>
            </div>

            <h1 className="h-display rise-80 mt-7 text-[clamp(2.6rem,5.6vw,4.6rem)]">
              Transactional ACID rails
              <br />
              for <span className="text-signal">autonomous AI agents.</span>
            </h1>

            <p className="rise-160 prose-lead mt-7 text-[1.125rem]">
              Run agents, people and systems in one durable process. The engine checks every model
              answer against its contract and sends weak ones to a person, and every AI-proposed change
              waits for human approval. Self-hosted, with PostgreSQL as the only dependency.
            </p>

            <div className="rise-240 mt-9 flex flex-wrap items-center gap-3">
              <a
                href="#quickstart"
                className="inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3 text-[15px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
              >
                <Play className="size-4 fill-current" />
                Show it in action
              </a>
              <a
                href={CALENDAR_URL}
                className="inline-flex items-center gap-2 rounded-lg border border-hairline-strong bg-surface/60 px-5 py-3 text-[15px] font-medium text-t1 transition-colors hover:border-signal/50"
              >
                Talk to the founder
              </a>
            </div>

            <p className="rise-320 mono-label mt-8">
              Runs on your own infrastructure ·{" "}
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="underline decoration-hairline-strong underline-offset-4 hover:text-t2">
                source on GitHub
              </a>
            </p>
            <p className="rise-320 mt-3 text-[12.5px] text-t3">
              Full video coming soon.
            </p>
          </div>

          <div className="rise-200 lg:col-span-5">
            <div className="rounded-xl border border-hairline bg-surface/70 p-5 backdrop-blur-sm">
              <p className="mono-label">The category</p>
              <p className="mt-3 text-[15px] leading-relaxed text-t1">
                Process orchestration where the AI agent is a{" "}
                <span className="text-signal">first-class, versioned participant</span> — not an
                external API call, and not an improvising swarm.
              </p>
              <div className="my-5 h-px bg-hairline" />
              <dl className="space-y-4">
                {FACTS.map((f) => (
                  <div key={f.k} className="flex items-baseline justify-between gap-4">
                    <dt className="font-mono text-[13px] text-t1">{f.k}</dt>
                    <dd className="text-right text-[12.5px] text-t3">{f.v}</dd>
                  </div>
                ))}
              </dl>
              <div className="my-5 h-px bg-hairline" />
              <p className="text-[12.5px] leading-relaxed text-t3">
                Built by a solo founder in the Democratic Republic of the Congo, on a decade of
                engineering mission-critical platforms. Gemini by default; any OpenAI-compatible or local model.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
