// Takes the 1.2 user-guide screenshots on a seeded capture stack (M5 S14). See README.md.
// node capture.mjs <projectId> <stateFile> <outDir> [scene...]
import { chromium } from '../../studio/node_modules/playwright/index.mjs';

const [project, state, out, ...only] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2,
  storageState: state, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(20000);

const shot = async (name, clip) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, ...(clip ? { clip } : {}) });
  console.log('shot', name);
};
const view = async (name) => {
  await page.getByRole('navigation', { name: 'Studio views' }).getByRole('button', { name }).click();
  await page.waitForTimeout(1500);
};
await page.route('http://keycloak.localhost/**', async (route) => {
  const request = route.request();
  const origin = request.headers()['origin'];
  if (!origin || request.resourceType() === 'document') return route.continue();
  const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const response = await route.fetch();
  return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
});

const signIn = async () => {
  const button = page.getByRole('button', { name: 'Sign in to the Studio' });
  const form = page.locator('#kc-form-login');
  const ready = page.getByRole('navigation', { name: 'Studio views' });
  await button.or(form).or(ready).first().waitFor({ timeout: 60000 });
  if (await button.isVisible()) await button.click();
  if (await form.isVisible({ timeout: 8000 }).catch(() => false)) {
    await page.fill('#username', 'alice');
    await page.fill('#password', 'alice');
    await page.click('#kc-login');
  }
  await ready.waitFor({ timeout: 60000 });
};

const open = async () => {
  await page.goto('http://localhost:5605/');
  await signIn();
  await page.evaluate((id) => {
    window.localStorage.setItem('abada.studio.projectId', id);
    window.localStorage.setItem('abada.studio.whatsNewSeen', '1.2');
  }, project);
  await page.reload();
  await signIn();
  await page.waitForTimeout(4000);
};
const canvasNode = (label) => page.locator('.react-flow__node').filter({ hasText: label }).first();

const scenes = {
  async agentFiles() {
    await view('Canvas');
    await page.locator('.react-flow__controls-fitview, button[title="fit view"]').first().click().catch(() => {});
    await canvasNode('Lecture').click();
    await page.waitForTimeout(800);
    const files = page.getByRole('button', { name: /^Files/ }).first();
    if (await files.getAttribute('aria-expanded') === 'false') await files.click();
    await page.getByText('Files the model reads').scrollIntoViewIfNeeded();
    await shot('agent-files-section');
  },
  async decisionTable() {
    await view('Canvas');
    await canvasNode('Controle').click();
    await shot('decision-table-properties');
  },
  async inboxForm() {
    await view('Task Inbox');
    await page.getByText(/Upload the signed declaration|Depot/).first().click();
    await page.waitForTimeout(1500);
    await shot('inbox-sectioned-form');
  },
  async operations() {
    await view('Operations');
    await page.waitForTimeout(2000);
    await shot('operations-overview');
  },
  async instancePath() {
    await view('Operations');
    await page.getByText('f503c426').first().click();
    await page.waitForTimeout(3000);
    await shot('instance-path-audit');
    await canvasNode('Controle').click();
    await page.waitForTimeout(1500);
    await shot('instance-decision-rule');
    await canvasNode('Lecture').click();
    await page.waitForTimeout(1500);
    await page.getByRole('tab', { name: /^Step/ }).click();
    await page.waitForTimeout(1200);
    const step = page.getByRole('button', { name: /^Step \d+\.\d+/ }).first();
    if (await step.isVisible().catch(() => false)) await step.click();
    await page.waitForTimeout(800);
    await shot('agent-step-files');
  },
  async incident() {
    await view('Operations');
    await page.getByText('999ada27').last().click();
    await page.waitForTimeout(3000);
    await shot('incident-retry');
  },
  async pace() {
    await view('Operations');
    await page.getByText('517f2202').first().click();
    await page.waitForTimeout(3000);
    await page.getByRole('radiogroup', { name: 'Playback pace' }).scrollIntoViewIfNeeded();
    await shot('instance-pace');
  },
  async adminAudit() {
    await view('Admin');
    await page.getByRole('button', { name: 'Audit' }).or(page.getByRole('tab', { name: 'Audit' })).first().click();
    await page.waitForTimeout(2000);
    await shot('admin-audit');
    await page.getByRole('table', { name: 'Administration audit events' }).locator('tbody tr').filter({ hasText: /denied/i }).first().click();
    await page.waitForTimeout(800);
    await shot('admin-audit-details');
  },
};

await open();
for (const [name, scene] of Object.entries(scenes)) {
  if (only.length && !only.includes(name)) continue;
  try {
    await scene();
  } catch (error) {
    console.log('FAILED', name, String(error).split('\n')[0]);
    await page.screenshot({ path: `${out}/failed-${name}.png` });
  }
}
await browser.close();
