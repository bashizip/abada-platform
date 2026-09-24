import { Reveal, Section, SectionHead } from "./primitives";

const PILLARS = [
  {
    verb: "Agents advise",
    body: "The model runs outside the database transaction. Its answer enters the process only through an engine command, and the engine checks it first: the declared output schema, the confidence threshold, and that it writes nothing but its own result variable.",
  },
  {
    verb: "Rules decide",
    body: "Gateways and decision tables use CEL, a sandboxed expression language with no access to the JVM. A malicious expression is rejected at deployment; a failing one rolls the command back instead of guessing a route.",
  },
  {
    verb: "Humans approve",
    body: "An invalid or low-confidence answer goes to a person, not onward. Changes to a process that AI proposes become a new immutable version only after people review them.",
  },
  {
    verb: "PostgreSQL remembers",
    body: "Process state, work, history and the event outbox commit in one transaction. Every model attempt records provider, duration, confidence, token usage, outcome and a prompt hash — and it all survives a restart.",
  },
];

export function Governed() {
  return (
    <Section id="governed" alt>
      <SectionHead
        eyebrow="Governed by the engine"
        title={
          <>
            Agents advise. Rules decide.
            <br />
            <span className="text-signal">Humans approve. PostgreSQL remembers.</span>
          </>
        }
        lead="Owning the infrastructure only matters if you can trust what runs on it. Abada does not trust the model, the worker or the UI to follow the rules — the engine enforces them."
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
