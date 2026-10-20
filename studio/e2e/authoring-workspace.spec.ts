import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';

/**
 * M5 S12: a prompt, two refinements and Apply, with the deterministic stub model behind the
 * real authoring service. The canvas must end up with exactly the final draft, as one undo step.
 */

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
test.skip(!username || !password, 'Set E2E_USERNAME and E2E_PASSWORD (a dev-realm user, see e2e/README.md).');

const SHOTS = process.env.E2E_SCREENSHOTS;

/**
 * The dev realm accepts http://localhost (no port) as a web origin; the Studio runs on :5605.
 * The browser's calls to Keycloak get the CORS headers Keycloak would send for an allowed origin.
 */
async function allowKeycloakCors(page: Page) {
  await page.route('http://keycloak.localhost/**', async (route) => {
    const request = route.request();
    const origin = request.headers()['origin'];
    if (!origin || request.resourceType() === 'document') return route.continue();
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
}

/**
 * Drafting needs the Owner or Maintainer role in the project (global administration does not
 * count), so each test works in a project of its own, created through the API with the Studio's
 * own bearer token: its creator is its Owner, and its canvas starts empty.
 */
async function openOwnedProject(page: Page) {
  const bearer = new Promise<string>((resolve) => {
    page.on('request', (request) => {
      const header = request.headers()['authorization'];
      if (request.url().includes('/api/') && header) resolve(header);
    });
  });
  await page.reload();
  const authorization = await bearer;
  const slug = `e2e-s12-${Date.now()}`;
  const created = await page.request.post('/api/v1/projects', {
    headers: { authorization, 'content-type': 'application/json' },
    data: { slug, name: `E2E S12 ${slug.slice(-6)}`, description: 'AI draft workspace e2e run' },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = await created.json() as { id: string };
  await page.evaluate((projectId) => window.localStorage.setItem('abada.studio.projectId', projectId), id);
  await page.reload();
}

async function signIn(page: Page) {
  await allowKeycloakCors(page);
  await page.goto('/');
  const signInButton = page.getByRole('button', { name: 'Sign in to the Studio' });
  const loginForm = page.locator('#kc-form-login');
  await expect(signInButton.or(loginForm).or(page.locator('#workflow-prompt'))).toBeVisible({ timeout: 60_000 });
  if (await signInButton.isVisible()) await signInButton.click();
  if (await loginForm.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await page.fill('#username', username!);
    await page.fill('#password', password!);
    await page.click('#kc-login');
  }
  await expect(page.locator('#workflow-prompt').or(page.getByRole('button', { name: /^Draft with AI \(/ }).last()))
    .toBeVisible({ timeout: 60_000 });
  await openOwnedProject(page);
}

const workspace = (page: Page) => page.getByRole('dialog', { name: /AI draft/ });
/** The designer canvas (the workspace dialog renders its own diagram, so it is excluded). */
const canvasNodes = (page: Page) => page.locator('.react-flow:not([role="dialog"] .react-flow) .react-flow__node');

async function waitForTurns(page: Page, done: number) {
  await expect(workspace(page).locator('[data-testid="authoring-turn"][data-status="done"]')).toHaveCount(done, { timeout: 60_000 });
  await expect(workspace(page).locator('[data-testid="authoring-turn"][data-status="pending"]')).toHaveCount(0);
}

async function refine(page: Page, text: string) {
  await workspace(page).getByLabel('Refine the draft').fill(text);
  await workspace(page).getByRole('button', { name: 'Send' }).click();
}

test('prompt → two refinements → apply: the canvas holds the final draft, as one undo step', async ({ page }) => {
  await signIn(page);
  const prompt = page.locator('#workflow-prompt');
  await expect(prompt).toBeVisible({ timeout: 60_000 });
  // Start from an empty process so the draft fills it (the bar refines a process that has steps).
  await expect(canvasNodes(page)).toHaveCount(0);

  await prompt.fill('Invoice approval: finance reviews each invoice, then it is paid or rejected');
  await page.getByRole('button', { name: 'Draft', exact: true }).click();

  await expect(workspace(page)).toBeVisible();
  await waitForTurns(page, 1);
  const draftNodes = workspace(page).locator('.react-flow__node');
  await expect(draftNodes).toHaveCount(4);

  await refine(page, 'Above 10,000 EUR a finance manager must also approve');
  await waitForTurns(page, 2);
  await expect(draftNodes).toHaveCount(6);
  await expect(workspace(page).getByText('Added a condition on the amount')).toBeVisible();

  await refine(page, 'Tell the supplier when an invoice is rejected');
  await waitForTurns(page, 3);
  await expect(draftNodes).toHaveCount(7);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s12-workspace-diagram.png` });

  await workspace(page).getByRole('tab', { name: 'Diff vs current' }).click();
  await expect(workspace(page).getByTestId('diff-summary')).toContainText('7 added');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s12-workspace-diff.png` });

  await workspace(page).getByRole('tab', { name: 'YAML' }).click();
  const finalYaml = await workspace(page).getByLabel('APL source').textContent();
  const finalDraft = parse(finalYaml ?? '') as { flow: { nodes: Array<{ id: string }> } };
  const finalIds = finalDraft.flow.nodes.map((node) => node.id).sort();
  expect(finalIds).toEqual(['amount_check', 'manager', 'notify_supplier', 'paid', 'received', 'rejected', 'review']);

  await workspace(page).getByRole('button', { name: 'Apply to Studio' }).click();
  await expect(workspace(page)).toBeHidden();

  // The canvas shows exactly the final draft.
  await expect(canvasNodes(page)).toHaveCount(finalIds.length);
  const canvasIds = (await canvasNodes(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-id')))).sort();
  expect(canvasIds).toEqual(finalIds);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s12-applied.png` });
  // The next prompt refines the process that now has steps.
  await expect(page.getByLabel('What the prompt does')).toHaveValue('refine');

  // One undo restores the process as it was before the draft; redo brings it back.
  await page.locator('.react-flow__pane').first().click({ position: { x: 20, y: 400 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvasNodes(page)).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(canvasNodes(page)).toHaveCount(finalIds.length);
});

test('a failed refinement leaves the draft as it was, and Discard leaves the canvas untouched', async ({ page }) => {
  await signIn(page);
  const prompt = page.locator('#workflow-prompt');
  await expect(prompt).toBeVisible({ timeout: 60_000 });
  const before = await canvasNodes(page).count();
  await prompt.fill('Invoice approval with a finance review');
  await page.getByRole('button', { name: 'Draft', exact: true }).click();
  await waitForTurns(page, 1);

  // The stub answers this one with a patch the engine cannot apply, three times.
  await refine(page, 'Do something the model cannot do');
  await expect(workspace(page).locator('[data-status="failed"]')).toBeVisible({ timeout: 60_000 });
  await expect(workspace(page).locator('[data-status="failed"]')).toContainText('The draft is unchanged');
  await expect(workspace(page).locator('.react-flow__node')).toHaveCount(4);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s12-failed-turn.png` });

  await workspace(page).getByRole('button', { name: 'Discard', exact: true }).click();
  await workspace(page).getByRole('button', { name: 'Discard draft' }).click();
  await expect(workspace(page)).toBeHidden();
  await expect(canvasNodes(page)).toHaveCount(before);
});

test('the bar collapses, stays collapsed after a reload, and Cmd/Ctrl+K opens it', async ({ page }) => {
  await signIn(page);
  await expect(page.locator('#workflow-prompt')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Collapse the bar to a button' }).click();
  await expect(page.locator('#workflow-prompt')).toBeHidden();
  const fab = page.getByRole('button', { name: /^Draft with AI \(/ }).last();
  await expect(fab).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/s12-bar-collapsed.png` });

  await page.reload();
  await expect(fab).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#workflow-prompt')).toBeHidden();

  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('#workflow-prompt')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#workflow-prompt')).toBeHidden();

  // Leave the default for the next run.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('button', { name: 'Pin the bar open' }).click();
  await expect(fab).toBeHidden();
});
