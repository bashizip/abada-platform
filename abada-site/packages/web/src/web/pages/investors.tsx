import { ArrowLeft, ArrowUpRight, Check, Minus } from "lucide-react";
import { Nav, StickyCta } from "../components/site/nav";
import { Cta } from "../components/site/cta";
import { Reveal, Section, SectionHead } from "../components/site/primitives";
import { claimsWithStatus, proofLabel, proofUrl, type Claim } from "../lib/claims";
import { DOCS_URL, GITHUB_URL, GATE_REPORT_URL, LICENSE_URL, PILOT_URL } from "../lib/links";
import { RELEASE_LABEL, RELEASE_VERSION } from "../lib/release";

const DOCTRINE = [
  ["Agents advise.", "A model proposes; it never writes process state. Its answer is checked by the engine."],
  ["Rules decide.", "Business rules are deterministic, sandboxed expressions that fail loudly instead of guessing."],
  ["Humans approve.", "Writes to outside systems, and changes to the process itself, wait for a person."],
  ["PostgreSQL remembers.", "State, work, history and evidence live in one transactional store you already run."],
];

const NOT_CLAIMED = [
  "No customer is named on this page. Design-partner pilots are being scoped, not announced.",
  "A replay of a proposed change shows what would have been done differently, never that it is better.",
  "Side effects outside the engine are at-least-once unless a tool proves an idempotency key; nothing here is exactly-once.",
  "Full BPMN 2.0 coverage is not claimed; unsupported constructs are rejected at deployment.",
  "Public-cloud certification and an independent security review have not been done.",
];

function ClaimCard({ item, index }: { item: Claim; index: number }) {
  return (
    <Reveal delay={index * 50}>
      <div data-claim={item.id} className="h-full bg-surface/40 p-6">
        <p className="text-[14.5px] leading-relaxed text-t1">{item.text}</p>
        <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-t3">
          <span className="mono-label">Proof</span>
          {item.proof.map((proof) => (
            <a
              key={proof.path}
              href={proofUrl(proof.path)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-t2 transition-colors hover:text-signal"
            >
              {proofLabel(proof.path)} <ArrowUpRight className="size-3" />
            </a>
          ))}
        </p>
      </div>
    </Reveal>
  );
}

export default function InvestorsPage() {
  const released = claimsWithStatus("released");
  const next = claimsWithStatus("next");

  return (
    <div className="min-h-screen bg-ink">
      <Nav anchorBase="/" />

      <main>
        <section className="relative overflow-hidden px-6 pt-28 pb-16">
          <div className="grid-bg pointer-events-none absolute inset-0 opacity-70" />
          <div className="glow-signal pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[1000px] -translate-x-1/2" />
          <div className="relative mx-auto w-full max-w-[1200px]">
            <a href="/" className="mono-label inline-flex items-center gap-2 transition-colors hover:text-t2">
              <ArrowLeft className="size-3.5" /> Abada
            </a>
            <p className="mono-label mt-8 text-signal!">For investors</p>
            <h1 className="h-display rise-80 mt-4 max-w-4xl text-[clamp(2.2rem,4.6vw,3.6rem)]">
              AI inside business processes, <span className="text-signal">under the same discipline as the rest</span>
            </h1>
            <p className="rise-160 prose-lead mt-6 max-w-3xl text-[1.0625rem]">
              Abada is an open-source, self-hosted runtime for processes in which AI agents, deterministic rules and
              people work together, and where every AI decision leaves evidence an auditor can read later. It is
              built for organisations that must run on their own infrastructure: banks, telecoms and the public
              sector. Everything below is tied to the code and tests that show it.
            </p>
            <p className="rise-240 mt-6 font-mono text-[12px] text-t3">
              {RELEASE_VERSION} · {RELEASE_LABEL}
            </p>
          </div>
        </section>

        <Section alt>
          <SectionHead
            eyebrow="The idea"
            title="Four sentences the product is built around"
            lead="Models are probabilistic and processes are not allowed to be. The engine, not the model and not the interface, is where the line is held."
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:grid-cols-2">
            {DOCTRINE.map(([title, body], index) => (
              <Reveal key={title} delay={index * 60}>
                <div className="h-full bg-surface/40 p-6">
                  <p className="text-[1.05rem] font-semibold tracking-[-0.01em]">{title}</p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-t2">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        <Section>
          <SectionHead
            eyebrow="What exists today"
            title="Published, and the evidence for each statement"
            lead={
              <>
                Each statement links to the code and the tests behind it. The release gate report records the
                full checks for the published version:{" "}
                <a href={GATE_REPORT_URL} className="text-signal underline-offset-4 hover:underline">
                  gate report
                </a>
                .
              </>
            }
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:grid-cols-2">
            {released.map((item, index) => (
              <ClaimCard key={item.id} item={item} index={index} />
            ))}
          </div>
        </Section>

        {next.length > 0 ? (
        <Section alt>
          <SectionHead
            eyebrow="Built, not yet published"
            title="The governed-improvement loop"
            lead="These are implemented and tested on the development branch. They are not in a published release until the 1.1.0 gate is signed off, and this page will say so when they are."
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:grid-cols-2">
            {next.map((item, index) => (
              <ClaimCard key={item.id} item={item} index={index} />
            ))}
          </div>
        </Section>
        ) : null}

        <Section>
          <SectionHead
            eyebrow="Open source"
            title="You can read it, run it and leave"
            lead={
              <>
                The engine is licensed under the{" "}
                <a href={LICENSE_URL} className="text-signal underline-offset-4 hover:underline">
                  GNU AGPL-3.0
                </a>
                ; the worker SDK is Apache-2.0. It runs on PostgreSQL and RustFS, both self-hosted, with no required cloud service; the running platform never contacts us, and the installer's one anonymous report can be switched off.
              </>
            }
          />
        </Section>

        <Section alt>
          <SectionHead eyebrow="Limits" title="What this page does not claim" />
          <ul className="mt-10 max-w-3xl space-y-3">
            {NOT_CLAIMED.map((line) => (
              <li key={line} className="flex gap-3">
                <Minus className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={2.5} />
                <span className="text-[14px] leading-relaxed text-t2">{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 flex items-center gap-2 text-[13px] text-t3">
            <Check className="size-4 text-signal" strokeWidth={2.5} />
            Statements and their proofs are checked together by the site build.
          </p>
        </Section>

        <Section>
          <SectionHead
            eyebrow="Talk to us"
            title="Design partners and investors"
            lead={
              <>
                If you run processes that cannot leave your infrastructure, start with a{" "}
                <a href={PILOT_URL} className="text-signal underline-offset-4 hover:underline">
                  design-partner pilot
                </a>
                . To read how it is built, start with the{" "}
                <a href={DOCS_URL} className="text-signal underline-offset-4 hover:underline">
                  documentation
                </a>{" "}
                or the{" "}
                <a href={GITHUB_URL} className="text-signal underline-offset-4 hover:underline">
                  source
                </a>
                .
              </>
            }
          />
        </Section>

        <Cta />
      </main>

      <StickyCta anchorBase="/" />
    </div>
  );
}
