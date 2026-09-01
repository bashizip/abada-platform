const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("/Users/pbash/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp");

const root = path.resolve(__dirname, "..");
const out = path.join(__dirname, "caption-frames");

const frames = [
  ["assets/studio-new-process.png", ["Create from scratch, import supported BPMN,", "or paste Abada's native process definition."]],
  ["assets/studio-lead-triage-live.png", ["Lead Triage combines Gemini, deterministic decisions,", "human review, and local system adapters."]],
  ["assets/studio-gemini-config.png", ["Model, prompt, JSON contract, confidence, timeout,", "and durable retries are governed properties."]],
  ["assets/studio-operations-runs.png", ["Five real executions completed in PostgreSQL.", "The Agent Worker is online; no run needs intervention."]],
  ["assets/studio-high-result.png", ["The HIGH run persisted Gemini's result, 100% confidence,", "human approval, and the local CRM acknowledgement."]],
  ["assets/studio-insight-real.png", ["Four LOW runs produced FALLBACK_THRASH.", "Insight generated a proposal with Approve and Reject controls."]],
  ["assets/studio-insight-apl-diff.png", ["The diff adds an explicit LOW rule but remains unapproved:", "no silent self-modification."]],
  ["rendered/slide-01.png", ["Create or import. Run. Observe. Improve.", "abadaplatform.com"]],
];

const escapeXml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function main() {
  await fs.mkdir(out, { recursive: true });
  for (let i = 0; i < frames.length; i += 1) {
    const [relative, lines] = frames[i];
    const base = await sharp(path.join(root, relative))
      .resize(1920, 1080, { fit: "contain", background: "#080B10" })
      .png()
      .toBuffer();
    const caption = Buffer.from(`
      <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
        <rect x="205" y="876" width="1510" height="142" rx="24" fill="#080B10" fill-opacity="0.90" stroke="#4C8DFF" stroke-opacity="0.55" stroke-width="2"/>
        <text x="960" y="930" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#F3F6FA">${escapeXml(lines[0])}</text>
        <text x="960" y="981" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="500" fill="#D7DFEA">${escapeXml(lines[1])}</text>
      </svg>`);
    await sharp(base)
      .composite([{ input: caption, top: 0, left: 0 }])
      .png()
      .toFile(path.join(out, `frame-${String(i + 1).padStart(2, "0")}.png`));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
