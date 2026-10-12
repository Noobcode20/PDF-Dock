const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PDFKING_PLAYWRIGHT || 'playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP(process.env.PDFKING_CDP || 'http://127.0.0.1:9224');
  try {
    const destination='tmp/sol-qa/password-edited-saved.pdf';
    await fs.rm(destination,{force:true});
    const p = browser.contexts()[0].pages().find(p => p.url().includes(':5174'));
    const button = name => p.getByRole('button', { name, exact: true });
    const open = async () => {
      await p.reload();
      await button('New document').first().click();
      await p.locator('input[type=file]').first().setInputFiles(path.resolve('tmp/sol-qa/catalog-protected.pdf'));
      await p.getByRole('dialog').waitFor();
    };
    await open();
    await p.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await p.getByRole('dialog').waitFor({ state: 'detached' });
    await open();
    await p.getByRole('dialog').getByLabel('Password', { exact: true }).fill('incorrect-test-password');
    await button('Open PDF').click();
    await p.getByRole('heading', { name: 'Incorrect password. Try again.', exact: true }).waitFor();
    await p.getByRole('dialog').getByLabel('Password', { exact: true }).fill('sol-test-only-927');
    await button('Open PDF').click();
    await p.waitForSelector('.pdf-editor-workspace canvas.is-rendered');
    await p.getByRole('searchbox', { name: 'Search PDF', exact: true }).fill('original short text');
    await p.waitForSelector('.pdf-search-highlight-layer span');
    await button('Fill forms').click();
    await p.locator('.pdf-form-layer input[aria-label=Name]').fill('Encrypted edited value');
    await button('Apply tool').click();
    await p.waitForFunction(() => document.querySelector('.pdf-editor-status')?.textContent === 'Changes applied to the current document.');
    const bytes = await require('./electron-qa.cjs').captureUiBytes(p);
    await fs.writeFile('tmp/sol-qa/password-edit-current.pdf', Buffer.from(bytes));
    const pdf = await require('pdf-lib').PDFDocument.load(Uint8Array.from(bytes));
    assert.equal(pdf.getForm().getTextField('Name').getText(), 'Encrypted edited value');
    await button('Save As').click();
    console.log('NATIVE STAGE: Save encrypted edits as tmp/sol-qa/password-edited-saved.pdf.');
    await p.waitForFunction(()=>document.querySelector('.pdf-editor-status')?.textContent==='Saved password-edited-saved.pdf',undefined,{timeout:600000});
    await assert.rejects(require('pdf-lib').PDFDocument.load(await fs.readFile(destination)),/encrypted/i);
    await p.reload();await button('New document').first().click();
    await p.locator('input[type=file]').first().setInputFiles(path.resolve(destination));
    await p.getByRole('dialog').getByLabel('Password',{exact:true}).fill('sol-test-only-927');
    await button('Open PDF').click();await p.waitForSelector('.pdf-form-layer input[aria-label=Name]');
    assert.equal(await p.locator('.pdf-form-layer input[aria-label=Name]').inputValue(),'Encrypted edited value');
    console.log('PASS native password opening: cancel, wrong-password retry, correct-password rendering/search, current-document form edit, encrypted native Save As and password-protected reopen with value retained.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
