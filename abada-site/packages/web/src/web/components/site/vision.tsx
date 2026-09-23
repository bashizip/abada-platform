import { Reveal, Section, SectionHead } from "./primitives";

const POINTS = [
  {
    title: "High-Stakes Infrastructure",
    body: "Architected high-volume payment switches and national digital platforms where strict state determinism and transactional integrity are non-negotiable.",
  },
  {
    title: "SRE Discipline for Autonomous Agents",
    body: "Built from deep Site Reliability Engineering principles to survive network drops, concurrency spikes, and edge-case failures without losing state.",
  },
  {
    title: "Production Rigor",
    body: "Complete Abada stack — Engine, Studio, Agent Worker, Insight Loop — released through recorded PostgreSQL release gates covering restart, upgrade and concurrency.",
  },
];

export function Vision() {
  return (
    <Section id="vision" alt>
      <SectionHead
        eyebrow="Vision"
        title="Built from Mission-Critical Systems, Not AI Hype"
      />

      <div className="mt-8 max-w-3xl">
        <figure className="border-l-2 border-signal/60 pl-5">
          <blockquote className="text-[1.0625rem] leading-relaxed text-t1">
            &ldquo;I didn&rsquo;t arrive at durable orchestration from an AI framework — I arrived
            from a decade of engineering high-stakes platforms where a dropped
            transaction is real revenue lost and every execution path must be
            reconstructible.&rdquo;
          </blockquote>
          <figcaption className="mt-3 text-[13px] text-t3">
            — Patrick Bashizi, Founder &amp; Systems Architect
          </figcaption>
        </figure>
      </div>

      <Reveal delay={80}>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline md:grid-cols-3">
          {POINTS.map((p) => (
            <div key={p.title} className="bg-surface/40 p-5">
              <p className="text-[14.5px] font-medium text-t1">{p.title}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-t2">{p.body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
