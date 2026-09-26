import { Reveal, Section, SectionHead } from "./primitives";

const INSIDE = [
  { name: "Studio", detail: "Design, tasks, operations" },
  { name: "Engine", detail: "Processes, rules, agent contract" },
  { name: "Agent worker", detail: "Model calls, outside the transaction" },
  { name: "PostgreSQL", detail: "The only database" },
];

const YOURS = [
  { name: "Identity provider", detail: "Your existing OIDC provider" },
  { name: "Model endpoint", detail: "OpenAI-compatible, in your network or hosted" },
];

const CONTROLS = [
  {
    what: "Model calls",
    how: "Go only to the endpoint you configure, with only the inputs each step declares.",
  },
  {
    what: "Telemetry",
    how: "Off by default. When enabled, it goes to your own collector.",
  },
  {
    what: "Operations",
    how: "Deploy, back up and upgrade it like any other service in your estate.",
  },
];

function Box({ name, detail, tone = "signal" }: { name: string; detail: string; tone?: "signal" | "wire" }) {
  return (
    <div
      className={
        tone === "signal"
          ? "rounded-lg border border-signal/25 bg-signal/[0.06] px-4 py-3"
          : "rounded-lg border border-wire/25 bg-wire/[0.06] px-4 py-3"
      }
    >
      <p className="text-[14px] font-semibold">{name}</p>
      <p className="mt-0.5 text-[12px] leading-snug text-t2">{detail}</p>
    </div>
  );
}

export function Boundary() {
  return (
    <Section id="sovereignty" alt>
      <SectionHead
        eyebrow="Sovereignty"
        title="The whole platform runs inside your walls."
        lead="No vendor cloud, no licence server, no external account."
      />

      <div className="mt-12 grid gap-8 lg:grid-cols-12">
        <Reveal className="lg:col-span-7">
          <div className="relative rounded-2xl border border-dashed border-signal/40 p-5 pt-9 md:p-7 md:pt-10">
            <span className="absolute -top-3 left-5 bg-ink-alt px-2 font-mono text-[10.5px] tracking-[0.16em] text-signal uppercase">
              Your infrastructure
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              {INSIDE.map((box) => (
                <Box key={box.name} {...box} />
              ))}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {YOURS.map((box) => (
                <Box key={box.name} {...box} tone="wire" />
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal className="lg:col-span-5" delay={100}>
          <p className="mono-label">You decide what leaves</p>
          <ul className="mt-5 divide-y divide-hairline border-y border-hairline">
            {CONTROLS.map((item) => (
              <li key={item.what} className="py-4">
                <p className="text-[14px] font-semibold text-t1">{item.what}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-t2">{item.how}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}
