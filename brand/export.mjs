// Generates every Abada logo asset from one geometry definition.
//
//   node brand/export.mjs            SVGs + PNG/ICO rasters, then copies them
//                                    to Studio, the website, the docs and the
//                                    mobile app
//   node brand/export.mjs --svg-only SVGs only (no browser needed)
//
// Rasters are rendered with Playwright's Chromium. Resolve it from a local or
// global install, e.g. `NODE_PATH=$(npm root -g) node brand/export.mjs`, and
// set PLAYWRIGHT_CHROMIUM to a browser binary if Playwright has none of its own.
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BRAND = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(BRAND);

export const COLORS = {
  emerald: "#34D399", // platform mark on dark surfaces
  emeraldDeep: "#0F7A5C", // platform mark on light surfaces
  ink: "#05070A", // platform tile, mono dark
  amethyst: "#9D4EDD", // Studio mark
  saffron: "#F4A261", // Studio gateway accent
  mocha: "#25201D", // Studio tile gradient end
  onTile: "#F4EEFB", // Studio mark on its amethyst tile
  white: "#FFFFFF", // mono light
};

// The "governed A" on a 48-unit grid: two flow edges rise to an approval node,
// a gateway diamond sits between them, agent terminals end the feet.
const full = (stroke, gate) => `
  <path d="M9 41.5 24 11 39 41.5" fill="none" stroke="${stroke}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M24 27.7 28.8 32.5 24 37.3 19.2 32.5Z" fill="${gate}"/>
  <circle cx="24" cy="11" r="6.5" fill="${stroke}"/>
  <circle cx="9" cy="41.5" r="4.8" fill="${stroke}"/>
  <circle cx="39" cy="41.5" r="4.8" fill="${stroke}"/>`;

// Cut for 24px and below: heavier edges, no terminals, the gateway bridges the legs.
const small = (stroke, gate) => `
  <path d="M9 42 24 9 39 42" fill="none" stroke="${stroke}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M24 25 29.5 30.5 24 36 18.5 30.5Z" fill="${gate}"/>`;

const svg = (body, title = "Abada") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="${title}">${body}\n</svg>\n`;

// Mark centred on a tile. `rx` 0 gives a full-bleed square for store icons.
const tile = ({ mark, fill, rx = 11, scale }) => {
  const [cx, cy] = mark === full ? [24, 25.4] : [24, 25.5];
  return (stroke, gate, defs = "") => `${defs}
  <rect width="48" height="48" rx="${rx}" fill="${fill}"/>
  <g transform="translate(24 24) scale(${scale}) translate(${-cx} ${-cy})">${mark(stroke, gate)}</g>`;
};

const studioGradient = `
  <defs><linearGradient id="abada-studio-tile" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${COLORS.amethyst}"/><stop offset="1" stop-color="${COLORS.mocha}"/>
  </linearGradient></defs>`;

const c = COLORS;
const SVGS = {
  // Marks without a background
  "abada-mark.svg": svg(full(c.emerald, c.emerald)),
  "abada-mark-deep.svg": svg(full(c.emeraldDeep, c.emeraldDeep)),
  "abada-mark-studio.svg": svg(full(c.amethyst, c.saffron)),
  "abada-mark-mono-dark.svg": svg(full(c.ink, c.ink)),
  "abada-mark-mono-light.svg": svg(full(c.white, c.white)),
  "abada-mark-small.svg": svg(small(c.emerald, c.emerald)),
  // App icons: the mark on its product tile
  "abada-app-icon.svg": svg(tile({ mark: full, fill: c.ink, scale: 0.66 })(c.emerald, c.emerald)),
  "abada-app-icon-studio.svg": svg(
    tile({ mark: full, fill: "url(#abada-studio-tile)", scale: 0.66 })(c.onTile, c.saffron, studioGradient),
    "Abada Studio",
  ),
  // Favicons use the small cut, which stays legible in a 16px browser tab
  "abada-favicon.svg": svg(tile({ mark: small, fill: c.ink, scale: 0.7 })(c.emerald, c.emerald)),
  "abada-favicon-studio.svg": svg(
    tile({ mark: small, fill: "url(#abada-studio-tile)", scale: 0.7 })(c.onTile, c.saffron, studioGradient),
    "Abada Studio",
  ),
  // Store icon (square, the platform masks the corners) and Android adaptive foreground
  "abada-store-icon.svg": svg(tile({ mark: full, fill: c.ink, rx: 0, scale: 0.56 })(c.emerald, c.emerald)),
  "abada-adaptive-foreground.svg": svg(
    `<g transform="translate(24 24) scale(0.46) translate(-24 -25.4)">${full(c.emerald, c.emerald)}</g>`,
  ),
};

mkdirSync(join(BRAND, "svg"), { recursive: true });
for (const [name, content] of Object.entries(SVGS)) writeFileSync(join(BRAND, "svg", name), content);
console.log(`wrote ${Object.keys(SVGS).length} SVGs to brand/svg`);

if (process.argv.includes("--svg-only")) process.exit(0);

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const page = await browser.newPage();

// Renders an SVG (or several stacked layers) into a transparent PNG buffer.
async function render(name, width, height = width, { background = "transparent", markSize } = {}) {
  const src = `data:image/svg+xml;base64,${Buffer.from(SVGS[name]).toString("base64")}`;
  const size = markSize ?? Math.min(width, height);
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<html><body style="margin:0;width:${width}px;height:${height}px;display:grid;place-items:center;background:${background}">` +
      `<img src="${src}" style="width:${size}px;height:${size}px"></body></html>`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: background === "transparent" });
}

