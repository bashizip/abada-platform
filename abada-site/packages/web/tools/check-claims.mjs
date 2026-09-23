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
  "bashizip@gnail.com",
];

const roots = [new URL("../src", import.meta.url).pathname,
               new URL("../index.html", import.meta.url).pathname];
const files = [];
const walk = (path) => {
  if (statSync(path).isDirectory()) readdirSync(path).forEach((entry) => walk(join(path, entry)));
  else if (/\.(tsx?|html|md)$/.test(path)) files.push(path);
};
roots.forEach(walk);

const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8").toLowerCase();
  for (const phrase of RETRACTED) if (text.includes(phrase)) hits.push(`${file}: "${phrase}"`);
}
if (hits.length) {
  console.error("Retracted claims found:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`Claims check OK — ${files.length} files, ${RETRACTED.length} retracted phrases.`);
