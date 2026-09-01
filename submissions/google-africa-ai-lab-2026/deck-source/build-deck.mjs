import fs from "node:fs/promises";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const OUT = "/Users/pbash/repo/abada-engine/submissions/google-africa-ai-lab-2026";
const RENDER = `${OUT}/rendered`;
const ASSETS = `${OUT}/assets`;
const FINAL = `${OUT}/Abada-Google-Africa-AI-Lab-2026.pptx`;

const C = {
  bg: "#080B10",
  panel: "#101620",
  panel2: "#121B28",
  ink: "#F3F6FA",
  muted: "#93A0B4",
  blue: "#4C8DFF",
  blue2: "#1C5FD4",
  green: "#45E28D",
  amber: "#F7C65D",
  red: "#FF7A8A",
  line: "#263246",
};

async function writeBlob(path, blob) {
  await fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}

async function imageBytes(path) {
  const bytes = await fs.readFile(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function rect(slide, x, y, w, h, fill, radius = "rounded-xl", line = C.line) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : "rect",
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: "solid", fill: line, width: line === "none" ? 0 : 1 },
    ...(radius ? { borderRadius: radius } : {}),
  });
}

function txt(slide, text, x, y, w, h, size = 24, color = C.ink, opts = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontSize: size,
    color,
    bold: opts.bold ?? false,
    alignment: opts.align ?? "left",
    verticalAlignment: opts.valign ?? "top",
    autoFit: "shrinkText",
    insets: opts.insets ?? { left: 0, right: 0, top: 0, bottom: 0 },
  };
  return shape;
}

function accent(slide, x, y, w, color = C.green) {
  rect(slide, x, y, w, 4, color, null, "none");
}

function pill(slide, label, x, y, w, color = C.green) {
  rect(slide, x, y, w, 30, `${color}18`, "rounded-xl", `${color}66`);
  txt(slide, label, x, y + 2, w, 26, 13, color, { bold: true, align: "center", valign: "middle" });
}

function chrome(slide, title, number, kicker = "ABADA") {
  slide.background.fill = C.bg;
  txt(slide, kicker, 64, 38, 500, 24, 13, C.green, { bold: true });
  txt(slide, title, 64, 78, 1130, 66, 36, C.ink, { bold: true });
  txt(slide, String(number).padStart(2, "0"), 1182, 42, 40, 24, 13, C.muted, { align: "right" });
  accent(slide, 64, 150, 92, C.blue);
  txt(slide, "Google Africa Applied AI Lab · 2026", 64, 685, 420, 18, 11, "#66758C");
  txt(slide, "abadaplatform.com", 1030, 685, 190, 18, 11, "#66758C", { align: "right" });
}

function note(slide, body, sources) {
  slide.speakerNotes.textFrame.setText(`${body}\n\n[Sources]\n${sources.map((s) => `- ${s}`).join("\n")}`);
  slide.speakerNotes.setVisible(true);
}

function arrow(slide, x, y, w, color = C.blue) {
  slide.shapes.add({
    geometry: "rightArrow",
    position: { left: x, top: y, width: w, height: 28 },
    fill: color,
    line: { style: "solid", fill: color, width: 0 },
  });
}

function featureBand(slide, x, y, w, title, copy, color, tag) {
  rect(slide, x, y, w, 126, C.panel, "rounded-xl", C.line);
  accent(slide, x + 20, y + 19, 44, color);
  txt(slide, title, x + 20, y + 34, w - 40, 33, 22, C.ink, { bold: true });
  txt(slide, copy, x + 20, y + 72, w - 40, 43, 15, C.muted);
  if (tag) pill(slide, tag, x + w - 115, y + 14, 95, color);
}

const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

