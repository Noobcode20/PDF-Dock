import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import fs from "node:fs/promises";
await fs.mkdir("tmp/editor-qa", { recursive: true });
const canvas = createCanvas(1200, 800),
  ctx = canvas.getContext("2d");
ctx.fillStyle = "white";
ctx.fillRect(0, 0, 1200, 800);
ctx.fillStyle = "black";
ctx.font = "48px Arial";
ctx.fillText("LOCAL OCR SEARCHABLE SAMPLE", 80, 160);
ctx.font = "34px Arial";
ctx.fillText("Invoice number 12345", 80, 240);
await fs.writeFile("tmp/editor-qa/image.png", canvas.toBuffer("image/png"));
const scanned = await PDFDocument.create(),
  image = await scanned.embedPng(canvas.toBuffer("image/png")),
  page = scanned.addPage([600, 400]);
page.drawImage(image, { x: 0, y: 0, width: 600, height: 400 });
await fs.writeFile("tmp/editor-qa/scanned.pdf", await scanned.save());
const large = await PDFDocument.create(),
  font = await large.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 60; i++) {
  const p = large.addPage(i === 59 ? [2400, 1800] : [600, 800]);
  p.drawText(`Large fixture page ${i + 1}`, { x: 40, y: 700, size: 18, font });
  if (i < 4) p.setRotation(degrees(i * 90));
}
await fs.writeFile("tmp/editor-qa/sixty-pages.pdf", await large.save());
