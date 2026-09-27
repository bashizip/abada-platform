// Renders the static layers of the showcase (background, intro/outro cards,
// caption overlays) as 1920x1080 PNGs in the site's visual language.
// Usage: node cards.mjs <outDir> <captions.json>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] || 'cards';
const captions = JSON.parse(fs.readFileSync(process.argv[3] || 'captions.json', 'utf8'));
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'captions.json'), JSON.stringify(captions, null, 1));

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 46" fill="none"><path fill="#34d399" d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"/></svg>`;

const base = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=block" rel="stylesheet">
<style>
  :root { --ink:#05070A; --signal:#34D399; --text:#F5F7FA; --muted:#94A3B8; --tert:#5B6675; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1920px; height:1080px; overflow:hidden; font-family:Geist, sans-serif; color:var(--text); -webkit-font-smoothing:antialiased; }
  .bg { position:absolute; inset:0; background:var(--ink); }
  .bg::before { content:""; position:absolute; inset:0;
    background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
    background-size: 48px 48px; mask-image: radial-gradient(ellipse 75% 70% at 50% 45%, #000 30%, transparent 85%); }
  .bg::after { content:""; position:absolute; inset:0;
    background: radial-gradient(ellipse 55% 45% at 50% 38%, rgba(52,211,153,.10), transparent 70%); }
  .mono { font-family:'Geist Mono', monospace; text-transform:uppercase; letter-spacing:.18em; }
</style>`;

const pages = {
  background: `${base}<div class="bg"></div>`,
  intro: `${base}<div class="bg"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px">
      <div style="display:flex;align-items:center;gap:22px">
        <div style="width:78px;height:75px">${LOGO}</div>
        <div style="font-size:78px;font-weight:600;letter-spacing:-.03em">Abada Studio</div>
      </div>
      <div style="font-size:30px;color:var(--muted);max-width:1100px;text-align:center;line-height:1.4">
        Design, run and govern AI-driven business processes<br>on infrastructure you control.
      </div>
      <div class="mono" style="font-size:15px;color:var(--signal);margin-top:10px">1.0.0-rc.6 · self-hosted · AGPL-3.0</div>
    </div>`,
  outro: `${base}<div class="bg"></div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:40px">
      <div style="width:70px;height:67px">${LOGO}</div>
      <div style="font-size:62px;font-weight:600;letter-spacing:-.025em;text-align:center;line-height:1.12">
        Agents advise. Rules decide.<br>Humans approve. <span style="color:var(--signal)">PostgreSQL remembers.</span>
      </div>
      <div class="mono" style="font-size:18px;color:var(--muted)">abadaplatform.com</div>
    </div>`,
};

captions.forEach((c, i) => {
  pages[`caption-${i}`] = `${base}<style>html,body{background:transparent}</style>
    <div style="position:absolute;left:0;right:0;top:958px;display:flex;justify-content:center">
      <div style="display:flex;align-items:baseline;gap:22px">
        <span class="mono" style="font-size:17px;color:var(--signal)">${c.eyebrow}</span>
        <span style="font-size:34px;font-weight:500;letter-spacing:-.015em">${c.text}</span>
      </div>
    </div>`;
});

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const [name, html] of Object.entries(pages)) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${name}.png`), omitBackground: name.startsWith('caption') });
}
await browser.close();
console.log('rendered', Object.keys(pages).length, 'layers to', out);
