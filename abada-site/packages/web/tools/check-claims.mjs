// Fails the build when a retracted or unsupported public claim reappears.
// See docs/development/m1-task-specs.md (T12). Add phrases here; do not remove
// one unless the product now proves the claim with code and tests.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RETRACTED = [
  "auto-optimizes",
  "self-optimizing",
  "native agentic loop",
  "function calling",
  "dynamic tool registr",
  "legacy engine",
  "legacy process engine",
  "ai as a rest call",
  "static rest connector",
  "agent is inside the transaction",
  "participant inside the transaction",
  "tools used",
  "gemini-native",
  "84-second",
  "pure gitops",
  "no lost transactions",
  "auto-pr",
  "the only engine that",
  "@gnail.com",
  "improves itself",
  "improves from its own",
  "autonomous agents",
  "both are bpmn-based",
  "autonomous ai agents",
  "acid rails",
  "zero outbound",
  "air-gapped certified",
  "five-year-old",
];

// Personal contact details and location are not published on the site.
const PRIVATE = [
  "patrick@",
  "mailto:",
  "democratic republic of the congo",
  "dr congo",
  "drc",
];

const roots = [new URL("../src", import.meta.url).pathname,
               new URL("../index.html", import.meta.url).pathname,
               new URL("./og-image.mjs", import.meta.url).pathname];
const files = [];
const walk = (path) => {
  if (statSync(path).isDirectory()) readdirSync(path).forEach((entry) => walk(join(path, entry)));
  else if (/\.(tsx?|html|md|mjs)$/.test(path)) files.push(path);
};
roots.forEach(walk);

const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8").toLowerCase();
  for (const phrase of RETRACTED) if (text.includes(phrase)) hits.push(`${file}: "${phrase}"`);
  for (const phrase of PRIVATE) {
    const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (pattern.test(text)) hits.push(`${file}: private detail "${phrase}"`);
  }
}
if (hits.length) {
  console.error("Retracted claims or private details found:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`Claims check OK — ${files.length} files, ${RETRACTED.length} retracted phrases, ${PRIVATE.length} private details.`);
