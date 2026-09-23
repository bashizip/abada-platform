import { Reveal, Section, SectionHead } from "./primitives";
import { RELEASE_GATE_TESTS, RELEASE_LABEL, RELEASE_VERSION } from "../../lib/release";

const GUARANTEES = [
  {
    title: "PostgreSQL authority",
    body: "Mutable process state is database-authoritative. No hidden in-memory truth.",
  },
  {
    title: "Atomicity",
    body: "State, work, history and outbox commit together in one transaction.",
  },
  {
    title: "Recovery",
    body: "Durable leases, retry metadata and restart-safe acquisition of work.",
  },
  {
    title: "Governance",
    body: "Backend RBAC, audit history, reviewer policies and immutable definition versions.",
  },
];

export function Reliability() {
  return (
    <Section id="proof" alt>
      <SectionHead
        eyebrow="Reliable and accountable by design"
        title="It is not a diagram. It runs today."
        lead="Everything below is implemented in the published evaluation release — verifiable in the open-source repository, in the recorded release gate, and in the local deployment you just started."
      />

      <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
        {GUARANTEES.map((g, i) => (
          <Reveal key={g.title} delay={i * 70}>
            <div className="h-full bg-surface/40 p-6">
              <p className="mono-label text-signal!">Implemented</p>
              <p className="mt-3 text-[15px] font-semibold">{g.title}</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-t2">{g.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-3">
        <div className="bg-surface/40 p-6">
          <p className="font-mono text-[1.7rem] leading-none font-medium text-t1">{RELEASE_VERSION}</p>
          <p className="mt-2 text-[12.5px] text-t3">{RELEASE_LABEL}</p>
        </div>
        <div className="bg-surface/40 p-6">
          <p className="font-mono text-[1.7rem] leading-none font-medium text-signal">
            {RELEASE_GATE_TESTS ?? "PostgreSQL"}
          </p>
          <p className="mt-2 text-[12.5px] text-t3">
            {RELEASE_GATE_TESTS ? "Tests passed in the recorded release gate" : "Restart, upgrade and concurrency suites"}
          </p>
        </div>
        <div className="bg-surface/40 p-6">
          <p className="font-mono text-[1.7rem] leading-none font-medium text-t1">At-least-once</p>
          <p className="mt-2 text-[12.5px] text-t3">
            Side-effect delivery through a transactional outbox
          </p>
        </div>
      </div>
    </Section>
  );
}
