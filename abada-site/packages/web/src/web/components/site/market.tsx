import { Reveal, Section, SectionHead } from "./primitives";
import { Banknote, Landmark, Radio, Sprout } from "lucide-react";

const SECTORS = [
  {
    icon: Banknote,
    name: "Banking & fintech",
    body: "KYC review, credit exceptions, fraud escalation — decisions that must be explainable to a regulator months later.",
  },
  {
    icon: Radio,
    name: "Telecom",
    body: "Subscriber onboarding, incident escalation, partner settlement disputes across large operational volumes.",
  },
  {
    icon: Sprout,
    name: "Agritech",
    body: "Producer case files, document capture and field-data routing where connectivity and staffing are thin.",
  },
  {
    icon: Landmark,
    name: "Govtech",
    body: "Citizen requests and auditable approvals where data location and accountability are non-negotiable.",
  },
];

export function Market() {
  return (
    <Section id="market">
      <SectionHead
        eyebrow="Where this lands first"
        title="Built for high-stakes operations, starting in Africa"
        lead="These are institutions running consequential processes with small back-office teams and hard data-residency constraints. They cannot deploy an improvising agent, and they cannot afford a six-figure legacy BPM programme. That is the wedge."
      />

      <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:grid-cols-2">
        {SECTORS.map((s, i) => {
          const Icon = s.icon;
          return (
            <Reveal key={s.name} delay={i * 70}>
              <div className="h-full bg-surface/40 p-6">
                <Icon className="size-4 text-signal" />
                <p className="mt-4 text-[1.05rem] font-semibold tracking-[-0.01em]">{s.name}</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-t2">{s.body}</p>
              </div>
            </Reveal>
          );
        })}
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        <Reveal delay={100}>
          <div className="h-full rounded-xl border border-hairline bg-surface/40 p-6">
            <p className="mono-label">Commercial path</p>
            <div className="mt-5 space-y-4">
              <div className="flex gap-4">
                <span className="mt-0.5 font-mono text-[10px] tracking-[0.16em] text-signal uppercase">
                  Now
                </span>
                <p className="text-[14px] leading-relaxed text-t2">
                  Open-source core, self-hosted. Adoption and evidence before monetisation.
                </p>
              </div>
              <div className="h-px bg-hairline" />
              <div className="flex gap-4">
                <span className="mt-0.5 font-mono text-[10px] tracking-[0.16em] text-t3 uppercase">
                  Next
                </span>
                <p className="text-[14px] leading-relaxed text-t2">
                  Managed hosting and enterprise support for institutions that want the guarantees
                  without operating the stack.
                </p>
              </div>
            </div>
            <p className="mt-6 text-[12.5px] leading-relaxed text-t3">
              Self-hosting keeps deployment and data-location choices with the operator — the
              precondition for regulated buyers in these markets.
            </p>
          </div>
        </Reveal>

        <Reveal delay={170}>
          <div className="h-full rounded-xl border border-hairline bg-surface/40 p-6">
            <p className="mono-label">Honest framing</p>
            <p className="mt-5 text-[15px] leading-relaxed text-t1">
              These are target use cases — not customer traction, and not an invented market size.
            </p>
            <p className="mt-4 text-[13.5px] leading-relaxed text-t2">
              What exists today is a working, tested, self-hostable platform and a founder with a
              decade of building and operating mission-critical platforms in these markets. The
              next milestone is design partners running real processes in production.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
