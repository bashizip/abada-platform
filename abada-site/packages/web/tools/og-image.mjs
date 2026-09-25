// Renders public/og-image.png (1200x630), the preview shown when a link to the
// site is shared. Run `bun run og:image` after changing the message or the
// release, so shared links never advertise retracted claims.
import sharp from "sharp";
import { readFileSync } from "node:fs";

const release = readFileSync(new URL("../src/web/lib/release.ts", import.meta.url), "utf8")
  .match(/RELEASE_VERSION = "([^"]+)"/)[1];

const INK = "#05070A";
const SIGNAL = "#34D399";
const T1 = "#F5F7FA";
const T2 = "#94A3B8";
const T3 = "#5B6675";
const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";
const MONO = "Menlo, SF Mono, monospace";

const grid = Array.from({ length: 20 }, (_, i) => i * 64)
  .map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="630" stroke="#ffffff" stroke-opacity="0.035"/>`)
  .concat(Array.from({ length: 10 }, (_, i) => i * 64)
    .map((y) => `<line x1="0" y1="${y}" x2="1200" y2="${y}" stroke="#ffffff" stroke-opacity="0.035"/>`))
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="45%" cy="0%" r="60%">
      <stop offset="0%" stop-color="${SIGNAL}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${SIGNAL}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${INK}"/>
  ${grid}
  <rect width="1200" height="630" fill="url(#glow)"/>

  <rect x="72" y="68" width="40" height="40" rx="9" fill="${SIGNAL}"/>
  <text x="92" y="96" text-anchor="middle" font-family="${SANS}" font-size="22" font-weight="700" fill="${INK}">A</text>
  <text x="126" y="97" font-family="${SANS}" font-size="26" font-weight="700" fill="${T1}">Abada</text>

  <rect x="700" y="70" width="428" height="36" rx="18" fill="#0D1117" stroke="#ffffff" stroke-opacity="0.12"/>
  <text x="914" y="93" text-anchor="middle" font-family="${MONO}" font-size="13" letter-spacing="2" fill="${T2}">OPEN SOURCE · AGPL-3.0 · ${release.toUpperCase()}</text>

  <text x="72" y="248" font-family="${SANS}" font-size="70" font-weight="700" letter-spacing="-2" fill="${T1}">AI in your critical processes.</text>
  <text x="72" y="330" font-family="${SANS}" font-size="70" font-weight="700" letter-spacing="-2" fill="${SIGNAL}">On infrastructure you control.</text>

  <text x="72" y="398" font-family="${SANS}" font-size="25" fill="${T2}">Self-hosted, with PostgreSQL as the only database, your identity provider</text>
  <text x="72" y="432" font-family="${SANS}" font-size="25" fill="${T2}">and the model endpoint you choose. The engine checks every AI answer.</text>

  <line x1="72" y1="516" x2="1128" y2="516" stroke="#ffffff" stroke-opacity="0.08"/>
  <circle cx="76" cy="553" r="4" fill="${SIGNAL}"/>
  <text x="96" y="558" font-family="${MONO}" font-size="14" letter-spacing="2.5" fill="${T3}">ABADAPLATFORM.COM · SELF-HOSTED · BUILT IN THE DR CONGO</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(new URL("../public/og-image.png", import.meta.url).pathname);
console.log(`og-image.png written for ${release}`);
