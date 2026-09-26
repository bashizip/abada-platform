import { Mail } from "lucide-react";
import { PILOT_URL } from "../../lib/links";
import { Reveal, Section, SectionHead } from "./primitives";

const STEPS = [
  {
    title: "Choose one process",
    body: "Where AI helps but accountability is non-negotiable.",
  },
  {
    title: "Model it with your reviewers",
    body: "In APL, readable YAML your analysts and auditors can review.",
  },
  {
    title: "Run it on your infrastructure",
    body: "Your servers, identity provider and model endpoint.",
  },
  {
    title: "Review the evidence together",
    body: "What agents proposed, what rules decided, where people stepped in.",
  },
];

export function Pilot() {
  return (
    <Section id="pilot">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionHead
            eyebrow="Design-partner pilot"
            title="Put one real process on it."
            lead="We are working with a small number of design partners to run one consequential process on their own infrastructure."
          />
          <a
            href={PILOT_URL}
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3.5 text-[15px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
          >
            <Mail className="size-4" />
            Propose a pilot process
          </a>
          <p className="mt-4 text-[12.5px] leading-relaxed text-t3">
            Work directly with the founder. No licence fee.
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