// 1 — Hook
{
  const s = deck.slides.add();
  s.background.fill = C.bg;
  txt(s, "ABADA", 64, 48, 260, 30, 16, C.green, { bold: true });
  pill(s, "OPEN SOURCE · SELF-HOSTED", 930, 46, 286, C.blue);
  txt(s, "Build processes that improve\nwith every execution", 64, 126, 1040, 150, 54, C.ink, { bold: true });
  txt(s, "Durable orchestration for AI agents, people and systems — with evidence-driven, human-governed change.", 64, 304, 950, 70, 23, C.muted);

  const labels = [
    ["CREATE OR IMPORT", C.blue],
    ["RUN", C.green],
    ["OBSERVE", C.amber],
    ["IMPROVE", C.green],
  ];
  labels.forEach(([label, color], i) => {
    const x = 64 + i * 286;
    rect(s, x, 430, 240, 92, C.panel, "rounded-xl", C.line);
    txt(s, label, x + 18, 451, 204, 28, 18, color, { bold: true, align: "center" });
    txt(s, ["Design · AI · BPMN", "Agents · humans · systems", "Facts · history · telemetry", "Validated proposals · review"][i], x + 16, 487, 208, 26, 13, C.muted, { align: "center" });
    if (i < 3) arrow(s, x + 242, 462, 42, C.blue2);
  });
  txt(s, "Patrick Bashizi · Democratic Republic of the Congo", 64, 628, 700, 26, 16, C.ink, { bold: true });
  txt(s, "abadaplatform.com", 970, 628, 246, 26, 16, C.blue, { align: "right" });
  note(s, "Open on the lifecycle, not on a file format. Abada supports both new process creation and bounded BPMN import.", [
    "Repository product documentation: docs/development/studio-app-spec.md",
    "Program: https://labs.google/aifuturesfund/africaailab",
  ]);
}

// 2 — Problem
{
  const s = deck.slides.add();
  chrome(s, "AI workflows need an operational lifecycle", 2);
  txt(s, "A model response takes seconds. A business process may run for days.", 64, 184, 1020, 42, 25, C.muted);
  const items = [
    ["DURABLE STATE", "Work must survive restarts and long waits.", C.blue],
    ["DETERMINISTIC CONTROL", "Decisions and retries cannot depend on model improvisation.", C.green],
    ["HUMAN AUTHORITY", "People must own approvals, exceptions and change adoption.", C.amber],
    ["OPERATIONAL EVIDENCE", "Attempts, latency, failures and outcomes must remain observable.", C.red],
  ];
  items.forEach(([t, c, color], i) => {
    const y = 258 + i * 82;
    rect(s, 64, y, 1090, 72, C.panel, "rounded-xl", C.line);
    accent(s, 84, y + 17, 44, color);
    txt(s, t, 146, y + 12, 320, 25, 19, C.ink, { bold: true });
    txt(s, c, 486, y + 14, 630, 34, 15, C.muted);
  });
  txt(s, "Abada connects these requirements in one governed lifecycle.", 64, 612, 1040, 34, 21, C.ink, { bold: true });
  note(s, "Frame the problem as the operational gap around AI, not as a critique of BPMN or XML.", [
    "Runtime semantics: docs/reference/runtime-semantics.md",
    "Persistence model: docs/architecture/runtime-state.md",
  ]);
}

// 3 — Lifecycle platform
{
  const s = deck.slides.add();
  chrome(s, "One platform for the full process lifecycle", 3);
  const phases = [
    { title: "CREATE OR IMPORT", sub: "Visual Studio\nAI authoring\nAPL or supported BPMN", color: C.blue },
    { title: "RUN", sub: "Gemini agents\nHuman work\nSystems + decisions", color: C.green },
    { title: "OBSERVE", sub: "Execution history\nAttempts + latency\nFailures + outcomes", color: C.amber },
    { title: "IMPROVE", sub: "Findings\nValidated proposal\nGoverned adoption", color: C.green },
  ];
  phases.forEach((p, i) => {
    const x = 64 + i * 286;
    if (i < 3) arrow(s, x + 236, 342, 50, C.blue2);
    rect(s, x, 242, 236, 240, C.panel, "rounded-xl", p.color);
    txt(s, String(i + 1), x + 18, 260, 36, 30, 18, p.color, { bold: true });
    txt(s, p.title, x + 18, 306, 200, 42, 20, C.ink, { bold: true, align: "center" });
    accent(s, x + 78, 356, 80, p.color);
    txt(s, p.sub, x + 20, 384, 196, 76, 16, C.muted, { align: "center" });
  });
  txt(s, "Studio", 104, 520, 146, 30, 18, C.blue, { bold: true, align: "center" });
  txt(s, "Engine + PostgreSQL", 344, 520, 222, 30, 18, C.green, { bold: true, align: "center" });
  txt(s, "Durable facts", 676, 520, 170, 30, 18, C.amber, { bold: true, align: "center" });
  txt(s, "Insight Engine", 972, 520, 180, 30, 18, C.green, { bold: true, align: "center" });
  txt(s, "Every participant advances the same versioned process state.", 64, 604, 1090, 34, 22, C.ink, { bold: true, align: "center" });
  note(s, "Walk left to right. Import is one option in the first phase; it is not the product identity.", [
    "Studio lifecycle: docs/development/studio-app-spec.md",
    "Insight lifecycle: docs/reference/insight-loop.md",
  ]);
}

