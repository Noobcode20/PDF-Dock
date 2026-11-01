import assert from 'node:assert/strict';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { removeSimpleTextRun } from '../src/editor/simpleText.js';
import { displayFrame } from '../src/editor/coordinates.js';

async function scaffold(rawOrFactory, prepare) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 400]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText('.', { x: 1, y: 1, size: 12, font });
  const fonts = page.node.Resources().lookup(PDFName.of('Font'), PDFDict);
  const fontKey = [...fonts.keys()][0].toString();
  prepare?.(pdf, page, fonts, fontKey);
  const built = typeof rawOrFactory === 'function' ? rawOrFactory(fontKey) : rawOrFactory;
  const values = (Array.isArray(built) ? built : [built]).map((raw) => raw.replaceAll('{{FONT}}', fontKey));
  const refs = values.map((source) => pdf.context.register(pdf.context.flateStream(source)));
  if (refs.length === 1) page.node.set(PDFName.of('Contents'), refs[0]);
  else {
    const array = PDFArray.withContext(pdf.context);
    for (const ref of refs) array.push(ref);
    page.node.set(PDFName.of('Contents'), array);
  }
  const loaded = await PDFDocument.load(await pdf.save());
  const loadedPage = loaded.getPage(0);
  return { pdf: loaded, page: loadedPage, frame: displayFrame(loadedPage, 0) };
}

function streamBytes(pdf, page) {
  const contents = page.node.Contents();
  const refs = contents?.asArray ? contents.asArray() : [contents];
  return refs.map((ref) => {
    const stream = pdf.context.lookup(ref);
    assert.ok(stream instanceof PDFRawStream, 'content stream must stay readable');
    return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  }).join('\n');
}

const cover = { x: 0.08, y: 0.22, width: 0.5, height: 0.07 };
const operation = (oldText, sourceCoverRects = [cover]) => ({ oldText, sourceCoverRects });

{
  const { pdf, page, frame } = await scaffold('BT {{FONT}} 12 Tf 50 300 Td (Safe source) Tj ET BT /Missing 12 Tf (Unsafe) Tj ET');
  assert.equal(removeSimpleTextRun(pdf, page, operation('Safe source'), frame), false, 'an unsupported font anywhere on the page must block source removal');
  assert.ok(streamBytes(pdf, page).includes('Safe source'), 'the safe run must remain when the page is unsafe');
}

{
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    '1 beginbfchar <0001> <0041> endbfchar',
    'endcmap end end',
  ].join('\n');
  const { pdf, page, frame } = await scaffold((fontKey) => [
    `BT ${fontKey} 12 Tf 50 300 Td (Hello ) Tj [(Wor) 0 (ld)] TJ ET`,
    'BT /BadEncoding 12 Tf <0002> Tj ET',
  ], (doc, target, fonts) => {
    const descendant = doc.context.register(doc.context.obj({
      Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'TestFont', DW: 1000, W: [1, [500]],
    }));
    const toUnicode = doc.context.register(doc.context.flateStream(cmap));
    fonts.set(PDFName.of('BadEncoding'), doc.context.register(doc.context.obj({
      Type: 'Font', Subtype: 'Type0', BaseFont: 'TestFont', Encoding: 'Identity-H',
      DescendantFonts: [descendant], ToUnicode: toUnicode,
    })));
  });
  assert.equal(removeSimpleTextRun(pdf, page, operation('Hello World'), frame), false, 'a string code missing from ToUnicode must block source removal');
  assert.ok(streamBytes(pdf, page).includes('Hello'), 'the selected run must remain when its page has an undecodable code');
}

{
  const { pdf, page, frame } = await scaffold('BT {{FONT}} 12 Tf 50 300 Td (Hello ) Tj [(Wor) 0 (ld)] TJ ET');
  assert.equal(removeSimpleTextRun(pdf, page, operation('Hello World'), frame), true, 'mixed Tj/TJ runs must be removed as one exact run');
  const source = streamBytes(pdf, page);
  for (const fragment of ['Hello', 'Wor', '(ld)']) assert.ok(!source.includes(fragment), `${fragment} must be removed`);
}

{
  const { pdf, page, frame } = await scaffold('BT {{FONT}} 12 Tf 50 300 Td [(Keep) -2000 (Neighbor)] TJ ET');
  assert.equal(removeSimpleTextRun(pdf, page, operation('Keep', [{ x: 0.08, y: 0.22, width: 0.15, height: 0.07 }]), frame), true, 'one selected TJ chunk must be removable');
  const source = streamBytes(pdf, page);
  assert.ok(!source.includes('(Keep)'), 'the selected TJ chunk must be removed');
  assert.ok(source.includes('(Neighbor)'), 'unselected TJ neighbours must stay in the array');
  assert.ok(source.includes('-2000'), 'unselected TJ spacing must be preserved');
}

{
  const { pdf, page, frame } = await scaffold(['q BT {{FONT}} 12 Tf 50 300 Td', '(Split text) Tj ET Q']);
  assert.equal(removeSimpleTextRun(pdf, page, operation('Split text'), frame), true, 'state must continue across split /Contents streams');
  assert.ok(!streamBytes(pdf, page).includes('Split text'), 'text from the second content stream must be removed');
}

{
  const { pdf, page, frame } = await scaffold('BT {{FONT}} 12 Tf 50 300 Td (Inline safe) Tj ET q BI /W 1 /H 1 /BPC 8 /CS /G ID \u0001\u0002 EI Q');
  assert.equal(removeSimpleTextRun(pdf, page, operation('Inline safe'), frame), false, 'inline image binary data must block removal');
  assert.ok(streamBytes(pdf, page).includes('Inline safe'), 'the run must remain when the stream contains an inline image');
}

console.log('PASS simple text safety: unsafe guard propagates, unsupported fonts and ToUnicode codes stay, mixed Tj/TJ runs remove exactly, TJ neighbours and spacing survive, split /Contents state is shared, inline images fall back.');
