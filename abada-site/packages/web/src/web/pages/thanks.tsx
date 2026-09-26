import { useEffect } from "react";
import { ArrowLeft, ArrowUpRight, Check } from "lucide-react";
import { Nav } from "../components/site/nav";
import { DOCS_URL, GITHUB_URL } from "../lib/links";

/** Landing page after the design-partner form is submitted. */
export default function ThanksPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Thank you — Abada";
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex";
    document.head.appendChild(robots);
    return () => {
      document.title = previousTitle;
      robots.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-ink">
      <Nav anchorBase="/" />

      <main className="relative overflow-hidden px-6 pt-36 pb-28">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />
        <div className="glow-signal pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[1000px] -translate-x-1/2" />

        <div className="relative mx-auto w-full max-w-[720px]">
          <span className="rise-0 flex size-11 items-center justify-center rounded-xl bg-signal/15">
            <Check className="size-5 text-signal" strokeWidth={2.5} />
          </span>

          <h1 className="h-display rise-80 mt-7 text-[clamp(2.2rem,4.6vw,3.4rem)]">
            Thank you. Your pilot proposal is on its way.
          </h1>

          <p className="rise-160 prose-lead mt-6">
            It goes straight to the founder, who will reply by email to talk through the process
            you have in mind.
          </p>

          <div className="rise-240 mt-10 flex flex-wrap items-center gap-3">
            <a
              href="/"
              className="inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3 text-[15px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
            >
              <ArrowLeft className="size-4" />
              Back to the site
            </a>
            <a
              href={DOCS_URL}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong bg-surface/60 px-5 py-3 text-[15px] text-t1 transition-colors hover:border-signal/50"
            >
              Read the documentation <ArrowUpRight className="size-4" />
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-2 py-3 text-[15px] text-t2 transition-colors hover:text-t1"
            >
              Browse the source <ArrowUpRight className="size-4" />
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
