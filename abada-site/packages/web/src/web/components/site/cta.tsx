import { ArrowUpRight, FileText, Mail, Play } from "lucide-react";
import { BRIEF_URL, CALENDAR_URL, DEMO_URL, DOCS_URL, EMAIL, GITHUB_URL } from "../../lib/links";

export function Cta() {
  return (
    <section className="hairline relative overflow-hidden bg-ink px-6 py-24 md:py-32">
      <div className="glow-signal pointer-events-none absolute inset-x-0 -bottom-56 h-[520px]" />
      <div className="relative mx-auto w-full max-w-[1200px]">
        <div className="max-w-3xl">
          <p className="mono-label text-signal!">Open to design partners and investors</p>
          <h2 className="h-section mt-4">
            The rails are built. Now they need real processes running on them.
          </h2>
          <p className="prose-lead mt-5">
            If you operate high-stakes processes and want AI in them without giving up
            accountability, or you invest in infrastructure at this stage — the fastest path is a
            direct conversation with the founder.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <a
            href={CALENDAR_URL}
            className="inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3.5 text-[15px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
          >
            <Mail className="size-4" />
            Talk to the founder
          </a>
          <a
            href={BRIEF_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-hairline-strong bg-surface/60 px-5 py-3.5 text-[15px] text-t1 transition-colors hover:border-signal/50"
          >
            <FileText className="size-4" />
            Download the brief
          </a>
          <a
            href={DEMO_URL}
            className="inline-flex items-center gap-2 rounded-lg border border-hairline-strong bg-surface/60 px-5 py-3.5 text-[15px] text-t1 transition-colors hover:border-signal/50"
          >
            <Play className="size-4" />
            84-second demo
          </a>
        </div>

        <div className="hairline mt-20 flex flex-col gap-6 pt-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-signal font-semibold text-[13px] text-[#04150f]">
              A
            </span>
            <div>
              <p className="text-[14px] font-semibold">Abada</p>
              <p className="font-mono text-[10.5px] text-t3">
                Open source · Built in the Democratic Republic of the Congo
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
              Demo
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
