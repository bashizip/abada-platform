import { Reveal, Section, SectionHead } from "./primitives";

const PILLARS = [
  {
    verb: "Agents advise",
    body: "The model runs outside the transaction. Its answer changes nothing until the engine has checked it against the declared schema, confidence threshold and result variable.",
  },
  {
    verb: "Rules decide",
    body: "Conditions and decision tables run in sandboxed CEL. Unsafe expressions are rejected at deployment; failures roll back instead of guessing.",
  },
  {
    verb: "Humans approve",
    body: "Invalid or low-confidence answers go to a person. AI-proposed process changes take effect only after review.",
  },
  {
    verb: "PostgreSQL remembers",
    body: "State, work, history and events commit in one transaction. Every model call leaves an auditable record.",
  },
];

export function Governed() {
  return (
    <Section id="governed" alt>
      <SectionHead
        eyebrow="Governance"
        title={
          <>
            Agents advise. Rules decide.
            <br />
            <span className="text-signal">Humans approve. PostgreSQL remembers.</span>
          </>
        }
        lead="The engine — not the model, the worker or the UI — enforces the rules."
      />

      <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:grid-cols-2">
        {PILLARS.map((pillar, i) => (
          <Reveal key={pillar.verb} delay={i * 70}>
            <div className="h-full bg-ink-alt p-6 md:p-7">
              <p className="font-mono text-[11px] tracking-[0.16em] text-signal uppercase">
                0{i + 1}
              </p>
              <p className="mt-3 text-[1.25rem] font-semibold tracking-[-0.015em]">{pillar.verb}</p>
              <p className="mt-3 text-[14px] leading-relaxed text-t2">{pillar.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