// Windows ICO holding PNG entries (supported since Vista and by every browser).
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const png = (file, data) => writeFileSync(join(BRAND, "png", file), data);
mkdirSync(join(BRAND, "png"), { recursive: true });

// Renders one after another: every render shares the same page.
async function icoFrom(name) {
  const entries = [];
  for (const size of [16, 32, 48]) entries.push({ size, data: await render(name, size) });
  return ico(entries);
}

png("favicon.ico", await icoFrom("abada-favicon.svg"));
png("favicon-studio.ico", await icoFrom("abada-favicon-studio.svg"));
png("apple-touch-icon.png", await render("abada-store-icon.svg", 180));
png("icon-512.png", await render("abada-app-icon.svg", 512));
png("icon-1024.png", await render("abada-store-icon.svg", 1024));
png("adaptive-icon-1024.png", await render("abada-adaptive-foreground.svg", 1024));
png("favicon-64.png", await render("abada-favicon.svg", 64));
png("splash-750x1624.png", await render("abada-mark.svg", 750, 1624, { background: COLORS.ink, markSize: 220 }));
await browser.close();
console.log("wrote rasters to brand/png");

// Copy the product variants to where each app serves them.
const copies = [
  ["svg/abada-favicon-studio.svg", "studio/public/favicon.svg"],
  ["svg/abada-app-icon-studio.svg", "studio/public/abada-app-icon.svg"],
  ["png/favicon-studio.ico", "studio/public/favicon.ico"],
  ["svg/abada-mark.svg", "abada-site/packages/web/public/logo.svg"],
  ["svg/abada-favicon.svg", "abada-site/packages/web/public/favicon.svg"],
  ["png/favicon.ico", "abada-site/packages/web/public/favicon.ico"],
  ["png/apple-touch-icon.png", "abada-site/packages/web/public/apple-touch-icon.png"],
  ["svg/abada-favicon.svg", "documentation/public/favicon.svg"],
  ["svg/abada-mark.svg", "documentation/src/assets/abada-mark.svg"],
  ["svg/abada-mark-deep.svg", "documentation/src/assets/abada-mark-deep.svg"],
  ["png/icon-1024.png", "abada-site/packages/mobile/assets/icon.png"],
  ["png/adaptive-icon-1024.png", "abada-site/packages/mobile/assets/adaptive-icon.png"],
  ["png/favicon-64.png", "abada-site/packages/mobile/assets/favicon.png"],
  ["png/splash-750x1624.png", "abada-site/packages/mobile/assets/splash-icon.png"],
];
for (const [from, to] of copies) {
  mkdirSync(dirname(join(ROOT, to)), { recursive: true });
  copyFileSync(join(BRAND, from), join(ROOT, to));
}
console.log(`copied ${copies.length} assets into the apps`);
