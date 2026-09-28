import { useEffect, useRef } from "react";
import { Reveal, Section, SectionHead } from "./primitives";

// Content hash of the current videos. /videos/* is cached for a week at the
// edge, so a new take needs new URLs; scripts/showcase/build.sh --publish
// updates this value.
const VIDEO_VERSION = "e6f9d7a5bd";
const videoUrl = (file: string) => `/videos/${file}?v=${VIDEO_VERSION}`;

const STEPS = [
  { n: "01", label: "Design", body: "The canvas draws the process in BPMN notation. The agent step declares its model, output schema and confidence threshold; its outcome routes are dashed." },
  { n: "02", label: "Run", body: "The worker calls the model outside the transaction and the engine checks the answer. The live view lights only the path the engine took." },
  { n: "03", label: "Approve", body: "A reviewer who did not author the process claims the task and signs off." },
  { n: "04", label: "Audit", body: "The audit trail records each lock, rule, claim and completion." },
];

export function Showcase() {
  const video = useRef<HTMLVideoElement | null>(null);

  // Play only while on screen, and never for visitors who asked for less motion.
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void node.play().catch(() => {});
        else node.pause();
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Section id="studio">
      <SectionHead
        eyebrow="Studio"
        title={
          <>
            One governed process, <span className="text-signal">end to end.</span>
          </>
        }
        lead="Recorded on a local 1.0.0-rc.6 stack with the BPMN-notation canvas: the Lead Triage starter is laid out vertically and deployed, an agent classifies a lead, a second person approves it and the audit trail keeps the record."
      />

      <Reveal className="mt-12">
        <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
          <video
            ref={video}
            className="block aspect-video w-full"
            poster={videoUrl("abada-studio-showcase-poster.jpg")}
            controls
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Abada Studio walkthrough on the BPMN-notation canvas in vertical layout: design, run, approve and audit a lead-triage process"
          >
            <source src={videoUrl("abada-studio-showcase.webm")} type="video/webm" />
            <source src={videoUrl("abada-studio-showcase.mp4")} type="video/mp4" />
          </video>
        </div>
      </Reveal>

      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <Reveal key={step.n} delay={i * 70}>
            <div className="h-full bg-ink p-5">
              <p className="font-mono text-[11px] tracking-[0.16em] text-signal uppercase">
                {step.n} · {step.label}
              </p>
              <p className="mt-3 text-[13.5px] leading-relaxed text-t2">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
