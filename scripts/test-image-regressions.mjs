/**
 * Focused regression tests for two image editor defects.
 *
 * 1. The viewer rotation is a view setting. It must never be baked into the
 *    saved image placement: the same page area has to produce the same saved
 *    PDF, and the artwork has to keep the orientation the user gave it.
 *    (src/editor/operations.js, the image branch of applyOperations.)
 *
 * 2. A double click on a placed image opens the image inspector. It must not
 *    move, duplicate or transform the image, and it must not read the artwork
 *    again when the image already carries its source.
 *    (src/editor/imageInteraction.js, used by the image object in the viewer.)
 *
 * The checks render the saved PDF with pdf.js and read the painted pixels, so
 * a drift between the model and the writer is caught here.
 *
 * Run from the repository root:  node scripts/test-image-regressions.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyOperations } from "../src/editor/operations.js";
import { reframeRegion } from "../src/editor/coordinates.js";
import { imageDoubleClickPlan } from "../src/editor/imageInteraction.js";

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;
const standardFontDataUrl =
  path.resolve("node_modules/pdfjs-dist/standard_fonts") + path.sep;

const failures = [];
let checkCount = 0;

async function check(name, fn) {
  checkCount += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL ${name}`);
    const text = String(error && error.message ? error.message : error);
    console.log(
      text
        .split("\n")
        .map((line) => `       ${line}`)
        .join("\n"),
    );
  }
}

/** A picture with four markers, one per edge, so a turn of the artwork shows. */
function buildSourcePng() {
  const size = 200;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const band = Math.round(size * 0.2);
  ctx.fillStyle = "#FF0000";
  ctx.fillRect(0, 0, size, band);
  ctx.fillStyle = "#0000FF";
  ctx.fillRect(0, size - band, size, band);
  ctx.fillStyle = "#00FF00";
  ctx.fillRect(0, band, band, size - band * 2);
  ctx.fillStyle = "#FFFF00";
  ctx.fillRect(size - band, band, band, size - band * 2);
  return canvas.toBuffer("image/png");
}

/** A solid magenta picture, used as the artwork of the page that is edited. */
function buildSolidPng(colour) {
  const canvas = createCanvas(40, 40);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, 40, 40);
  return canvas.toBuffer("image/png");
}

async function buildBasePdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const magenta = await pdf.embedPng(buildSolidPng("#FF00FF"));
  /* The artwork that is replaced: 60..300 from the left, 460..700 from the
   * bottom of the 600x800 page. */
  page.drawImage(magenta, { x: 60, y: 460, width: 240, height: 240 });
  return pdf.save();
}

async function render(bytes, pageNumber = 1) {
  const task = pdfjs.getDocument({ standardFontDataUrl, data: bytes.slice() });
  const doc = await task.promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  await task.destroy();
  return { width: canvas.width, height: canvas.height, data: image.data };
}

const pixelAt = (render, x, y) => {
  const index = (y * render.width + x) * 4;
  return [render.data[index], render.data[index + 1], render.data[index + 2]];
};

const near = (actual, expected, tolerance = 60) =>
  actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

const RED = [255, 0, 0];
const GREEN = [0, 255, 0];
const BLUE = [0, 0, 255];
const YELLOW = [255, 255, 0];
const MAGENTA = [255, 0, 255];
const WHITE = [255, 255, 255];

/** The placement used by the checks: 60..300 from the left, 100..420 from the
 * top of the page. */
const PLACEMENT = { x: 0.1, y: 0.125, width: 0.4, height: 0.4 };
const PLACEMENT_BOX = {
  left: 60,
  right: 300,
  top: 100,
  bottom: 420,
};

/** The same page area, written in the frame of a rotated viewer. */
async function viewRectFor(page, rect, viewerRotation) {
  const framed = reframeRegion(
    page,
    { ...rect, viewerRotation: 0 },
    viewerRotation,
  );
  return {
    x: framed.x,
    y: framed.y,
    width: framed.width,
    height: framed.height,
  };
}

const baseEdit = (extra) => ({
  type: "image",
  page: 1,
  isNew: true,
  rotation: 0,
  skew: 0,
  flipHorizontal: false,
  flipVertical: false,
  aspectLocked: true,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
  sourceWidth: 200,
  sourceHeight: 200,
  ...extra,
});

console.log("image editor regressions");

