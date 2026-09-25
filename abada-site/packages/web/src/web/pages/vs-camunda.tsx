import { ArrowLeft, ArrowUpRight, Check, Mail } from "lucide-react";
import { Nav, StickyCta } from "../components/site/nav";
import { Comparison } from "../components/site/comparison";
import { Cta } from "../components/site/cta";
import { Reveal, Section, SectionHead } from "../components/site/primitives";
import { CALENDAR_URL, DOCS_URL, GITHUB_URL } from "../lib/links";

const CAMUNDA_STRENGTHS = [
  "Broad BPMN 2.0 and DMN execution coverage, refined over more than a decade.",
  "Large ecosystem: connectors, tooling, integrators, training, certified partners.",
  "Enterprise support organisation and reference deployments at very large scale.",
  "A deep talent pool — hiring for it is a solved problem.",
  "Native AI agents: an agent loop with tool calling over ad-hoc sub-processes and MCP.",
];

const ABADA_DIFFERENCES = [
  {
    title: "The engine, not the worker, enforces the AI contract",
    body: "Before a model answer can change process state, the engine checks it in the same transaction: only the declared result variable, the declared output schema, and a reported confidence at or above the threshold. Weak or malformed answers follow a declared route, usually to a person. Expressions are sandboxed CEL that cannot reach the JVM.",
  },
  {
    title: "Prompt, contract and routes are versioned, readable YAML",
    body: "Prompt, declared inputs, output schema, confidence threshold and fallback routes live in the APL definition a reviewer can read and diff. The model receives only the inputs the definition names. A new instruction is a new immutable version.",
  },
  {
    title: "Per-attempt evidence is persisted",
    body: "Provider, attempt, duration, confidence, allowed tools, error type, token usage and prompt hash are recorded for every model call, in the same transactional store as the process state.",
  },
  {
    title: "Execution evidence becomes a reviewed proposal",
    body: "The Insight loop turns recorded facts into findings, then into a concrete proposal. A human reviews it, and approval produces a new immutable version. Nothing mutates silently.",
  },
];

const CHOOSE_CAMUNDA = [
  "You need wide BPMN 2.0 and DMN semantics today, including the exotic parts.",
  "Your programme depends on a vendor support contract, certifications and a partner network.",
  "You want an agent to choose freely among many tools today (Abada's tool loop is on the roadmap).",
];

const CHOOSE_ABADA = [
  "Models make or shape decisions inside the process, and you must be able to defend those decisions later.",
  "You need the AI part under the same transactional and versioning discipline as the rest of the workflow.",
  "Self-hosting and data location are constraints, not preferences, and you want production use without a commercial licence or a multi-service cluster: Abada is open source under AGPL-3.0 and needs only PostgreSQL.",
  "You want the process to get measurably better from its own execution history, with a human in the approval path.",
];

