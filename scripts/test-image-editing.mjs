/**
 * Image editing pipeline test.
 *
 * One placement matrix (src/editor/imageModel.js) drives the preview and the
 * PDF writer (src/editor/operations.js). These checks render the saved PDF
 * with pdf.js and compare the painted pixels against the model, so a drift
 * between the two, a wrong placement or a wrong transform is caught here.
 *
 * The source unit square may be oriented either way (the picture order or the
 * PDF order), so the checks are written against what the reader sees on the
 * page: the picture must land in the requested rect, upright, with the
 * requested crop, rotation, flip and skew.
 *
 * Run from the repository root:  node scripts/test-image-editing.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas, ImageData } from "@napi-rs/canvas";
import { PDFDocument, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyOperations } from "../src/editor/operations.js";
import {
  applyMatrix,
  cropWindow,
  imageCorners,
  imagePlacement,
  imagePlacementMatrix,
  invertMatrix,
  duplicateImage,
} from "../src/editor/imageModel.js";
import { captureImagePlacement } from "../src/editor/imageCapture.js";
import { displayFrame, transformPoint } from "../src/editor/coordinates.js";

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;
const SOURCE_SIZE = 400;
const standardFontDataUrl =
  path.resolve("node_modules/pdfjs-dist/standard_fonts") + path.sep;

/* The test image: four solid quadrants, red top-left, green top-right,
 * blue bottom-left, yellow bottom-right. */
const PALETTE = {
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  magenta: [255, 0, 255],
  white: [255, 255, 255],
};
/* Sum of the channel differences that still counts as "this colour". */
const CLEAR_DISTANCE = 150;
/* Pixels closer to white than this count as background. */
const WHITE_DISTANCE = 90;

/* The original artwork of the base PDF: a 240x240 image placed at
 * x 60..300, y 100..340 from the top of the 600x800 page. */
const ORIGINAL_QUAD = [
  { x: 0.1, y: 0.125 },
  { x: 0.5, y: 0.125 },
  { x: 0.5, y: 0.425 },
  { x: 0.1, y: 0.425 },
];

const failures = [];
let checkCount = 0;

function check(name, fn) {
  checkCount += 1;
  try {
    fn();
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

/** The same check for a step that has to await the PDF.js worker. */
async function checkAsync(name, fn) {
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

const close = (actual, expected, tolerance) =>
  Math.abs(actual - expected) <= tolerance;
const round = (value) => Number(value.toFixed(4));
const point = (value) => value.map(round);

function buildSourcePng() {
  const canvas = createCanvas(SOURCE_SIZE, SOURCE_SIZE);
  const ctx = canvas.getContext("2d");
  const half = SOURCE_SIZE / 2;
  ctx.fillStyle = "#FF0000";
  ctx.fillRect(0, 0, half, half);
  ctx.fillStyle = "#00FF00";
  ctx.fillRect(half, 0, half, half);
  ctx.fillStyle = "#0000FF";
  ctx.fillRect(0, half, half, half);
  ctx.fillStyle = "#FFFF00";
  ctx.fillRect(half, half, half, half);
  return canvas.toBuffer("image/png");
}

async function buildBasePdf(withImage) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  if (withImage) {
    const png = await pdf.embedPng(sourcePng);
    page.drawImage(png, { x: 60, y: 460, width: 240, height: 240 });
  }
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

function pixelAt(render, x, y) {
  const index = (y * render.width + x) * 4;
  return [render.data[index], render.data[index + 1], render.data[index + 2]];
}

function nearestColour(r, g, b) {
  let name = "white";
  let best = Infinity;
  for (const [key, colour] of Object.entries(PALETTE)) {
    const distance =
      Math.abs(r - colour[0]) + Math.abs(g - colour[1]) + Math.abs(b - colour[2]);
    if (distance < best) {
      best = distance;
      name = key;
    }
  }
  return { name, distance: best };
}

const isBackground = (render, x, y) => {
  const { name, distance } = nearestColour(...pixelAt(render, x, y));
  return name === "white" && distance <= WHITE_DISTANCE;
};

/** Bounding box of everything that is not page background, or null. */
function paintedBox(render, ignore = []) {
  const box = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity,
  };
  for (let y = 0; y < render.height; y++) {
    for (let x = 0; x < render.width; x++) {
      if (isBackground(render, x, y)) continue;
      const { name } = nearestColour(...pixelAt(render, x, y));
      if (ignore.includes(name)) continue;
      if (x < box.left) box.left = x;
      if (x + 1 > box.right) box.right = x + 1;
      if (y < box.top) box.top = y;
      if (y + 1 > box.bottom) box.bottom = y + 1;
    }
  }
  return Number.isFinite(box.left) ? box : null;
}

/** Majority colour of a small block around a pixel. */
function sampleColour(render, x, y, radius = 4) {
  const counts = new Map();
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= render.width || py >= render.height) continue;
      const { name, distance } = nearestColour(...pixelAt(render, px, py));
      if (distance > CLEAR_DISTANCE) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  let name = null;
  let best = 0;
  for (const [key, count] of counts) {
    if (count > best) {
      best = count;
      name = key;
    }
  }
  return { name, count: best };
}

/** The colour of the source picture at (u, v); v grows downwards. */
function quadrantColour(u, v) {
  if (u < 0.5) return v < 0.5 ? "red" : "blue";
  return v < 0.5 ? "green" : "yellow";
}

/**
 * The colour the placement matrix says a normalized display point must show.
 * Returns null outside the visible crop window of the source.
 */
function modelSampler(edit, frame) {
  const matrix = imagePlacementMatrix(edit, frame);
  const inverse = invertMatrix(matrix);
  /* The source square may run downwards (the picture) or upwards (PDF order).
   * An untransformed copy tells us which end of the square is the top. */
  const plain = {
    ...edit,
    rotation: 0,
    skew: 0,
    flipHorizontal: false,
    flipVertical: false,
  };
  const plainMatrix = imagePlacementMatrix(plain, frame);
  const topIsFirst =
    applyMatrix(plainMatrix, 0, 0)[1] < applyMatrix(plainMatrix, 0, 1)[1];
  /* The crop window of the picture, moved into the source space. */
  const window = cropWindow(edit.crop);
  const visible = {
    left: window.left,
    width: window.width,
    height: window.height,
    low: topIsFirst ? window.top : 1 - window.top - window.height,
  };
  return (dx, dy) => {
    const [u, v] = applyMatrix(inverse, dx, dy);
    if (u < visible.left || u > visible.left + visible.width) return null;
    if (v < visible.low || v > visible.low + visible.height) return null;
    return quadrantColour(u, topIsFirst ? v : 1 - v);
  };
}

/** Compare every rendered pixel with the placement matrix. */
function compareWithModel(render, edit, frame) {
  const sample = modelSampler(edit, frame);
  const expected = new Array(render.width * render.height);
  for (let y = 0; y < render.height; y++) {
    for (let x = 0; x < render.width; x++) {
      expected[y * render.width + x] =
        sample(x / render.width, y / render.height) ?? "white";
    }
  }
  let checked = 0;
  let mismatches = 0;
  const samples = [];
  for (let y = 0; y < render.height; y++) {
    for (let x = 0; x < render.width; x++) {
      const want = expected[y * render.width + x];
      /* Skip the antialiased band around every edge of the model. */
      let edge = false;
      for (let dy = -2; dy <= 2 && !edge; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= render.width || ny >= render.height)
            continue;
          if (expected[ny * render.width + nx] !== want) {
            edge = true;
            break;
          }
        }
      }
      if (edge) continue;
      const actual = nearestColour(...pixelAt(render, x, y));
      checked += 1;
      if (actual.name !== want || actual.distance > 320) {
        mismatches += 1;
        if (samples.length < 4)
          samples.push({
            x,
            y,
            expected: want,
            actual: point(pixelAt(render, x, y)),
            nearest: actual.name,
            distance: actual.distance,
          });
      }
    }
  }
  return { checked, mismatches, samples };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */
