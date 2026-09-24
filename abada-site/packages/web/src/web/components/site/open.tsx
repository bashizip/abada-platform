import { ArrowUpRight } from "lucide-react";
import {
  APL_SPEC_URL,
  EXPRESSION_SANDBOX_URL,
  LICENSE_URL,
  OUTPUT_VALIDATOR_URL,
  RUNTIME_STATE_URL,
  SDK_LICENSE_URL,
} from "../../lib/links";
import { Reveal, Section, SectionHead } from "./primitives";

const TERMS = [
  {
    title: "Use it in production, at no cost",
    body: "AGPL-3.0 allows commercial use with no licence fee, seat count or usage cap. There is no enterprise edition holding features back: the repository is the product.",
  },
  {
    title: "Change it as you need",
    body: "If people use your modified version over a network, offer them its source. That is the key condition, and it is what keeps the platform open for everyone.",
  },
  {
    title: "Your integrations stay yours",
    body: "The Java worker SDK is Apache-2.0, so the workers you build against Abada carry no copyleft obligations.",
  },
  {
    title: "No vendor to outlive you",
    body: "Your processes are plain YAML you can keep in your own repository, and you can build, fork or maintain the platform yourself.",
  },
];

const AUDIT = [
  { label: "The expression sandbox rules and gateways run in", href: EXPRESSION_SANDBOX_URL },
  { label: "The validator every AI answer must pass", href: OUTPUT_VALIDATOR_URL },
  { label: "The transaction and persistence model", href: RUNTIME_STATE_URL },
  { label: "The process language your analysts write", href: APL_SPEC_URL },
];

export function Open() {
  return (
    <Section id="open">
      <SectionHead
        eyebrow="Open source, for real"
        title="Audit every line. Run it without asking anyone."
        lead="Regulated teams cannot put a black box in a critical process. With Abada, your architects, security team and auditors read the same code that runs."
      />

      <div className="mt-12 grid gap-8 lg:grid-cols-12">
        <div className="grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 lg:col-span-8">
          {TERMS.map((term, i) => (
            <Reveal key={term.title} delay={i * 60}>
              <div className="h-full bg-surface/40 p-6">
                <p className="text-[15px] font-semibold">{term.title}</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-t2">{term.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="lg:col-span-4" delay={120}>
          <div className="h-full rounded-xl border border-signal/25 bg-signal/[0.04] p-6">
            <p className="mono-label text-signal!">Start your review here</p>
            <ul className="mt-5 space-y-4">
              {AUDIT.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-start gap-1.5 text-[13.5px] leading-snug text-t1 transition-colors hover:text-signal"
                  >
                    {item.label}
                    <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-t3 group-hover:text-signal" />
                  </a>
                </li>
              ))}
            </ul>
            <div className="my-5 h-px bg-hairline" />
            <p className="text-[12.5px] leading-relaxed text-t3">
              <a href={LICENSE_URL} target="_blank" rel="noreferrer" className="underline decoration-hairline-strong underline-offset-4 hover:text-t2">
                AGPL-3.0-only
              </a>{" "}
              for the platform,{" "}
              <a href={SDK_LICENSE_URL} target="_blank" rel="noreferrer" className="underline decoration-hairline-strong underline-offset-4 hover:text-t2">
                Apache-2.0
              </a>{" "}
              for the worker SDK. Releases up to 1.0.0-rc.5 remain available under MIT.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