export default function VsCamundaPage() {
  return (
    <div className="min-h-screen bg-ink">
      <Nav anchorBase="/" />

      <main>
        <section className="relative overflow-hidden px-6 pt-28 pb-16">
          <div className="grid-bg pointer-events-none absolute inset-0 opacity-70" />
          <div className="glow-signal pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[1000px] -translate-x-1/2" />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
            style={{ background: "linear-gradient(to top, #05070A, transparent)" }}
          />

          <div className="relative mx-auto w-full max-w-[1200px]">
            <a
              href="/"
              className="mono-label inline-flex items-center gap-2 transition-colors hover:text-t2"
            >
              <ArrowLeft className="size-3.5" /> Abada
            </a>

            <h1 className="h-display rise-80 mt-6 max-w-4xl text-[clamp(2.2rem,4.6vw,3.6rem)]">
              Abada vs Camunda: <span className="text-signal">where the AI actually lives</span>
            </h1>

            <p className="rise-160 prose-lead mt-6 max-w-3xl text-[1.0625rem]">
              Camunda is a mature process engine with native AI agents, and this page does not
              pretend otherwise. The difference is weight and governance: how little you need to
              run it, and whether the engine itself decides when a model answer is good enough to
              act on.
            </p>

            <div className="rise-240 mt-9 flex flex-wrap items-center gap-3">
              <a
                href="/#quickstart"
                className="inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3 text-[15px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
              >
                Run it yourself
              </a>
              <a
                href={DOCS_URL}
                className="inline-flex items-center gap-1.5 px-1 py-3 text-[14px] text-t2 transition-colors hover:text-t1"
              >
                Docs <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          </div>
        </section>

        <Section alt>
          <SectionHead
            eyebrow="Credit where it is due"
            title="What Camunda is genuinely good at"
            lead="Any comparison that claims a young open-source project beats a mature engine on every axis is not worth reading. Here is the honest position."
          />

          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:grid-cols-2">
            {CAMUNDA_STRENGTHS.map((s) => (
              <div key={s} className="flex gap-3 bg-surface/40 p-5">
                <Check className="mt-0.5 size-4 shrink-0 text-t2" strokeWidth={2.5} />
                <p className="text-[14px] leading-relaxed text-t2">{s}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 max-w-3xl text-[13px] leading-relaxed text-t3">
            Abada does not claim full BPMN 2.0 coverage. Unsupported execution semantics fail
            explicitly at deployment rather than being accepted ambiguously and misbehaving in
            production.
          </p>
        </Section>

        <Section>
          <SectionHead
            eyebrow="The actual difference"
            title="Four things that change when the agent's result is admitted through the transaction"
            lead="These are architectural choices, not roadmap items. They are what makes an AI decision defensible months later."
          />

          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:grid-cols-2">
            {ABADA_DIFFERENCES.map((d, i) => (
              <Reveal key={d.title} delay={i * 70}>
                <div className="h-full bg-surface/40 p-6">
                  <span className="font-mono text-[11px] text-signal">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-3 text-[1.05rem] font-semibold tracking-[-0.01em]">{d.title}</p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-t2">{d.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        <Comparison showVsLink={false} />

        <Section alt>
          <SectionHead
            eyebrow="Choose deliberately"
            title="When each one is the right answer"
          />

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            <Reveal>
              <div className="h-full rounded-xl border border-hairline bg-surface/40 p-6">
                <p className="mono-label">Choose Camunda</p>
                <ul className="mt-5 space-y-3">
                  {CHOOSE_CAMUNDA.map((c) => (
                    <li key={c} className="flex gap-3 text-[14px] leading-relaxed text-t2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-t3" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            <Reveal delay={90}>
              <div className="h-full rounded-xl border border-signal/25 bg-signal/[0.04] p-6">
                <p className="mono-label text-signal!">Choose Abada</p>
                <ul className="mt-5 space-y-3">
                  {CHOOSE_ABADA.map((c) => (
                    <li key={c} className="flex gap-3 text-[14px] leading-relaxed text-t1">
                      <Check className="mt-0.5 size-4 shrink-0 text-signal" strokeWidth={2.5} />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>

          <div className="mt-8 rounded-xl border border-hairline bg-surface/40 p-6">
            <p className="mono-label">Coexistence, not migration</p>
            <p className="mt-4 max-w-3xl text-[14px] leading-relaxed text-t2">
              Abada imports the documented BPMN subset, so the two can run side by side: keep the established engine for
              the processes it already serves, and put the AI-bearing processes on Abada where every
              model attempt is committed with the state it produced. The evaluation is one command —
              it runs on your own infrastructure, so nothing leaves it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={CALENDAR_URL}
                className="inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3 text-[14.5px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
              >
                <Mail className="size-4" /> Talk to the founder
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-hairline-strong px-5 py-3 text-[14.5px] text-t1 transition-colors hover:border-signal/50"
              >
                Read the source <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          </div>
        </Section>

        <Cta />
      </main>

      <StickyCta anchorBase="/" />
    </div>
  );
}