const sourcePng = buildSourcePng();
const blankPdf = await buildBasePdf(false);
const artworkPdf = await buildBasePdf(true);
const frame = displayFrame((await PDFDocument.load(blankPdf)).getPage(0), 0);

const baseEdit = {
  type: "image",
  page: 1,
  x: 0.1,
  y: 0.2,
  width: 0.4,
  height: 0.3,
  sourceData: sourcePng,
  replacementType: "image/png",
  sourceWidth: SOURCE_SIZE,
  sourceHeight: SOURCE_SIZE,
  aspectLocked: false,
};

const apply = (bytes, operations) =>
  applyOperations(bytes, operations, { fonts: {} });

/* The rect of baseEdit in page pixels. */
const RECT_PIXELS = {
  left: baseEdit.x * PAGE_WIDTH,
  top: baseEdit.y * PAGE_HEIGHT,
  right: (baseEdit.x + baseEdit.width) * PAGE_WIDTH,
  bottom: (baseEdit.y + baseEdit.height) * PAGE_HEIGHT,
};

/* ------------------------------------------------------------------ */
/* 1. A new image is painted exactly inside its rect                    */
/* ------------------------------------------------------------------ */
const plainRender = await render(
  await apply(blankPdf, [{ ...baseEdit, isNew: true }]),
);

check("a new image is painted exactly inside its rect", () => {
  const box = paintedBox(plainRender);
  assert.ok(box, "nothing was painted on the page");
  assert.ok(
    close(box.left, RECT_PIXELS.left, 2) &&
      close(box.top, RECT_PIXELS.top, 2) &&
      close(box.right, RECT_PIXELS.right, 2) &&
      close(box.bottom, RECT_PIXELS.bottom, 2),
    `painted box ${JSON.stringify(box)} does not match the expected rect ${JSON.stringify(RECT_PIXELS)} on a ${PAGE_WIDTH}x${PAGE_HEIGHT} page`,
  );
});

check("the painted image is upright (the source top-left stays on top)", () => {
  const box = paintedBox(plainRender);
  assert.ok(box, "nothing was painted on the page");
  const topLeft = sampleColour(plainRender, box.left + 12, box.top + 12);
  const bottomLeft = sampleColour(
    plainRender,
    box.left + 12,
    box.bottom - 12,
  );
  assert.equal(
    topLeft.name,
    "red",
    `top-left of the image is ${topLeft.name}, expected red`,
  );
  assert.equal(
    bottomLeft.name,
    "blue",
    `bottom-left of the image is ${bottomLeft.name}, expected blue`,
  );
});

check("the painted image matches the placement matrix", () => {
  const result = compareWithModel(plainRender, baseEdit, frame);
  assert.equal(
    result.mismatches,
    0,
    `${result.mismatches} of ${result.checked} pixels differ from the placement matrix. ` +
      `First differences: ${JSON.stringify(result.samples)}`,
  );
});

