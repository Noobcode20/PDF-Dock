import {
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  TextRenderingMode,
  setTextRenderingMode,
} from "pdf-lib";
import { displayFrame } from "./coordinates.js";
/** Actual invisible PDF content; no annotation or page image replacement. */
export function addOcrWords(page, words, font, canvasWidth, canvasHeight) {
  const frame = displayFrame(page);
  let count = 0;
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...frame.matrix),
    setTextRenderingMode(TextRenderingMode.Invisible),
  );
  try {
    for (const word of words) {
      const text = String(word.text || "").trim(),
        b = word.bbox;
      if (!text || !b || b.x1 <= b.x0 || b.y1 <= b.y0) continue;
      font.encodeText(text);
      const size = ((b.y1 - b.y0) / canvasHeight) * frame.height,
        x = (b.x0 / canvasWidth) * frame.width,
        y = (1 - b.y1 / canvasHeight) * frame.height,
        width = ((b.x1 - b.x0) / canvasWidth) * frame.width,
        scale = width / font.widthOfTextAtSize(text, size);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(scale, 0, 0, 1, x * (1 - scale), 0),
      );
      page.drawText(text, { x, y, size, font, opacity: 0 });
      page.pushOperators(popGraphicsState());
      count++;
    }
  } finally {
    page.pushOperators(popGraphicsState());
  }
  return count;
}