// 4 — Creation screenshot
{
  const s = deck.slides.add();
  chrome(s, "Create intelligent processes", 4);
  s.images.add({
    blob: await imageBytes(`${ASSETS}/studio-lead-triage-canvas.png`),
    contentType: "image/png",
    alt: "Real Abada Studio canvas showing a lead-triage process created from native APL",
    fit: "cover",
    crop: { left: 0, top: 0.02, right: 0, bottom: 0.02 },
    position: { left: 64, top: 188, width: 744, height: 430 },
    geometry: "roundRect",
    borderRadius: "rounded-xl",
  });
  s.images.add({
    blob: await imageBytes(`${ASSETS}/studio-new-process.png`),
    contentType: "image/png",
    alt: "Real Abada Studio New Process dialog showing Empty APL, Import BPMN, and Paste APL",
    fit: "cover",
    crop: { left: 0.27, top: 0.19, right: 0.26, bottom: 0.12 },
    position: { left: 84, top: 408, width: 340, height: 188 },
    geometry: "roundRect",
    borderRadius: "rounded-xl",
  });
  pill(s, "REAL STUDIO", 674, 200, 120, C.green);
  txt(s, "Multiple entry points", 852, 198, 330, 38, 25, C.ink, { bold: true });
  const bullets = [
    ["Visual", "Start from a blank canvas."],
    ["AI-assisted", "Describe a process in plain language."],
    ["Native", "Author or paste reviewable APL."],
    ["Interoperable", "Import the supported BPMN subset."],
    ["Safe to explore", "Dry Run stays local and mocked."],
  ];
  bullets.forEach(([a, b], i) => {
    txt(s, a, 852, 262 + i * 68, 150, 26, 17, i === 3 ? C.amber : C.blue, { bold: true });
    txt(s, b, 852, 289 + i * 68, 330, 28, 14, C.muted);
  });
  txt(s, "APL is the native representation beneath Studio — not the whole product story.", 852, 592, 330, 50, 16, C.green, { bold: true });
  note(s, "Use the real Studio capture to establish that Abada creates new processes and also supports import.", [
    "Product captures: submissions/google-africa-ai-lab-2026/assets/studio-lead-triage-canvas.png and studio-new-process.png",
    "Studio specification: docs/development/studio-app-spec.md",
  ]);
}