/* ------------------------------------------------------------------ */
/* 2. The crop zooms into the source                                    */
/* ------------------------------------------------------------------ */
const cropEdit = {
  ...baseEdit,
  crop: { top: 0, right: 0, bottom: 0, left: 25 },
};
const cropRender = await render(
  await apply(blankPdf, [{ ...cropEdit, isNew: true }]),
);

check("crop {left:25} shows only the right 75% of the source", () => {
  const box = paintedBox(cropRender);
  assert.ok(box, "nothing was painted on the page");
  const row = Math.round((box.top + box.bottom) / 2);
  let transition = null;
  for (let x = box.left; x < box.right; x++) {
    const { name, distance } = nearestColour(...pixelAt(cropRender, x, row));
    if (distance > CLEAR_DISTANCE) continue;
    if (name === "green" || name === "yellow") {
      transition = x;
      break;
    }
  }
  assert.ok(
    transition !== null,
    "no source-right-half colour found inside the cropped image",
  );
  const expected = box.left + (box.right - box.left) / 3;
  assert.ok(
    close(transition, expected, 3),
    `the source midline lands at x=${transition} but the crop window puts it at x=${round(expected)} (image box ${JSON.stringify(box)})`,
  );
});

check("the cropped image matches the placement matrix", () => {
  const result = compareWithModel(cropRender, cropEdit, frame);
  assert.equal(
    result.mismatches,
    0,
    `${result.mismatches} of ${result.checked} pixels differ from the placement matrix. ` +
      `First differences: ${JSON.stringify(result.samples)}`,
  );
});

/* ------------------------------------------------------------------ */
/* 3. Rotation 90                                                       */
/* ------------------------------------------------------------------ */
const rotatedEdit = { ...baseEdit, rotation: 90 };
const rotatedCorners = imageCorners(rotatedEdit, frame);

check("rotation 90 turns the image about the centre of the rect", () => {
  /* Frame points, so the shape can be measured in real units. */
  const corners = rotatedCorners.map(([dx, dy]) => [
    dx * frame.width,
    (1 - dy) * frame.height,
  ]);
  const edge = (from, to) => [
    corners[to][0] - corners[from][0],
    corners[to][1] - corners[from][1],
  ];
  const length = (vector) => Math.hypot(vector[0], vector[1]);
  const first = edge(0, 1);
  const second = edge(1, 2);
  const rectWidth = baseEdit.width * frame.width;
  const rectHeight = baseEdit.height * frame.height;
  assert.ok(
    close(length(first), rectWidth, 1e-6),
    `the rotated edge is ${round(length(first))}pt long, expected ${round(rectWidth)}pt`,
  );
  assert.ok(
    close(length(second), rectHeight, 1e-6),
    `the rotated edge is ${round(length(second))}pt long, expected ${round(rectHeight)}pt`,
  );
  assert.ok(
    close(first[0] * second[0] + first[1] * second[1], 0, 1e-6),
    "the rotated edges must stay perpendicular",
  );
  const centre = corners
    .reduce((sum, corner) => [sum[0] + corner[0] / 4, sum[1] + corner[1] / 4], [0, 0]);
  const expected = [
    (baseEdit.x + baseEdit.width / 2) * frame.width,
    (1 - (baseEdit.y + baseEdit.height / 2)) * frame.height,
  ];
  assert.ok(
    close(centre[0], expected[0], 1e-6) && close(centre[1], expected[1], 1e-6),
    `the rotated shape is centred at ${point(centre)} instead of ${point(expected)}`,
  );
});

const rotatedRender = await render(
  await apply(blankPdf, [{ ...rotatedEdit, isNew: true }]),
);

check("rotation 90 turns the image clockwise", () => {
  const box = paintedBox(rotatedRender);
  assert.ok(box, "nothing was painted on the page");
  /* Clockwise puts the source top-left (red) in the top-right corner. */
  const topRight = sampleColour(
    rotatedRender,
    box.right - 12,
    box.top + 12,
  );
  const topLeft = sampleColour(rotatedRender, box.left + 12, box.top + 12);
  assert.equal(
    topRight.name,
    "red",
    `the top-right of the rotated image is ${topRight.name}, expected red`,
  );
  assert.equal(
    topLeft.name,
    "blue",
    `the top-left of the rotated image is ${topLeft.name}, expected blue`,
  );
});

check("the rotated image matches the placement matrix", () => {
  const result = compareWithModel(rotatedRender, rotatedEdit, frame);
  assert.equal(
    result.mismatches,
    0,
    `${result.mismatches} of ${result.checked} pixels differ from the placement matrix. ` +
      `First differences: ${JSON.stringify(result.samples)}`,
  );
});

/* ------------------------------------------------------------------ */
/* 4. Flip and skew                                                     */
/* ------------------------------------------------------------------ */
const flippedEdit = { ...baseEdit, flipHorizontal: true };
const flippedRender = await render(
  await apply(blankPdf, [{ ...flippedEdit, isNew: true }]),
);

check("flipHorizontal mirrors the image inside the rect", () => {
  const box = paintedBox(flippedRender);
  assert.ok(box, "nothing was painted on the page");
  const topRight = sampleColour(flippedRender, box.right - 12, box.top + 12);
  const topLeft = sampleColour(flippedRender, box.left + 12, box.top + 12);
  assert.equal(
    topRight.name,
    "red",
    `the top-right of the flipped image is ${topRight.name}, expected red`,
  );
  assert.equal(
    topLeft.name,
    "green",
    `the top-left of the flipped image is ${topLeft.name}, expected green`,
  );
});

