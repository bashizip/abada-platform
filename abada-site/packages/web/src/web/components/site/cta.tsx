import { ArrowRight, ArrowUpRight, Terminal } from "lucide-react";
import { DEMO_URL, DOCS_URL, EMAIL, GITHUB_URL, LICENSE_URL, PILOT_URL } from "../../lib/links";

export function Cta() {
  return (
    <section className="hairline relative overflow-hidden bg-ink px-6 py-24 md:py-32">
      <div className="glow-signal pointer-events-none absolute inset-x-0 -bottom-56 h-[520px]" />
      <div className="relative mx-auto w-full max-w-[1200px]">
        <div className="max-w-3xl">
          <p className="mono-label text-signal!">Your processes · your infrastructure · your rules</p>
          <h2 className="h-section mt-4">
            Bring AI into the processes that matter. Keep them yours.
          </h2>
          <p className="prose-lead mt-5">
            Read the source, run it locally, or propose a pilot on your own infrastructure.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <a
            href={PILOT_URL}
            className="inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3.5 text-[15px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
          >
            Start a design-partner pilot
            <ArrowRight className="size-4" />
          </a>
          <a
            href="#quickstart"
            className="inline-flex items-center gap-2 rounded-lg border border-hairline-strong bg-surface/60 px-5 py-3.5 text-[15px] text-t1 transition-colors hover:border-signal/50"
          >
            <Terminal className="size-4" />
            Run it yourself
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-2 py-3.5 text-[15px] text-t2 transition-colors hover:text-t1"
          >
            Read the source <ArrowUpRight className="size-4" />
          </a>
        </div>

        <div className="hairline mt-20 flex flex-col gap-6 pt-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Abada" className="size-8" />
            <div>
              <p className="text-[15px] font-bold tracking-wide uppercase">Abada Platform</p>
              <p className="font-mono text-[10.5px] text-t3">
                <a href={LICENSE_URL} target="_blank" rel="noreferrer" className="hover:text-t2">
                  AGPL-3.0
                </a>{" "}
                · Built in the Democratic Republic of the Congo
              </p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-6">
            <a href={DOCS_URL} className="text-[13px] text-t2 transition-colors hover:text-t1">
              Docs
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[13px] text-t2 transition-colors hover:text-t1"
            >
              GitHub <ArrowUpRight className="size-3" />
            </a>
            <a href={DEMO_URL} className="text-[13px] text-t2 transition-colors hover:text-t1">
              Quickstart
            </a>
            <a href="/vs-camunda" className="text-[13px] text-t2 transition-colors hover:text-t1">
              Abada vs Camunda
            </a>
            <a
              href={`mailto:${EMAIL}`}
              className="text-[13px] text-t2 transition-colors hover:text-t1"
            >
              {EMAIL}
            </a>
          </nav>
        </div>
      </div>
    </section>
  );
}