// 5 — Gemini architecture
{
  const s = deck.slides.add();
  chrome(s, "Gemini becomes a governed workflow participant", 5);
  txt(s, "The model call is outside the workflow transaction. Its accepted result re-enters through the durable worker contract.", 64, 182, 1080, 50, 21, C.muted);
  const nodes = [
    ["STUDIO", "Model · prompt\noutput contract", C.blue],
    ["ENGINE", "Durable agent work\nPostgreSQL state", C.green],
    ["AGENT WORKER", "Bounded timeout\nvalidation · retry", C.blue],
    ["GEMINI", "Structured result\nconfidence", C.green],
  ];
  nodes.forEach(([title, sub, color], i) => {
    const x = 64 + i * 286;
    if (i < 3) arrow(s, x + 224, 337, 60, C.blue2);
    rect(s, x, 276, 224, 150, C.panel, "rounded-xl", color);
    txt(s, title, x + 18, 298, 188, 30, 19, color, { bold: true, align: "center" });
    txt(s, sub, x + 18, 348, 188, 60, 15, C.muted, { align: "center" });
  });
  rect(s, 210, 472, 860, 98, C.panel2, "rounded-xl", C.line);
  txt(s, "Persisted attempt metadata", 238, 491, 270, 28, 18, C.ink, { bold: true });
  txt(s, "resolved model · provider · attempt · duration · confidence · tools · error type · prompt hash", 238, 529, 790, 28, 15, C.muted);
  pill(s, "AT-LEAST-ONCE", 906, 486, 140, C.amber);
  txt(s, "Validated output drives deterministic routing to a person or system.", 64, 612, 1090, 34, 21, C.green, { bold: true, align: "center" });
  note(s, "Emphasize the durable boundary. Do not claim exactly-once model execution or executable function-calling tools today.", [
    "Agent worker contract: docs/reference/agent-worker.md",
    "External worker semantics: docs/reference/external-worker-protocol-v1.md",
  ]);
}

// 6 — Insight
{
  const s = deck.slides.add();
  chrome(s, "Insight turns evidence into governed improvement", 6);
  const stages = [
    ["FACTS", C.blue],
    ["FINDINGS", C.amber],
    ["VALIDATED PROPOSAL", C.green],
    ["HUMAN REVIEW", C.blue],
    ["NEW VERSION", C.green],
  ];
  stages.forEach(([title, color], i) => {
    const x = 54 + i * 238;
    if (i < 4) arrow(s, x + 190, 213, 46, C.blue2);
    rect(s, x, 184, 190, 86, C.panel, "rounded-xl", color);
    txt(s, title, x + 10, 208, 170, 34, 15, color, { bold: true, align: "center", valign: "middle" });
  });
  s.images.add({
    blob: await imageBytes(`${ASSETS}/studio-insight-real.png`),
    contentType: "image/png",
    alt: "Real Abada Studio Insight proposal generated from four persisted LOW lead-triage executions with Gemini 3.6 Flash",
    fit: "cover",
    crop: { left: 0.02, top: 0, right: 0.2, bottom: 0.01 },
    position: { left: 54, top: 300, width: 826, height: 316 },
    geometry: "roundRect",
    borderRadius: "rounded-xl",
  });
  pill(s, "REAL LOCAL EXECUTION", 70, 316, 178, C.green);
  rect(s, 908, 300, 290, 316, "#0F1C19", "rounded-xl", C.green);
  txt(s, "Gemini 3.6 Flash", 930, 326, 246, 30, 22, C.ink, { bold: true });
  accent(s, 930, 368, 62, C.green);
  txt(s, "4", 930, 392, 56, 54, 40, C.green, { bold: true });
  txt(s, "persisted LOW runs", 994, 405, 176, 28, 16, C.muted, { bold: true });
  txt(s, "FALLBACK_THRASH", 930, 466, 246, 28, 18, C.amber, { bold: true });
  txt(s, "The LLM proposed an explicit LOW rule. The definition remains unchanged until a person approves it.", 930, 502, 246, 76, 15, C.muted);
  pill(s, "NOT APPROVED", 1014, 574, 158, C.blue);
  note(s, "This is a real local execution captured on 31 August 2026. Four genuine LOW lead-triage runs used Gemini 3.6 Flash, produced persisted execution facts and triggered the FALLBACK_THRASH finding. The LLM-generated proposal adds an explicit LOW decision rule. It remains in Draft and was not approved.", [
    "Insight contract: docs/reference/insight-loop.md",
    "PostgreSQL integration evidence: engine/src/test/java/com/abada/engine/core/InsightLoopIntegrationTest.java",
    "Lead-triage demo definition: submissions/google-africa-ai-lab-2026/demo/lead-triage.apl.yaml",
    "Real execution capture: submissions/google-africa-ai-lab-2026/assets/studio-insight-real.png",
    "Model and execution date: Gemini 3.6 Flash · local execution · 2026-08-31",
  ]);
}

