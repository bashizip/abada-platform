import { ArrowRight } from "lucide-react";
import { Reveal, Section, SectionHead } from "./primitives";

const INSIDE = [
  { name: "Studio", detail: "Design, tasks, operations" },
  { name: "Engine", detail: "Processes, rules, agent contract" },
  { name: "Agent worker", detail: "Calls the model, outside the transaction" },
  { name: "PostgreSQL", detail: "The only database" },
];

const YOURS = [
  { name: "Identity provider", detail: "The OIDC provider you already run" },
  { name: "Model endpoint", detail: "OpenAI-compatible — can run inside your network" },
];

const CROSSINGS = [
  {
    what: "Model calls",
    how: "Go only to the endpoint you configure. Run the model inside your network and nothing leaves.",
  },
  {
    what: "Telemetry",
    how: "Off by default. When you enable it, metrics, traces and logs go to your own collector.",
  },
  {
    what: "Installation",
    how: "Images come from a public registry. Mirror them into your own registry if your network requires it.",
  },
  {
    what: "Studio fonts",
    how: "Studio in 1.0.0-rc.6 still loads its web fonts from Google Fonts. They are bundled from the next release, so opening Studio will contact nothing outside your deployment.",
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
        eyebrow="Sovereignty, concretely"
        title="Draw the line around your data centre. Abada fits inside it."
        lead="No vendor cloud, no licence server, no account to create. The whole platform is a few containers and a PostgreSQL database that you deploy, back up and govern like the rest of your estate."
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
            <div className="mt-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-hairline" />
              <span className="font-mono text-[10px] tracking-[0.16em] text-t3 uppercase">
                Already yours
              </span>
              <span className="h-px flex-1 bg-hairline" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {YOURS.map((box) => (
                <Box key={box.name} {...box} tone="wire" />
              ))}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-hairline bg-surface/40 px-4 py-3">
            <ArrowRight className="size-4 shrink-0 text-t3" />
            <p className="text-[12.5px] leading-relaxed text-t3">
              Optional, and only if you choose it: a hosted model API such as Gemini. The agent
              worker sends it each agent step's prompt and its declared inputs — nothing else.
            </p>
          </div>
        </Reveal>

        <Reveal className="lg:col-span-5" delay={100}>
          <p className="mono-label">Everything that can cross the line</p>
          <ul className="mt-5 divide-y divide-hairline border-y border-hairline">
            {CROSSINGS.map((item) => (
              <li key={item.what} className="py-4">
                <p className="text-[14px] font-semibold text-t1">{item.what}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-t2">{item.how}</p>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[12.5px] leading-relaxed text-t3">
            Production needs PostgreSQL, a reverse proxy (Traefik is included) and your identity
            provider. Keycloak ships for development only.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
