import { Send } from "lucide-react";
import { PILOT_FORM_ACTION } from "../../lib/links";
import { Reveal, Section, SectionHead } from "./primitives";

const STEPS = [
  {
    title: "Choose one process",
    body: "Where AI helps but accountability is non-negotiable.",
  },
  {
    title: "Model it with your reviewers",
    body: "In APL, readable YAML your analysts and auditors can review.",
  },
  {
    title: "Run it on your infrastructure",
    body: "Your servers, identity provider and model endpoint.",
  },
  {
    title: "Review the evidence together",
    body: "What agents proposed, what rules decided, where people stepped in.",
  },
];

const FIELD =
  "mt-1.5 w-full rounded-lg border border-hairline-strong bg-ink px-3.5 py-2.5 text-[14px] text-t1 placeholder:text-t3 transition-colors focus:border-signal/60 focus:outline-none";

export function Pilot() {
  return (
    <Section id="pilot">
      <div className="grid gap-12 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <SectionHead
            eyebrow="Design-partner pilot"
            title="Put one real process on it."
            lead="We are working with a small number of design partners to run one consequential process on their own infrastructure."
          />
          <ol className="mt-8 space-y-5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-signal/15 font-mono text-[12px] font-medium text-signal">
                  {i + 1}
                </span>
                <div>
                  <p className="text-[15px] font-semibold">{step.title}</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-t2">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <Reveal className="lg:col-span-7">
          <form
            action={PILOT_FORM_ACTION}
            method="POST"
            className="rounded-xl border border-hairline bg-surface/40 p-6 md:p-8"
          >
            <p className="mono-label text-signal!">Propose a pilot</p>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="block text-[13px] font-medium text-t2">
                Name
                <input type="text" name="name" autoComplete="name" required className={FIELD} />
              </label>
              <label className="block text-[13px] font-medium text-t2">
                Work email
                <input type="email" name="email" autoComplete="email" required className={FIELD} />
              </label>
              <label className="block text-[13px] font-medium text-t2 sm:col-span-2">
                Organisation
                <input type="text" name="organisation" autoComplete="organization" className={FIELD} />
              </label>
              <label className="block text-[13px] font-medium text-t2 sm:col-span-2">
                The process you have in mind
                <textarea
                  name="message"
                  rows={5}
                  required
                  placeholder="What it does today, where AI would help, and who reviews the decisions."
                  className={`${FIELD} resize-y`}
                />
              </label>
            </div>
            {/* Spam honeypot: hidden from people, filled in by bots. */}
            <input
              type="checkbox"
              name="botcheck"
              className="hidden"
              style={{ display: "none" }}
              tabIndex={-1}
              autoComplete="off"
            />
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-lg bg-signal px-5 py-3 text-[15px] font-medium text-[#04150f] transition-opacity hover:opacity-90"
              >
                <Send className="size-4" />
                Send
              </button>
              <p className="text-[12.5px] leading-relaxed text-t3">
                Sent directly to the founder. No licence fee.
              </p>
            </div>
          </form>
        </Reveal>
      </div>
    </Section>
  );
}
