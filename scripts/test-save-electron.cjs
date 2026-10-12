// Native dialog stages are completed with desktop automation. No bridge mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PDFKING_PLAYWRIGHT || 'playwright-core');
const directory = 'tmp/sol-qa';
const destination = `${directory}/save-pipeline-final.pdf`;
const exported = `${directory}/save-export-final.pdf`;
const gate = `${directory}/save-cancelled.flag`;
async function waitUntil(check) {
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error('Native save stage timed out');
}
async function value(file) {
  try { return (await require('pdf-lib').PDFDocument.load(await fs.readFile(file))).getForm().getTextField('Name').getText(); }
  catch { return null; }
}
(async () => {
  for (const file of [destination, exported, gate]) await fs.rm(file, { force: true });
  const original = await fs.readFile(`${directory}/master-saved.pdf`);
  const browser = await chromium.connectOverCDP(process.env.PDFKING_CDP || 'http://127.0.0.1:9224');
  try {
    const p = browser.contexts()[0].pages().find(p => p.url().includes(':5174'));
    const button = name => p.getByRole('button', { name, exact: true });
    await p.reload();
    await button('New document').first().click();
    await p.locator('input[type=file]').first().setInputFiles(path.resolve(`${directory}/master-saved.pdf`));
    await p.waitForSelector('canvas.is-rendered');
    await button('Fill forms').click();
    await p.locator('.pdf-form-layer input[aria-label=Name]').fill('Save lifecycle first');
    await button('Save As').click();
    console.log('NATIVE STAGE: Cancel Save As, then create tmp/sol-qa/save-cancelled.flag.');
    await waitUntil(() => fs.access(gate).then(() => true, () => false));
    assert.deepEqual(await fs.readFile(`${directory}/master-saved.pdf`), original);
    assert.equal(await button('Save •').count(), 1, 'Cancellation leaves current edits unsaved');
    await button('Save As').click();
    console.log('NATIVE STAGE: Save As tmp/sol-qa/save-pipeline-final.pdf.');
    await waitUntil(async () => await value(destination) === 'Save lifecycle first');
    await p.waitForFunction(() => document.querySelector('.pdf-editor-status')?.textContent === 'Saved save-pipeline-final.pdf');
    assert.deepEqual(await fs.readFile(`${directory}/master-saved.pdf`), original);
    await p.waitForSelector('.pdf-form-layer input[aria-label=Name]');
    await p.locator('.pdf-form-layer input[aria-label=Name]').fill('Save lifecycle second');
    await button('Save •').click();
    await waitUntil(async () => await value(destination) === 'Save lifecycle second');
    await button('Undo').click();
    await button('Save •').click();
    await waitUntil(async () => await value(destination) === 'Save lifecycle first');
    await button('Redo').click();
    await button('Save •').click();
    await waitUntil(async () => await value(destination) === 'Save lifecycle second');
    await p.locator('.pdf-form-layer input[aria-label=Name]').fill('Export lifecycle only');
    await button('Export PDF').click();
    console.log('NATIVE STAGE: Export tmp/sol-qa/save-export-final.pdf.');
    await waitUntil(async () => await value(exported) === 'Export lifecycle only');
    await p.waitForFunction(() => document.querySelector('.pdf-editor-status')?.textContent === 'Exported save-export-final.pdf');
    assert.equal(await value(destination), 'Save lifecycle second');
    assert.deepEqual(await fs.readFile(`${directory}/master-saved.pdf`), original);
    assert.equal(await button('Save •').count(), 1, 'Export leaves the current document dirty');
    await p.reload();
    await button('New document').first().click();
    await p.locator('input[type=file]').first().setInputFiles(path.resolve(exported));
    await p.waitForSelector('.pdf-form-layer input[aria-label=Name]');
    assert.equal(await p.locator('.pdf-form-layer input[aria-label=Name]').inputValue(), 'Export lifecycle only');
    console.log('PASS native Save As cancel/source preservation, Save As path, repeated Save, Save after undo/redo, separate Export and reopened form value.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