check("the flipped image matches the placement matrix", () => {
  const result = compareWithModel(flippedRender, flippedEdit, frame);
  assert.equal(
    result.mismatches,
    0,
    `${result.mismatches} of ${result.checked} pixels differ from the placement matrix. ` +
      `First differences: ${JSON.stringify(result.samples)}`,
  );
});

const skewedEdit = { ...baseEdit, skew: 20 };
const skewedRender = await render(
  await apply(blankPdf, [{ ...skewedEdit, isNew: true }]),
);

check("skew 20 shears the image horizontally", () => {
  const box = paintedBox(skewedRender);
  assert.ok(box, "nothing was painted on the page");
  const expectedWidth =
    RECT_PIXELS.right - RECT_PIXELS.left +
    Math.tan((20 * Math.PI) / 180) * (RECT_PIXELS.bottom - RECT_PIXELS.top);
  assert.ok(
    close(box.right - box.left, expectedWidth, 4),
    `the skewed image is ${round(box.right - box.left)}px wide, expected ${round(expectedWidth)}px`,
  );
  assert.ok(
    close(box.bottom - box.top, RECT_PIXELS.bottom - RECT_PIXELS.top, 4),
    `the skewed image is ${round(box.bottom - box.top)}px tall, expected ${round(RECT_PIXELS.bottom - RECT_PIXELS.top)}px`,
  );
});

check("the skewed image matches the placement matrix", () => {
  const result = compareWithModel(skewedRender, skewedEdit, frame);
  assert.equal(
    result.mismatches,
    0,
    `${result.mismatches} of ${result.checked} pixels differ from the placement matrix. ` +
      `First differences: ${JSON.stringify(result.samples)}`,
  );
});

/* ------------------------------------------------------------------ */
/* 5. An existing image is covered before the new one is painted       */
/* ------------------------------------------------------------------ */
const coverEdit = {
  ...baseEdit,
  isNew: false,
  originalQuad: ORIGINAL_QUAD,
  backgroundColor: "#FF00FF",
  x: 0.55,
  y: 0.6,
  width: 0.3,
  height: 0.25,
};
const coverRender = await render(await apply(artworkPdf, [{ ...coverEdit }]));

check("an existing image is covered with the background colour", () => {
  let wrong = 0;
  let checked = 0;
  for (let y = 0; y < coverRender.height; y++) {
    for (let x = 0; x < coverRender.width; x++) {
      const dx = x / coverRender.width;
      const dy = y / coverRender.height;
      const inside =
        dx > 0.1 + 0.004 &&
        dx < 0.5 - 0.004 &&
        dy > 0.125 + 0.004 &&
        dy < 0.425 - 0.004;
      if (!inside) continue;
      checked += 1;
      const { name, distance } = nearestColour(
        ...pixelAt(coverRender, x, y),
      );
      if (name !== "magenta" || distance > CLEAR_DISTANCE) wrong += 1;
    }
  }
  assert.ok(
    checked > 1000,
    `the covered area was too small (${checked} pixels)`,
  );
  assert.equal(
    wrong,
    0,
    `${wrong} of ${checked} pixels inside the original quad are not the cover colour`,
  );
});

check("the replacement image is painted at the new rect", () => {
  const box = paintedBox(coverRender, ["magenta"]);
  assert.ok(box, "the replacement image was not painted");
  const expected = {
    left: 0.55 * PAGE_WIDTH,
    top: 0.6 * PAGE_HEIGHT,
    right: 0.85 * PAGE_WIDTH,
    bottom: 0.85 * PAGE_HEIGHT,
  };
  assert.ok(
    close(box.left, expected.left, 2) &&
      close(box.top, expected.top, 2) &&
      close(box.right, expected.right, 2) &&
      close(box.bottom, expected.bottom, 2),
    `the replacement image sits at ${JSON.stringify(box)} instead of ${JSON.stringify(expected)}`,
  );
});

/* ------------------------------------------------------------------ */
/* 6. A deleted image leaves the covered area blank                      */
/* ------------------------------------------------------------------ */
const deleteRender = await render(
  await apply(artworkPdf, [{ ...coverEdit, deleted: true }]),
);

check("a deleted image leaves the covered area blank", () => {
  let wrong = 0;
  let checked = 0;
  for (let y = 0; y < deleteRender.height; y++) {
    for (let x = 0; x < deleteRender.width; x++) {
      const dx = x / deleteRender.width;
      const dy = y / deleteRender.height;
      const inside =
        dx > 0.1 + 0.004 &&
        dx < 0.5 - 0.004 &&
        dy > 0.125 + 0.004 &&
        dy < 0.425 - 0.004;
      if (!inside) continue;
      checked += 1;
      const { name, distance } = nearestColour(...pixelAt(deleteRender, x, y));
      if (name !== "magenta" || distance > CLEAR_DISTANCE) wrong += 1;
    }
  }
  assert.ok(
    checked > 1000,
    `the covered area was too small (${checked} pixels)`,
  );
  assert.equal(
    wrong,
    0,
    `${wrong} of ${checked} pixels inside the original quad still show image content`,
  );
});

