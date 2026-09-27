// Plays the Studio showcase storyboard and records it.
// Usage: node record.mjs <outDir>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { Recorder, signIn, nodesBox } from './recorder.mjs';

const out = process.argv[2] || 'take';
fs.rmSync(out, { recursive: true, force: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-device-scale-factor=2'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Prep: Bob's inbox must be empty so the recorded task is the only one.
{
  const bob = await signIn(browser, 'bob', { scale: 1 });
  await bob.getByRole('button', { name: 'Task Inbox' }).click();
  await sleep(1500);
  for (let i = 0; i < 10; i++) {
    const task = bob.getByRole('button', { name: /Senior sales review/ }).first();
    if (!(await task.count())) break;
    await task.click(); await sleep(800);
    const claim = bob.getByRole('button', { name: 'Claim', exact: true });
    if (await claim.count()) { await claim.click(); await sleep(1200); await task.click(); await sleep(800); }
    await bob.locator('select').last().selectOption('approve');
    await bob.getByRole('button', { name: 'Submit' }).click();
    await sleep(1500);
  }
  await bob.context().close();
}

const alicePage = await signIn(browser, 'alice');
const bobPage = await signIn(browser, 'bob');
const A = new Recorder(alicePage, 'alice', out);
const B = new Recorder(bobPage, 'bob', out);
const a = alicePage, b = bobPage;

// ---- Scene 1-3: design, APL, deploy (alice)
await a.getByRole('button', { name: 'Fit View' }).click();
await sleep(800);
await A.start();
A.mark('s1');
await A.hold(900);
A.caption('01 · Design', 'Agents advise. The engine enforces the contract.');
const agentNode = a.locator('.react-flow__node').filter({ hasText: 'Analyze-Lead' });
await A.camera(await nodesBox(a), { pad: 30 });
await A.hold(700);
await A.click(agentNode, { after: 900 });
await A.camera(a.getByText('Confidence Threshold').locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), { pad: 150 });
await A.moveTo(a.getByText('Confidence Threshold'), { offset: { x: 0.3, y: 0.5 } });
await A.hold(2600);
await A.camera('full');
A.captionOff();
await A.hold(400);

A.caption('02 · APL', 'Every process is plain YAML you can review and diff.');
await A.click(a.getByRole('button', { name: 'APL YAML' }), { after: 600 });
await A.camera({ x: 256, y: 60, width: 1024, height: 576 }, { pad: 0 });
await A.moveTo({ x: 700, y: 420 });
await a.mouse.wheel(0, 900); // scroll to the agent contract
for (let i = 0; i < 20; i++) { await a.mouse.wheel(0, 60); await sleep(30); }
await A.hold(2200);
await A.camera('full');
await A.click(a.getByRole('button', { name: 'Diagram', exact: true }), { after: 500 });
A.captionOff();

A.caption('03 · Run', 'The model runs outside the transaction.');
await A.click(a.getByRole('button', { name: 'Deploy & Start' }), { after: 900 });
await A.camera(a.getByRole('dialog').or(a.locator('text=Live input payload').locator('xpath=ancestor::div[contains(@class,"rounded")][2]')).first(), { pad: 60 }).catch(() => {});
await A.hold(1500);
await A.camera('full');
await A.click(a.getByRole('button', { name: 'Deploy anyway' }), { after: 400 });
A.mark('deployed');
await sleep(1200);
// The audit stream panel overlaps the inspector; dismiss it.
await a.getByText('Real-Time Audit Stream').locator('xpath=ancestor::div[.//button][1]').getByRole('button').last().click().catch(() => {});
await A.camera(await nodesBox(a), { pad: 30 });
A.speed(2.5);
// Wait for the agent to finish and the human task to open.
await a.getByText('Senior Sales Review', { exact: true }).first().waitFor({ timeout: 120000 });
A.speed(1);
await A.hold(500);
await A.camera('full');
await A.click(a.getByRole('button', { name: 'Audit Trail' }), { after: 700 });
await A.camera({ x: 1160, y: 100, width: 440, height: 560 }, { pad: 10 });
await A.moveTo({ x: 1380, y: 420 });
await A.hold(2600);
await A.camera('full');
A.captionOff();
await A.hold(300);
A.mark('e1');
await A.stop();

// ---- Scene 4: a different person approves (bob)
await b.reload();
await b.getByRole('button', { name: 'Task Inbox' }).waitFor();
await sleep(2000);
await b.getByRole('button', { name: 'Task Inbox' }).click();
await b.getByRole('button', { name: /Senior sales review/ }).first().waitFor({ timeout: 20000 });
await sleep(800);
await B.start();
B.mark('s2');
B.caption('04 · Approve', 'A human signs off. Not the model, not the author.');
const task = b.getByRole('button', { name: /Senior sales review/ }).first();
const claim = b.getByRole('button', { name: 'Claim', exact: true });
await B.click(task, { after: 200 });
await claim.waitFor();
await B.hold(500);
await B.camera({ x: 600, y: 80, width: 720, height: 405 }, { pad: 0 });
await B.hold(700);
await B.click(claim, { after: 100 });
await B.camera('full');
B.speed(1.8);
await b.getByText('Task claimed').first().waitFor().catch(() => {});
await B.hold(300);
await B.click(task, { after: 200 });
const decision = b.locator('select').last();
await decision.waitFor();
await b.waitForFunction(() => { const s = [...document.querySelectorAll('select')].pop(); return s && !s.disabled; });
B.speed(1);
B.speed(1);
await B.hold(300);
await B.camera({ x: 600, y: 260, width: 720, height: 405 }, { pad: 0 });
await B.hold(500);
await B.click(decision, { after: 200 });
await decision.selectOption('approve');
await B.hold(500);
await B.click(b.locator('textarea').last(), { after: 200 });
await B.type('Strong fit. Fast-track to an account executive.');
await B.hold(600);
await B.click(b.getByRole('button', { name: 'Submit' }), { after: 0 });
await B.camera('full');
await B.hold(1800);
B.captionOff();
B.mark('e2');
await B.stop();

// ---- Scene 5: the record (alice)
await sleep(4000); // let the worker acknowledge the CRM sync and finish the instance
await a.getByRole('button', { name: 'Operations' }).click();
await sleep(2500);
await A.start();
A.mark('s3');
A.caption('05 · Audit', 'PostgreSQL remembers every decision.');
await A.hold(1000);
const row = a.locator('tr').filter({ hasText: 'Completed' }).first();
await A.camera({ x: 0, y: 60, width: 1000, height: 560 }, { pad: 0 });
await A.moveTo(row, { offset: { x: 0.2, y: 0.5 } });
await A.hold(1400);
await A.camera('full');
await A.click(row.locator('button[title="View Canvas"]'), { after: 1500 });
await A.click(a.getByRole('button', { name: 'Audit Trail' }), { after: 800 });
await A.camera({ x: 1170, y: 95, width: 430, height: 420 }, { pad: 10 });
await A.moveTo({ x: 1380, y: 520 });
for (let i = 0; i < 24; i++) { await a.mouse.wheel(0, 40); await sleep(40); }
await A.hold(2000);
await A.camera('full');
await A.hold(1500);
A.captionOff();
await A.hold(500);
A.mark('e3');
await A.stop();

await browser.close();
console.log('recorded to', out);
