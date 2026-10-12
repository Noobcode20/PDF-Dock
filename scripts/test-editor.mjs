import { abortable } from "../src/editor/cancellation.js";
import { createCanvas } from "@napi-rs/canvas";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, StandardFonts, degrees, PDFName } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyOperations } from "../src/editor/operations.js";
import {
  displayFrame,
  displayRect,
  transformPoint,
  inversePoint,
} from "../src/editor/coordinates.js";
import { boundHistory, pushHistory } from "../src/editor/history.js";
import {
  createDocumentSession,
  revisedSession,
  isSessionDirty,
  markSessionSaved,
} from "../src/editor/documentSession.js";
import { writeEditorDocument } from "../src/editor/save.js";
import { addOcrWords } from "../src/editor/ocrTextLayer.js";
import { normalizeFont, systemFontKey } from "../src/editor/fonts.js";
const standardFontDataUrl =
  path.resolve("node_modules/pdfjs-dist/standard_fonts") + path.sep;
const require = createRequire(import.meta.url),
  { atomicWrite } = require("../electron/atomicWrite.cjs");
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 4; i++) {
  const page = pdf.addPage([600 + i * 10, 800]);
  page.drawText(`Original page ${i + 1}`, { x: 40, y: 720, font, size: 14 });
}
pdf.setTitle("Preserved title");
const form = pdf.getForm();
form
  .createTextField("Name")
  .addToPage(pdf.getPage(0), { x: 40, y: 600, width: 200, height: 24 });
const original = await pdf.save(),
  assets = {
    unicode: new Uint8Array(
      await fs.readFile("public/fonts/NotoSans-Regular.ttf"),
    ),
    devanagari: new Uint8Array(
      await fs.readFile("public/fonts/NotoSansDevanagari-Regular.ttf"),
    ),
  };
const load = (bytes) => PDFDocument.load(bytes);
const apply = (bytes, ops) => applyOperations(bytes, ops, { fonts: assets });
let bytes = await apply(original, [
  {
    type: "text",
    page: 1,
    x: 0.1,
    y: 0.2,
    width: 0.6,
    height: 0.1,
    text: "Composed café Ω Привет",
    fontSize: 16,
    isNew: true,
  },
  { type: "forms", page: 1, values: { Name: "Alice" } },
]);
bytes = await apply(bytes, [
  {
    type: "annotation",
    page: 1,
    kind: "highlight",
    x: 0.1,
    y: 0.2,
    width: 0.4,
    height: 0.03,
    color: "#ffcc00",
  },
  { type: "pages", action: "rotate", index: 1, angle: 90 },
  { type: "pages", action: "reorder", order: [1, 0, 3, 2] },
]);
let result = await load(bytes);
assert.equal(result.getTitle(), "Preserved title");
assert.equal(result.getPage(0).getRotation().angle, 90);
assert.equal(result.getPage(2).getWidth(), 630);
assert.equal(result.getForm().getTextField("Name").getText(), "Alice");
const composedTask = pdfjs.getDocument({
    standardFontDataUrl,
    data: bytes.slice(),
  }),
  composedDoc = await composedTask.promise;
const composedText = (
  await (await composedDoc.getPage(2)).getTextContent()
).items
  .map((i) => i.str || "")
  .join(" ");
assert.ok(composedText.includes("Composed café Ω Привет"));
assert.ok(composedText.includes("Original page 1"));
await composedTask.destroy();
bytes = await apply(bytes, [
  { type: "pages", action: "duplicate", index: 0 },
  { type: "pages", action: "delete", index: 2 },
  { type: "pages", action: "blank", index: 1 },
]);
result = await load(bytes);
assert.equal(result.getPageCount(), 5);
bytes = await apply(bytes, [
  {
    type: "pages",
    action: "crop",
    index: 1,
    rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
  },
]);
result = await load(bytes);
assert.equal(result.getPage(1).getCropBox().width, 306);
for (const angle of [0, 90, 180, 270]) {
  const page = pdf.getPage(0);
  page.setCropBox(30, 40, 500, 700);
  page.setRotation(degrees(angle));
  const frame = displayFrame(page);
  const b = displayRect(frame, { x: 0.2, y: 0.3, width: 0.4, height: 0.1 });
  const p = transformPoint(frame.matrix, b.x, b.y),
    q = inversePoint(frame.matrix, ...p);
  assert.ok(Math.abs(q[0] - b.x) < 1e-8 && Math.abs(q[1] - b.y) < 1e-8);
  const rotatedTask = pdfjs.getDocument({
      standardFontDataUrl,
      data: await pdf.save(),
    }),
    rotatedDoc = await rotatedTask.promise;
  const viewport = (await rotatedDoc.getPage(1)).getViewport({ scale: 1 });
  const expected = viewport.convertToPdfPoint(
    0.2 * viewport.width,
    0.4 * viewport.height,
  );
  assert.ok(
    Math.abs(expected[0] - p[0]) < 1e-8 && Math.abs(expected[1] - p[1]) < 1e-8,
  );
  await rotatedTask.destroy();
}
const hindi = await apply(original, [
  {
    type: "text",
    page: 1,
    isNew: true,
    x: 0.1,
    y: 0.4,
    width: 0.6,
    height: 0.1,
    text: "Hello Ω Привет हिंदी नमस्ते",
    fontSize: 16,
  },
]);
const hindiTask = pdfjs.getDocument({
    standardFontDataUrl,
    data: hindi.slice(),
  }),
  hindiPdf = await hindiTask.promise;