/* ------------------------------------------------------------------ */
/* 7. The numeric invariant                                             */
/* ------------------------------------------------------------------ */
check("imagePlacement maps the unit square onto the rect", () => {
  const matrix = imagePlacement(frame, baseEdit);
  const corners = [
    transformPoint(matrix, 0, 0),
    transformPoint(matrix, 1, 0),
    transformPoint(matrix, 0, 1),
    transformPoint(matrix, 1, 1),
  ];
  const rect = [
    [baseEdit.x * frame.width, (1 - baseEdit.y) * frame.height],
    [
      (baseEdit.x + baseEdit.width) * frame.width,
      (1 - baseEdit.y) * frame.height,
    ],
    [baseEdit.x * frame.width, (1 - baseEdit.y - baseEdit.height) * frame.height],
    [
      (baseEdit.x + baseEdit.width) * frame.width,
      (1 - baseEdit.y - baseEdit.height) * frame.height,
    ],
  ];
  for (const corner of corners) {
    const onCorner = rect.some(
      (expected) =>
        close(corner[0], expected[0], 1e-6) && close(corner[1], expected[1], 1e-6),
    );
    assert.ok(
      onCorner,
      `the unit square maps to ${JSON.stringify(corners.map(point))}, ` +
        `which is not the rect ${JSON.stringify(rect.map(point))}`,
    );
  }
  /* The unit square must cover the rect, not a part of it. */
  assert.ok(
    close(
      Math.hypot(
        corners[1][0] - corners[0][0],
        corners[1][1] - corners[0][1],
      ),
      baseEdit.width * frame.width,
      1e-6,
    ),
    "the unit square must be scaled to the width of the rect",
  );
  assert.ok(
    close(
      Math.hypot(
        corners[2][0] - corners[0][0],
        corners[2][1] - corners[0][1],
      ),
      baseEdit.height * frame.height,
      1e-6,
    ),
    "the unit square must be scaled to the height of the rect",
  );
  console.log(
    `       unit square corners in frame points: ${JSON.stringify(corners.map(point))}`,
  );
});


/* ------------------------------------------------------------------ */
/* 8. Duplicate semantics                                               */
/* ------------------------------------------------------------------ */
check("duplicateImage returns a new placement that never covers the source", () => {
  const copy = duplicateImage({ ...coverEdit }, "image-copy");
  assert.equal(copy.isNew, true, "a duplicate is a new placement");
  assert.equal(
    copy.originalQuad,
    undefined,
    "a duplicate must not cover the source artwork",
  );
  assert.equal(
    copy.original,
    undefined,
    "a duplicate must not keep the source rectangle",
  );
  assert.equal(copy.key, "image-copy");
  assert.ok(
    copy.x > coverEdit.x && copy.y > coverEdit.y,
    "a duplicate is offset from the original",
  );
});

const duplicateRender = await render(
  await apply(artworkPdf, [
    { ...coverEdit },
    {
      ...duplicateImage({ ...coverEdit }, "image-copy"),
      backgroundColor: "#00FFFF",
    },
  ]),
);

check("a duplicate does not paint a second cover over the source artwork", () => {
  let wrong = 0;
  let checked = 0;
  for (let y = 0; y < duplicateRender.height; y++) {
    for (let x = 0; x < duplicateRender.width; x++) {
      const dx = x / duplicateRender.width;
      const dy = y / duplicateRender.height;
      const inside =
        dx > 0.1 + 0.004 &&
        dx < 0.5 - 0.004 &&
        dy > 0.125 + 0.004 &&
        dy < 0.425 - 0.004;
      if (!inside) continue;
      checked += 1;
      const { name, distance } = nearestColour(
        ...pixelAt(duplicateRender, x, y),
      );
      if (name !== "magenta" || distance > CLEAR_DISTANCE) wrong += 1;
    }
  }
  assert.ok(checked > 1000, `the covered area was too small (${checked} pixels)`);
  assert.equal(
    wrong,
    0,
    `${wrong} of ${checked} pixels inside the original quad are not the original cover colour`,
  );
});

/* ------------------------------------------------------------------ */
/* 9. Rotation stays isotropic on a non-square page                    */
/* ------------------------------------------------------------------ */
check("a 90 degree rotation keeps the image shape on a non-square page", () => {
  const landscape = { width: 400, height: 700 };
  const edit = {
    ...baseEdit,
    x: 0.15,
    y: 0.3,
    width: 0.5,
    height: 0.2,
    rotation: 90,
  };
  const corners = imageCorners(edit, landscape);
  const toPoints = (corner) => [
    corner[0] * landscape.width,
    (1 - corner[1]) * landscape.height,
  ];
  const edge = (from, to) => {
    const [ax, ay] = toPoints(corners[from]);
    const [bx, by] = toPoints(corners[to]);
    return Math.hypot(bx - ax, by - ay);
  };
  /* The source edges are 200 and 140 points long; a rotation may not change
   * them, and the rotated footprint stays the same size in points. */
  assert.ok(
    close(edge(0, 1), edit.width * landscape.width, 1e-6),
    `the rotated edge is ${round(edge(0, 1))} points instead of ${round(edit.width * landscape.width)}`,
  );
  assert.ok(
    close(edge(1, 2), edit.height * landscape.height, 1e-6),
    `the rotated side edge is ${round(edge(1, 2))} points instead of ${round(edit.height * landscape.height)}`,
  );
  const xs = corners.map((corner) => corner[0] * landscape.width);
  const ys = corners.map((corner) => (1 - corner[1]) * landscape.height);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  assert.ok(
    close(spanX, edit.height * landscape.height, 1e-6) &&
      close(spanY, edit.width * landscape.width, 1e-6),
    `the rotated footprint is ${round(spanX)}x${round(spanY)} points instead of ${round(edit.height * landscape.height)}x${round(edit.width * landscape.width)}`,
  );
});