await check(
  "a viewer rotation of 0 and of 90 save the same image in the same place",
  async () => {
    const base = await buildBasePdf();
    const source = buildSourcePng();
    const pdf = await PDFDocument.load(base);
    const page = pdf.getPage(0);

    const straight = await applyOperations(base, [
      baseEdit({
        ...PLACEMENT,
        replacementData: source,
        replacementType: "image/png",
        viewerRotation: 0,
      }),
    ]);
    const rotated = await applyOperations(base, [
      baseEdit({
        ...(await viewRectFor(page, PLACEMENT, 90)),
        replacementData: source,
        replacementType: "image/png",
        viewerRotation: 90,
      }),
    ]);

    const straightRender = await render(straight);
    const rotatedRender = await render(rotated);
    assert.equal(straightRender.width, PAGE_WIDTH);
    assert.equal(straightRender.height, PAGE_HEIGHT);
    assert.equal(rotatedRender.width, PAGE_WIDTH);
    assert.equal(rotatedRender.height, PAGE_HEIGHT);

    let differing = 0;
    for (let index = 0; index < straightRender.data.length; index += 4) {
      if (
        Math.abs(straightRender.data[index] - rotatedRender.data[index]) > 8 ||
        Math.abs(straightRender.data[index + 1] - rotatedRender.data[index + 1]) > 8 ||
        Math.abs(straightRender.data[index + 2] - rotatedRender.data[index + 2]) > 8
      )
        differing += 1;
    }
    assert.equal(differing, 0, "the viewer rotation changed the saved image");
  },
);

await check(
  "the viewer rotation is not baked into the orientation of the saved image",
  async () => {
    const base = await buildBasePdf();
    const source = buildSourcePng();
    const pdf = await PDFDocument.load(base);
    const page = pdf.getPage(0);
    const rotated = await applyOperations(base, [
      baseEdit({
        ...(await viewRectFor(page, PLACEMENT, 90)),
        replacementData: source,
        replacementType: "image/png",
        viewerRotation: 90,
      }),
    ]);
    const painted = await render(rotated);

    const middle = Math.round((PLACEMENT_BOX.left + PLACEMENT_BOX.right) / 2);
    const middleTop = Math.round((PLACEMENT_BOX.top + PLACEMENT_BOX.bottom) / 2);
    /* The red band is the top edge of the picture, the blue band its bottom. */
    assert.ok(
      near(pixelAt(painted, middle, PLACEMENT_BOX.top + 30), RED),
      "the top of the picture is not at the top of the page",
    );
    assert.ok(
      near(pixelAt(painted, middle, PLACEMENT_BOX.bottom - 30), BLUE),
      "the bottom of the picture is not at the bottom of the page",
    );
    assert.ok(
      near(pixelAt(painted, PLACEMENT_BOX.left + 30, middleTop), GREEN),
      "the left edge of the picture is not at the left of the page",
    );
    assert.ok(
      near(pixelAt(painted, PLACEMENT_BOX.right - 30, middleTop), YELLOW),
      "the right edge of the picture is not at the right of the page",
    );
  },
);

await check(
  "the cover of the replaced artwork stays on the page with a rotated viewer",
  async () => {
    const base = await buildBasePdf();
    const source = buildSourcePng();
    const pdf = await PDFDocument.load(base);
    const page = pdf.getPage(0);
    /* The artwork that is replaced: 60..300 from the left, 100..340 from the
     * top of the page. */
    const original = { x: 0.1, y: 0.125, width: 0.4, height: 0.3 };
    const rotated = await applyOperations(base, [
      baseEdit({
        isNew: false,
        ...(await viewRectFor(page, PLACEMENT, 90)),
        original: await viewRectFor(page, original, 90),
        replacementData: source,
        replacementType: "image/png",
        viewerRotation: 90,
      }),
    ]);
    const painted = await render(rotated);
    /* The magenta artwork of the page is covered, and the new picture is
     * painted in the same place. */
    assert.ok(
      !near(pixelAt(painted, 180, 220), MAGENTA),
      "the replaced artwork is still visible",
    );
    assert.ok(
      near(pixelAt(painted, 180, 220), WHITE),
      "the cover of the replaced artwork is missing",
    );
    assert.ok(
      near(pixelAt(painted, 180, 130), RED),
      "the new picture is not in the requested place",
    );
  },
);

await check("a double click opens the inspector and never transforms the image", () => {
  const plan = imageDoubleClickPlan({ sourceLoaded: true });
  assert.equal(plan.select, true);
  assert.equal(plan.openInspector, true);
  assert.equal(plan.cancelGesture, true);
  assert.equal(plan.clearPreview, true);
});

await check("a double click does not read the artwork that is already loaded", () => {
  assert.equal(
    imageDoubleClickPlan({ sourceLoaded: true }).captureSource,
    false,
  );
  assert.equal(
    imageDoubleClickPlan({ sourceLoaded: false, capturePending: true })
      .captureSource,
    false,
    "a read that is already running must not be started again",
  );
  assert.equal(
    imageDoubleClickPlan({ sourceLoaded: false, capturePending: false })
      .captureSource,
    true,
    "a missing artwork still has to be read",
  );
});

if (failures.length) {
  console.log(`\n${failures.length} of ${checkCount} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${checkCount} checks passed.`);
}
