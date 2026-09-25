import { Mail } from "lucide-react";
import { PILOT_URL } from "../../lib/links";
import { Reveal, Section, SectionHead } from "./primitives";

const STEPS = [
  {
    title: "Choose one process",
    body: "One where AI would help, but accountability is non-negotiable: an exception queue, a review step, a case file.",
  },
  {
    title: "Model it with your reviewers",
    body: "Write it together in APL — readable YAML that your analysts, risk team and auditors can review and diff.",
  },
  {
    title: "Run it on your infrastructure",
    body: "Your servers, your PostgreSQL, your identity provider and the model endpoint you choose. Nothing is hosted for you.",
  },
  {
    title: "Review the evidence together",
    body: "What each agent proposed, what the rules decided, where people stepped in — read straight from the process history.",
  },
];

export function Pilot() {
  return (
    <Section id="pilot">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionHead
            eyebrow="Design-partner pilot"
            title="Put one real process on it. Inside your walls."
            lead="Abada is looking for a small number of design partners: organisations willing to run one consequential process on their own infrastructure and shape what comes next."
          />
          <a
            href={PILOT_URL}
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3.5 text-[15px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
          >
            <Mail className="size-4" />
            Propose a pilot process
          </a>
          <p className="mt-4 text-[12.5px] leading-relaxed text-t3">
            You work directly with the founder. The software itself is AGPL-3.0 — there is no
            licence to buy.
          </p>
        </div>

        <div className="grid gap-px self-start overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 lg:col-span-7">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delay={i * 70}>
              <div className="h-full bg-surface/40 p-6">
                <span className="flex size-7 items-center justify-center rounded-md bg-signal/15 font-mono text-[12px] font-medium text-signal">
                  {i + 1}
                </span>
                <p className="mt-4 text-[15px] font-semibold">{step.title}</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-t2">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