/* ------------------------------------------------------------------ */
/* 10. A real embedded image is captured and can be moved             */
/* ------------------------------------------------------------------ */

/* PDF.js hands an image that is used on more than one page to the shared
 * object store under an id that starts with "g_". The page store never
 * resolves such an id, so a capture that only looks at the page store waits
 * for an object that can never arrive. */
function multiply(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

/** The painted image in an operator list, with the matrix that places it. */
function paintedImage(operators) {
  const { OPS } = pdfjs;
  let transform = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const operation = operators.fnArray[index];
    const args = operators.argsArray[index] || [];
    if (operation === OPS.save) stack.push(transform);
    else if (operation === OPS.restore) transform = stack.pop() || transform;
    else if (operation === OPS.transform && args.length >= 6)
      transform = multiply(transform, args.slice(0, 6));
    else if (operation === OPS.paintImageXObject)
      return { id: args[0], width: Number(args[1]) || 0, height: Number(args[2]) || 0, transform };
  }
  return null;
}

/** Read an image object without waiting forever, like the editor does. */
function boundedObject(store, id, timeoutMs = 400) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value || null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      store.get(id, (data) => finish(data));
    } catch {
      finish(null);
    }
  });
}

/** The pixels of a PDF.js image object as RGBA bytes. */
function objectToRgba(source) {
  const width = Number(source?.width) || 0;
  const height = Number(source?.height) || 0;
  if (!width || !height) return null;
  if (source.data?.length === width * height * 4)
    return { width, height, data: new Uint8ClampedArray(source.data) };
  if (source.data?.length === width * height * 3) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let p = 0, q = 0; p < source.data.length; p += 3, q += 4) {
      rgba[q] = source.data[p];
      rgba[q + 1] = source.data[p + 1];
      rgba[q + 2] = source.data[p + 2];
      rgba[q + 3] = 255;
    }
    return { width, height, data: rgba };
  }
  return null;
}

/** The pixels of a PDF.js image object as PNG bytes. */
function objectToPng(source) {
  const pixels = objectToRgba(source);
  if (!pixels) return null;
  const canvas = createCanvas(pixels.width, pixels.height);
  const context = canvas.getContext("2d");
  context.putImageData(
    new ImageData(pixels.data, pixels.width, pixels.height),
    0,
    0,
  );
  return canvas.toBuffer("image/png");
}

async function buildSharedPdf() {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(sourcePng);
  for (let index = 0; index < 2; index += 1) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawImage(image, { x: 60, y: 460, width: 240, height: 240 });
  }
  return pdf.save();
}

const sharedPdf = await buildSharedPdf();
const sharedTask = pdfjs.getDocument({ standardFontDataUrl, data: sharedPdf.slice() });
const sharedDoc = await sharedTask.promise;
/* The first page builds the image; the second page finds it in the global
 * image cache and receives a shared id. */
await (await sharedDoc.getPage(1)).getOperatorList();
const sharedPage = await sharedDoc.getPage(2);
const sharedOperators = await sharedPage.getOperatorList();
const sharedImage = paintedImage(sharedOperators);
const sharedViewport = sharedPage.getViewport({ scale: 1 });
const sharedCombined = multiply(sharedViewport.transform, sharedImage.transform);
const sharedCorners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
].map(([x, y]) => ({
  x: (sharedCombined[0] * x + sharedCombined[2] * y + sharedCombined[4]) / sharedViewport.width,
  y: (sharedCombined[1] * x + sharedCombined[3] * y + sharedCombined[5]) / sharedViewport.height,
}));

await checkAsync(
  "an image used on two pages is delivered under a shared id",
  () => {
    assert.ok(
      String(sharedImage.id).startsWith("g_"),
      `expected a shared image id, got ${sharedImage.id}`,
    );
    assert.equal(
      sharedPage.objs.has(sharedImage.id),
      false,
      "the page object store must not hold a shared image",
    );
  },
);

await checkAsync(
  "the page object store never resolves a shared image id",
  async () => {
    const started = Date.now();
    const source = await boundedObject(sharedPage.objs, sharedImage.id, 400);
    assert.equal(
      source,
      null,
      "the page store must report a missing image instead of an object",
    );
    assert.ok(
      Date.now() - started < 2000,
      "the lookup must give up instead of waiting for the object",
    );
  },
);

await checkAsync(
  "the shared object store resolves the image",
  async () => {
    const source = await boundedObject(
      sharedPage.commonObjs,
      sharedImage.id,
      2000,
    );
    assert.ok(source, "the shared image must be readable");
    assert.equal(source.width, sharedImage.width);
    assert.equal(source.height, sharedImage.height);
  },
);

const sharedSource = await boundedObject(
  sharedPage.commonObjs,
  sharedImage.id,
  2000,
);
const sharedPng = sharedSource ? objectToPng(sharedSource) : null;

