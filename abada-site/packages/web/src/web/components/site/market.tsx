import { Banknote, Landmark, Radio, Sprout } from "lucide-react";
import { Reveal, Section, SectionHead } from "./primitives";

const SECTORS = [
  {
    icon: Banknote,
    name: "Banks & financial services",
    body: "KYC review, credit exceptions, fraud escalation — each decision explainable to a supervisor months later.",
  },
  {
    icon: Radio,
    name: "Telecom operators",
    body: "Subscriber onboarding, incident escalation and settlement disputes, at volume, on your own infrastructure.",
  },
  {
    icon: Landmark,
    name: "Public sector",
    body: "Citizen requests and approvals where data location and auditability are requirements.",
  },
  {
    icon: Sprout,
    name: "Agriculture & development programmes",
    body: "Case files, document capture and field-data routing, with the data kept by the programme.",
  },
];

export function Market() {
  return (
    <Section id="use-cases" alt>
      <SectionHead
        eyebrow="Who it is for"
        title="Built for organisations that keep their processes in-house"
        lead="Regulated institutions that want AI in consequential processes without handing their data, decision logic or audit trail to a vendor."
      />

      <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:grid-cols-2">
        {SECTORS.map((s, i) => {
          const Icon = s.icon;
          return (
            <Reveal key={s.name} delay={i * 70}>
              <div className="h-full bg-ink-alt p-6">
                <Icon className="size-4 text-signal" />
                <p className="mt-4 text-[1.05rem] font-semibold tracking-[-0.01em]">{s.name}</p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-t2">{s.body}</p>
              </div>
            </Reveal>
          );
        })}
      </div>

      <p className="mt-6 text-[12.5px] leading-relaxed text-t3">
        Target use cases, not customer references.
      </p>
    </Section>
  );
}