const hindiText = (await (await hindiPdf.getPage(1)).getTextContent()).items
  .map((i) => i.str || "")
  .join(" ");
assert.ok(hindiText.includes("ह") && hindiText.includes("दी"));
await hindiTask.destroy();
const deletion = await apply(original, [
  {
    type: "text",
    page: 1,
    isNew: false,
    x: 0.05,
    y: 0.07,
    width: 0.4,
    height: 0.05,
    text: "",
    backgroundColor: "#FFFFFF",
  },
]);
assert.equal((await load(deletion)).getPageCount(), 4);
async function regionInk(pdfBytes) {
  const task = pdfjs.getDocument({
    standardFontDataUrl,
    data: pdfBytes.slice(),
  });
  const doc = await task.promise;
  const page = await doc.getPage(1),
    viewport = page.getViewport({ scale: 1 }),
    canvas = createCanvas(viewport.width, viewport.height),
    ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  const pixels = ctx.getImageData(30, 56, 240, 40).data;
  let ink = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] < 180 || pixels[i + 1] < 180 || pixels[i + 2] < 180) ink++;
  await task.destroy();
  return ink;
}
assert.ok((await regionInk(original)) > 50);
assert.equal(await regionInk(deletion), 0);

const ocr = await PDFDocument.create(),
  ocrPage = ocr.addPage([600, 800]),
  ocrFont = await ocr.embedFont(StandardFonts.Helvetica);
assert.equal(
  addOcrWords(
    ocrPage,
    [{ text: "SEARCHABLE", bbox: { x0: 50, y0: 50, x1: 240, y1: 80 } }],
    ocrFont,
    600,
    800,
  ),
  1,
);
const task = pdfjs.getDocument({ standardFontDataUrl, data: await ocr.save() }),
  doc = await task.promise;
assert.equal(
  (await (await doc.getPage(1)).getTextContent()).items[0].str,
  "SEARCHABLE",
);
await task.destroy();
const compositionTask = pdfjs.getDocument({
    standardFontDataUrl,
    data: bytes.slice(),
  }),
  composition = await compositionTask.promise;
const text = (await (await composition.getPage(3)).getTextContent()).items
  .map((i) => i.str || "")
  .join(" ");
await compositionTask.destroy();
assert.ok(text.includes("Original page 2"));
const files = [new File([original], "source.pdf")];
let session = createDocumentSession(files);
assert.equal(isSessionDirty(session), false);
session = revisedSession(session, "text");
assert.equal(isSessionDirty(session), true);
assert.equal(
  isSessionDirty(markSessionSaved(session, "/tmp/source.pdf")),
  false,
);
assert.equal(
  boundHistory([{ files: [{ size: 80 }] }, { files: [{ size: 80 }] }], 100)
    .length,
  1,
);
assert.equal(
  pushHistory({ past: [], future: [{}] }, { files }).future.length,
  0,
);
assert.equal(systemFontKey("ArialMT-9742", 400, "italic"), "Arial-Italic");
assert.equal(normalizeFont("Times", true, true), "Times-BoldItalic");
const calls = [],
  bridge = {
    saveFile: async (payload) => {
      calls.push(payload);
      return { filePath: payload.filePath || "/tmp/chosen.pdf" };
    },
  };
const file = new File([bytes], "current.pdf");
session = { ...session, sourcePath: "/tmp/source.pdf" };
for (const mode of ["save", "save-as", "export"]) {
  const r = await writeEditorDocument({
    file,
    session,
    mode,
    bridge,
    recordRecent: () => {
      throw new Error("Simulated history failure");
    },
  });
  assert.equal(r.saved, mode !== "export");
}
assert.equal(calls[0].filePath, "/tmp/source.pdf");
assert.equal(calls[1].filePath, null);
assert.equal(calls[2].filePath, null);
assert.equal(
  await writeEditorDocument({
    file,
    session,
    bridge: { saveFile: async () => ({ canceled: true }) },
  }),
  null,
);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdfking-test-")),
  destination = path.join(dir, "document.pdf");
await atomicWrite(destination, original);
await atomicWrite(destination, bytes);
assert.deepEqual(new Uint8Array(await fs.readFile(destination)), bytes);
await assert.rejects(
  atomicWrite(path.join(dir, "missing", "document.pdf"), bytes),
);
assert.deepEqual(new Uint8Array(await fs.readFile(destination)), bytes);
await fs.rm(dir, { recursive: true });
await fs.mkdir("tmp/editor-qa", { recursive: true });
await fs.writeFile("tmp/editor-qa/composed.pdf", bytes);
await fs.writeFile("tmp/editor-qa/source.pdf", original);
await fs.writeFile("tmp/editor-qa/searchable.pdf", await ocr.save());
const controller = new AbortController();
let terminated = false;
const stalled = abortable(new Promise(() => {}), controller.signal, () => {
  terminated = true;
});
controller.abort();
await assert.rejects(stalled, { name: "AbortError" });
assert.equal(terminated, true);
console.log(
  "Editor regression checks passed: composition, Unicode, forms, reorder/delete/duplicate/rotate/crop/blank, coordinate matrices, deletion, OCR text extraction, history budget, save modes and atomic replacement.",
);