check("the captured artwork keeps the source pixels", () => {
  assert.ok(sharedPng, "the captured image must have pixels");
  const pixels = objectToRgba(sharedSource);
  assert.ok(pixels, "the captured image must have readable pixels");
  const pixel = (x, y) => {
    const index = (y * pixels.width + x) * 4;
    return [pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]];
  };
  assert.deepEqual(pixel(50, 50), PALETTE.red, "the top-left quadrant is red");
  assert.deepEqual(pixel(350, 50), PALETTE.green, "the top-right quadrant is green");
  assert.deepEqual(pixel(50, 350), PALETTE.blue, "the bottom-left quadrant is blue");
  assert.deepEqual(
    pixel(350, 350),
    PALETTE.yellow,
    "the bottom-right quadrant is yellow",
  );
});

/* The captured artwork is moved to another rect and written back. */
const capturedEdit = {
  type: "image",
  page: 2,
  x: 0.55,
  y: 0.6,
  width: 0.3,
  height: 0.25,
  sourceData: sharedPng,
  replacementType: "image/png",
  sourceWidth: sharedImage.width,
  sourceHeight: sharedImage.height,
  originalQuad: sharedCorners,
  backgroundColor: "#FF00FF",
  aspectLocked: false,
};
const capturedRender = await render(
  await apply(sharedPdf, [{ ...capturedEdit }]),
  2,
);

check("a captured image is painted at its new rect", () => {
  const box = paintedBox(capturedRender, ["magenta"]);
  assert.ok(box, "the captured image was not painted");
  const expected = {
    left: 0.55 * PAGE_WIDTH,
    top: 0.6 * PAGE_HEIGHT,
    right: 0.85 * PAGE_WIDTH,
    bottom: 0.85 * PAGE_HEIGHT,
  };
  assert.ok(
    close(box.left, expected.left, 2) &&
      close(box.top, expected.top, 2) &&
      close(box.right, expected.right, 2) &&
      close(box.bottom, expected.bottom, 2),
    `the captured image sits at ${JSON.stringify(box)} instead of ${JSON.stringify(expected)}`,
  );
  const corner = sampleColour(capturedRender, box.left + 12, box.top + 12);
  assert.equal(
    corner.name,
    "red",
    `the captured artwork is ${corner.name} in the top-left corner, expected red`,
  );
});

check("the area the captured image came from is covered", () => {
  let wrong = 0;
  let checked = 0;
  for (let y = 0; y < capturedRender.height; y++) {
    for (let x = 0; x < capturedRender.width; x++) {
      const dx = x / capturedRender.width;
      const dy = y / capturedRender.height;
      const inside =
        dx > 0.1 + 0.004 &&
        dx < 0.5 - 0.004 &&
        dy > 0.125 + 0.004 &&
        dy < 0.425 - 0.004;
      if (!inside) continue;
      checked += 1;
      const { name, distance } = nearestColour(
        ...pixelAt(capturedRender, x, y),
      );
      if (name !== "magenta" || distance > CLEAR_DISTANCE) wrong += 1;
    }
  }
  assert.ok(checked > 1000, `the covered area was too small (${checked} pixels)`);
  assert.equal(
    wrong,
    0,
    `${wrong} of ${checked} pixels inside the original quad are not the cover colour`,
  );
});

/* ------------------------------------------------------------------ */
/* 11. The editor keeps the image props it declares                    */
/* ------------------------------------------------------------------ */
const studioSource = await fs.readFile("src/pages/ToolStudioPage.jsx", "utf8");
const engineSource = await fs.readFile("src/pdfEngine.js", "utf8");