// 7 — Reliability
{
  const s = deck.slides.add();
  chrome(s, "Reliable and accountable by design", 7);
  txt(s, "1.0.0-rc.4", 64, 194, 380, 82, 50, C.green, { bold: true });
  txt(s, "Published evaluation release candidate", 66, 270, 500, 34, 19, C.muted);
  txt(s, "323", 832, 194, 210, 82, 50, C.blue, { bold: true, align: "right" });
  txt(s, "tests passed in the recorded release gate", 844, 270, 338, 40, 18, C.muted, { align: "right" });
  const facts = [
    ["PostgreSQL authority", "Mutable process state is database-authoritative."],
    ["Recovery", "Leases, retries and restart-safe acquisition."],
    ["Atomicity", "State, work, history and outbox commit together."],
    ["Governance", "Backend RBAC, audit and immutable versions."],
  ];
  facts.forEach(([title, copy], i) => {
    const x = 64 + (i % 2) * 564;
    const y = 350 + Math.floor(i / 2) * 128;
    featureBand(s, x, y, 530, title, copy, i % 2 ? C.blue : C.green, "IMPLEMENTED");
  });
  note(s, "Treat the release and test count as evidence, not as market traction. External effects remain at-least-once.", [
    "Release gate: docs/development/1.0-rc.4-gate-report-2026-08-30.md",
    "Runtime state architecture: docs/architecture/runtime-state.md",
    "Release notes: docs/release-notes/1.0.0-rc.4-release-notes.md",
  ]);
}

// 8 — BPMN interoperability
{
  const s = deck.slides.add();
  chrome(s, "Create natively. Import when needed.", 8);
  txt(s, "Interoperate across new processes and existing investments through an explicit compatibility boundary.", 64, 180, 1080, 42, 22, C.muted);
  const x = [64, 350, 636, 922];
  const labels = [
    ["CREATE", "Visual Studio\nAI authoring\nAPL", C.blue],
    ["IMPORT", "Supported BPMN\ncompatibility report", C.amber],
    ["EXECUTE", "One canonical graph\none durable runtime", C.green],
    ["EXPORT", "Supported round-trip\nfor interoperability", C.blue],
  ];
  labels.forEach(([title, sub, color], i) => {
    if (i < 3) arrow(s, x[i] + 220, 321, 54, C.blue2);
    rect(s, x[i], 256, 220, 160, C.panel, "rounded-xl", color);
    txt(s, title, x[i] + 18, 279, 184, 30, 19, color, { bold: true, align: "center" });
    txt(s, sub, x[i] + 18, 333, 184, 58, 15, C.muted, { align: "center" });
  });
  rect(s, 64, 468, 1090, 124, C.panel2, "rounded-xl", C.line);
  pill(s, "LIMITED", 86, 488, 100, C.amber);
  txt(s, "Standard BPMN 2.0 · Abada-native extensions · documented Camunda 7 profile", 210, 489, 900, 30, 18, C.ink, { bold: true });
  txt(s, "Unsupported execution semantics fail explicitly. Abada does not claim full BPMN coverage.", 86, 541, 1020, 28, 16, C.muted);
  note(s, "Keep this as an adoption and interoperability feature. Do not make legacy modernization the hook.", [
    "BPMN support: docs/reference/bpmn-support.md",
    "Compatibility profiles: docs/bpmn/compatibility-profiles.md",
    "Round-trip gate: studio/scripts/kitchen-sink-roundtrip.mts",
  ]);
}

