// Scripted capture: drives a page, stores CDP screencast frames with their
// timestamps and logs a timeline (cursor path, clicks, camera, captions, marks)
// that compose.py turns into the final video.
import fs from 'node:fs';
import path from 'node:path';

const now = () => Date.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Recorder {
  constructor(page, name, outDir) {
    this.page = page;
    this.name = name;
    this.dir = path.join(outDir, name);
    fs.mkdirSync(path.join(this.dir, 'frames'), { recursive: true });
    this.frames = [];
    this.events = [];
    this.cursor = { x: 800, y: 450 };
    this.pending = [];
  }

  log(kind, data = {}) {
    this.events.push({ t: now(), kind, ...data });
  }

  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', (f) => {
      const i = this.frames.length;
      const file = `frames/${String(i).padStart(6, '0')}.jpg`;
      this.frames.push({ t: f.metadata.timestamp, file });
      this.pending.push(fs.promises.writeFile(path.join(this.dir, file), Buffer.from(f.data, 'base64')));
      this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 3840, maxHeight: 2160, everyNthFrame: 1 });
    this.log('cursor', { x: this.cursor.x, y: this.cursor.y });
    // Force a first frame even on a static page.
    await this.page.evaluate(() => { document.body.style.outline = '0px solid transparent'; });
    await sleep(300);
  }

  async stop() {
    await sleep(200);
    await this.cdp.send('Page.stopScreencast');
    await Promise.all(this.pending);
    fs.writeFileSync(path.join(this.dir, 'timeline.json'), JSON.stringify({
      name: this.name,
      viewport: this.page.viewportSize(),
      frames: this.frames,
      events: this.events,
    }, null, 1));
  }

  mark(label) { this.log('mark', { label }); }
  caption(eyebrow, text) { this.log('caption', { eyebrow, text }); }
  captionOff() { this.log('caption', { off: true }); }
  speed(v) { this.log('speed', { v }); }

  /** Frame the camera on a CSS-pixel rect, a locator (plus padding) or the full viewport. */
  async camera(target, { pad = 40, zoom } = {}) {
    if (target === 'full') return this.log('camera', { full: true });
    let r = target;
    if (target && typeof target.boundingBox === 'function') r = await target.boundingBox();
    const rect = { x: r.x - pad, y: r.y - pad, w: r.width + 2 * pad, h: r.height + 2 * pad };
    this.log('camera', { rect, zoom });
  }

  async hold(ms) { await sleep(ms); }

  async moveTo(target, { duration, offset = { x: 0.5, y: 0.5 } } = {}) {
    let x, y;
    if (typeof target.boundingBox === 'function') {
      await target.scrollIntoViewIfNeeded().catch(() => {});
      const b = await target.boundingBox();
      x = b.x + b.width * offset.x;
      y = b.y + b.height * offset.y;
    } else ({ x, y } = target);
    const from = { ...this.cursor };
    const dist = Math.hypot(x - from.x, y - from.y);
    const dur = duration ?? Math.min(1100, 380 + dist * 0.45);
    // Slight arc, like a hand moving a mouse.
    const nx = -(y - from.y) / (dist || 1), ny = (x - from.x) / (dist || 1);
    const bow = Math.min(60, dist * 0.08);
    const t0 = now();
    for (;;) {
      const k = Math.min(1, (now() - t0) * 1000 / dur);
      const e = easeInOutCubic(k);
      const arc = Math.sin(Math.PI * e) * bow;
      const px = from.x + (x - from.x) * e + nx * arc;
      const py = from.y + (y - from.y) * e + ny * arc;
      await this.page.mouse.move(px, py);
      this.log('cursor', { x: px, y: py });
      if (k >= 1) break;
      await sleep(12);
    }
    this.cursor = { x, y };
  }

  async click(target, opts = {}) {
    await this.moveTo(target, opts);
    await sleep(140);
    this.log('click', { x: this.cursor.x, y: this.cursor.y });
    await this.page.mouse.down();
    await sleep(70);
    await this.page.mouse.up();
    await sleep(opts.after ?? 350);
  }

  async type(text, { delay = 42 } = {}) {
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await sleep(delay + Math.random() * 38);
    }
  }
}

/** Bounding box (CSS px) around every node on the React Flow canvas. */
export async function nodesBox(page) {
  return page.evaluate(() => {
    const r = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
    const x = Math.min(...r.map((b) => b.left)), y = Math.min(...r.map((b) => b.top));
    return { x, y, width: Math.max(...r.map((b) => b.right)) - x, height: Math.max(...r.map((b) => b.bottom)) - y };
  });
}

export async function signIn(browser, user, { viewport = { width: 1600, height: 900 }, scale = 2 } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto('http://studio.localhost');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.fill('#username', user);
  await page.fill('#password', user);
  await page.click('#kc-login');
  await page.waitForURL(/studio\.localhost\/?(#.*)?$/);
  await page.getByRole('button', { name: 'Task Inbox' }).waitFor();
  await sleep(2500);
  return page;
}