check("the image objects receive the declared delete and duplicate props", () => {
  assert.equal(
    /onDelete=\{onDeleteImage\}|onDuplicate=\{onDuplicateImage\}/.test(studioSource),
    false,
    "the image objects must not use props that PdfViewerPage does not declare",
  );
  assert.ok(
    studioSource.includes("onDelete={onImageDelete}"),
    "the image objects must receive onImageDelete",
  );
  assert.ok(
    studioSource.includes("onDuplicate={onImageDuplicate}"),
    "the image objects must receive onImageDuplicate",
  );
  assert.ok(
    /function PdfViewerPage\(\{[\s\S]*?onImageDelete = \(\) => \{\}/.test(studioSource),
    "PdfViewerPage must declare onImageDelete",
  );
  assert.ok(
    /function PdfViewerPage\(\{[\s\S]*?onImageDuplicate = \(\) => \{\}/.test(studioSource),
    "PdfViewerPage must declare onImageDuplicate",
  );
});

check("the source capture reads a shared image from the shared store", () => {
  assert.ok(
    /startsWith\(['"]g_['"]\)/.test(engineSource),
    "the capture must recognise a shared image id",
  );
  assert.ok(
    engineSource.includes("commonObjs"),
    "the capture must read shared images from the shared object store",
  );
  assert.equal(
    /page\.objs\.get\(sourceId,\s*resolve\)/.test(engineSource),
    false,
    "the capture must not wait for an object that PDF.js never delivers",
  );
});

check("the capture and the image regions share one capture placement", () => {
  assert.ok(
    /captureImagePlacement\(combined, width, height\)/.test(engineSource),
    "the capture must use the shared capture placement",
  );
  assert.ok(
    /sourceWidth: capture\.canvasWidth \|\| null/.test(engineSource),
    "the source width of a region must be the width of its capture",
  );
  assert.ok(
    /sourceHeight: capture\.canvasHeight \|\| null/.test(engineSource),
    "the source height of a region must be the height of its capture",
  );
});

/* ------------------------------------------------------------------ */
/* 12. The capture of a PDF image keeps the orientation of the page    */
/* ------------------------------------------------------------------ */

/* The picture of the capture fixture is 240x160 pixels and carries four
 * different quadrants, so a mirrored capture shows in every direction: a
 * vertical mirror swaps red with green, a horizontal mirror swaps red with
 * blue and a full mirror swaps red with yellow. The frame is not square,
 * so a rotated picture is a different shape as well. */
const CAPTURE_WIDTH = 240;
const CAPTURE_HEIGHT = 160;

function buildCaptureFixture() {
  const canvas = createCanvas(CAPTURE_WIDTH, CAPTURE_HEIGHT);
  const ctx = canvas.getContext("2d");
  const halfWidth = CAPTURE_WIDTH / 2;
  const halfHeight = CAPTURE_HEIGHT / 2;
  ctx.fillStyle = "#FF0000";
  ctx.fillRect(0, 0, halfWidth, halfHeight);
  ctx.fillStyle = "#00FF00";
  ctx.fillRect(halfWidth, 0, halfWidth, halfHeight);
  ctx.fillStyle = "#0000FF";
  ctx.fillRect(0, halfHeight, halfWidth, halfHeight);
  ctx.fillStyle = "#FFFF00";
  ctx.fillRect(halfWidth, halfHeight, halfWidth, halfHeight);
  return canvas;
}

const captureFixture = buildCaptureFixture();

/** The colour of the fixture at a point of the PDF image space. */
function fixtureColour(u, v) {
  if (u < 0.5) return v > 0.5 ? "red" : "blue";
  return v > 0.5 ? "green" : "yellow";
}

/** A page with the fixture drawn on it, upright or turned by 90 degrees. */
async function buildCapturePdf(rotation) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const png = await pdf.embedPng(captureFixture.toBuffer("image/png"));
  if (rotation === 90)
    page.drawImage(png, {
      x: 400,
      y: 100,
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      rotate: degrees(90),
    });
  else
    page.drawImage(png, {
      x: 60,
      y: 460,
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
    });
  return pdf.save();
}

/** The colour of one pixel of a canvas. */
function canvasColour(canvas, x, y) {
  const data = canvas
    .getContext("2d")
    .getImageData(x, y, 1, 1)
    .data;
  return [data[0], data[1], data[2]];
}

/**
 * The capture of the image on a page, drawn the way the editor draws it,
 * together with the render of the same page.
 */
async function captureOnPage(rotation) {
  const bytes = await buildCapturePdf(rotation);
  const task = pdfjs.getDocument({ standardFontDataUrl, data: bytes.slice() });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const operators = await page.getOperatorList();
  const painted = paintedImage(operators);
  const combined = multiply(viewport.transform, painted.transform);
  const placement = captureImagePlacement(
    combined,
    painted.width,
    painted.height,
  );
  const canvas = createCanvas(placement.canvasWidth, placement.canvasHeight);
  const context = canvas.getContext("2d");
  context.setTransform(...placement.matrix);
  context.drawImage(captureFixture, 0, 0, 1, 1);
  const pageRender = await render(bytes);
  await task.destroy();
  return { combined, placement, canvas, pageRender };
}

for (const rotation of [0, 90]) {
  await checkAsync(
    `the capture of an image turned by ${rotation} degrees shows the picture as the page does`,
    async () => {
      const { combined, placement, canvas, pageRender } =
        await captureOnPage(rotation);
      /* The capture is the size of the picture as it is placed, so a turned
       * picture is captured turned. */
      assert.equal(
        placement.canvasWidth,
        rotation === 0 ? CAPTURE_WIDTH : CAPTURE_HEIGHT,
        `the capture is ${placement.canvasWidth} pixels wide`,
      );
      assert.equal(
        placement.canvasHeight,
        rotation === 0 ? CAPTURE_HEIGHT : CAPTURE_WIDTH,
        `the capture is ${placement.canvasHeight} pixels high`,
      );
      const scaleX = placement.canvasWidth / (placement.right - placement.left);
      const scaleY = placement.canvasHeight / (placement.bottom - placement.top);
      /* The four centres of the quadrants of the picture, in the image
       * space of the PDF, where the y axis points up. */
      for (const [u, v] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const expected = fixtureColour(u, v);
        const pageX = combined[0] * u + combined[2] * v + combined[4];
        const pageY = combined[1] * u + combined[3] * v + combined[5];
        const onPage = nearestColour(
          ...pixelAt(pageRender, Math.round(pageX), Math.round(pageY)),
        );
        assert.equal(
          onPage.name,
          expected,
          `the page shows ${onPage.name} at ${round(pageX)},${round(pageY)}, expected ${expected}`,
        );
        const captureX = Math.round((pageX - placement.left) * scaleX);
        const captureY = Math.round((pageY - placement.top) * scaleY);
        const captured = nearestColour(
          ...canvasColour(canvas, captureX, captureY),
        );
        assert.equal(
          captured.name,
          expected,
          `the capture shows ${captured.name} at ${captureX},${captureY}, expected ${expected}`,
        );
      }
    },
  );
}

/* ------------------------------------------------------------------ */
if (failures.length) {
  console.log(
    `\nFAIL image editing pipeline: ${failures.length} of ${checkCount} checks failed`,
  );
  for (const failure of failures) console.log(`  - ${failure.name}`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS image editing pipeline (${checkCount} checks)`);
}
