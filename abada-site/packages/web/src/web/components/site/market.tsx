import { Banknote, Landmark, Radio, Sprout } from "lucide-react";
import { Reveal, Section, SectionHead } from "./primitives";

const SECTORS = [
  {
    icon: Banknote,
    name: "Banks & financial services",
    body: "KYC review, credit exceptions, fraud escalation. Customer data stays in your data centre, and each decision can be explained to a supervisor months later.",
  },
  {
    icon: Radio,
    name: "Telecom operators",
    body: "Subscriber onboarding, incident escalation, partner settlement disputes — high volumes, with subscriber data that cannot go to a third-party cloud.",
  },
  {
    icon: Landmark,
    name: "Public sector",
    body: "Citizen requests and approvals where data location, auditability and independence from a foreign vendor are requirements, not preferences.",
  },
  {
    icon: Sprout,
    name: "Agriculture & development programmes",
    body: "Producer case files, document capture and field-data routing where connectivity is thin and the data belongs to the programme.",
  },
];

export function Market() {
  return (
    <Section id="use-cases" alt>
      <SectionHead
        eyebrow="Who it is for"
        title="Organisations that cannot send their processes to someone else's cloud"
        lead="Regulated and sovereignty-sensitive institutions want AI in consequential processes, but not at the price of handing their data, their decision logic or their audit trail to a vendor."
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
        These are the use cases Abada is designed for, not customer references. Abada is looking
        for its first design partners.
      </p>
    </Section>
  );
}