// 9 — Africa + business
{
  const s = deck.slides.add();
  chrome(s, "Built for high-stakes operations in Africa", 9);
  const uses = [
    ["BANKING", "KYC · credit exceptions\nfraud review", C.blue],
    ["TELECOM", "Onboarding · incidents\nescalation", C.green],
    ["AGRITECH", "Producer cases · documents\nfield-data routing", C.amber],
    ["GOVTECH", "Citizen requests\nauditable approvals", C.blue],
  ];
  uses.forEach(([title, copy, color], i) => {
    const x = 64 + (i % 2) * 350;
    const y = 204 + Math.floor(i / 2) * 158;
    rect(s, x, y, 320, 132, C.panel, "rounded-xl", color);
    txt(s, title, x + 20, y + 20, 280, 28, 18, color, { bold: true });
    txt(s, copy, x + 20, y + 61, 280, 56, 16, C.muted);
  });
  rect(s, 808, 204, 372, 290, C.panel2, "rounded-xl", C.line);
  txt(s, "Commercial path", 838, 232, 310, 34, 24, C.ink, { bold: true });
  accent(s, 838, 280, 64, C.green);
  txt(s, "NOW", 838, 312, 80, 24, 14, C.green, { bold: true });
  txt(s, "Open-source core", 930, 307, 210, 30, 19, C.ink, { bold: true });
  txt(s, "FUTURE", 838, 370, 80, 24, 14, C.blue, { bold: true });
  txt(s, "Managed hosting\nEnterprise support", 930, 365, 210, 62, 19, C.ink, { bold: true });
  txt(s, "Self-hosting keeps deployment and data-location choices with the operator.", 838, 448, 310, 36, 15, C.muted);
  txt(s, "Target use cases — not customer traction or invented market size.", 64, 568, 1090, 34, 19, C.muted, { align: "center" });
  note(s, "Present these as target use cases. No market-size, customer-count or revenue claim is made.", [
    "Product positioning: README.md",
    "Deployment boundaries: docs/reference/deployment-support.md",
  ]);
}

// 10 — Ask
{
  const s = deck.slides.add();
  s.background.fill = C.bg;
  txt(s, "WHY GOOGLE AFRICA APPLIED AI LAB", 64, 52, 640, 28, 15, C.green, { bold: true });
  txt(s, "Turn Gemini capabilities into\nreliable workflow primitives", 64, 118, 1000, 124, 48, C.ink, { bold: true });
  txt(s, "Three-month focus", 64, 292, 280, 34, 23, C.muted);
  const roadmap = [
    ["01", "Governed function calling", "Structured external actions with operator-controlled tools."],
    ["02", "Multimodal agent nodes", "Document and image understanding inside durable processes."],
    ["03", "African-language evaluation", "Measure and improve process interactions across local languages."],
  ];
  roadmap.forEach(([n, title, copy], i) => {
    const y = 350 + i * 82;
    txt(s, n, 64, y, 50, 34, 18, C.blue, { bold: true });
    txt(s, title, 130, y, 360, 30, 20, C.ink, { bold: true });
    txt(s, copy, 510, y + 1, 610, 42, 16, C.muted);
    if (i < 2) rect(s, 64, y + 62, 1080, 1, C.line, null, "none");
  });
  rect(s, 64, 610, 1090, 1, C.line, null, "none");
  txt(s, "Patrick Bashizi", 64, 630, 330, 30, 21, C.ink, { bold: true });
  txt(s, "Founder · Democratic Republic of the Congo", 414, 632, 480, 26, 16, C.muted);
  txt(s, "bashizip@gmail.com · abadaplatform.com", 830, 632, 324, 26, 16, C.blue, { align: "right" });
  note(s, "Close on concrete work the Lab can accelerate. Function calling, multimodal nodes and African-language evaluation are roadmap items, not current-product claims.", [
    "Abada 1.1 roadmap: docs/development/roadmap-to-1.1.0-rc.md",
    "Program: https://labs.google/aifuturesfund/africaailab",
  ]);
}

await fs.mkdir(RENDER, { recursive: true });
for (const [i, slide] of deck.slides.items.entries()) {
  const stem = `slide-${String(i + 1).padStart(2, "0")}`;
  await writeBlob(`${RENDER}/${stem}.png`, await deck.export({ slide, format: "png", scale: 1.5 }));
  await fs.writeFile(`${RENDER}/${stem}.layout.json`, await (await slide.export({ format: "layout" })).text());
}
await writeBlob(`${RENDER}/montage.webp`, await deck.export({ format: "webp", montage: true, scale: 1 }));
const pptx = await PresentationFile.exportPptx(deck);
await pptx.save(FINAL);
console.log(FINAL);
