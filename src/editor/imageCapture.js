/** Capture a PDF image with its placement baked in.
 *
 * The raster of a PDF image runs from the top left downwards, while the
 * image space of a PDF runs from the bottom left upwards. A capture that
 * draws the raster into the PDF image space without that mirror comes back
 * flipped, so the mirror is part of the capture matrix.
 *
 * The helpers here are pure, so the editor and the tests can share them. */

/** The mirror between a downwards raster and the upwards PDF image space. */
export const SOURCE_RASTER_FLIP = [1, 0, 0, -1, 0, 1]

/** The longest edge of a capture, so a huge image cannot exhaust memory. */
export const CAPTURE_LIMIT = 4096

/** Multiply two matrices, the right one is applied first. */
const multiply = (left, right) => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
]

/**
 * The matrix and the canvas size that capture one source raster with the
 * placement of the image baked in.
 *
 * `combined` is the viewport and content transform of the image, so it maps
 * the unit square of the PDF image space onto the page. The returned matrix
 * maps the raster of the image (top left, downwards) onto the capture
 * canvas, and the canvas size is the size of the image as it is placed, so
 * a rotated image is captured rotated.
 */
export function captureImagePlacement(combined, sourceWidth, sourceHeight, options = {}) {
  const width = Math.max(0, Number(sourceWidth) || 0)
  const height = Math.max(0, Number(sourceHeight) || 0)
  const limit = Math.max(1, Number(options.limit) || CAPTURE_LIMIT)
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => ({
    x: combined[0] * x + combined[2] * y + combined[4],
    y: combined[1] * x + combined[3] * y + combined[5],
  }))
  const left = Math.min(...corners.map((corner) => corner.x))
  const top = Math.min(...corners.map((corner) => corner.y))
  const right = Math.max(...corners.map((corner) => corner.x))
  const bottom = Math.max(...corners.map((corner) => corner.y))
  const spanX = Math.hypot(combined[0], combined[1]) || 1
  const spanY = Math.hypot(combined[2], combined[3]) || 1
  let canvasWidth = width ? Math.max(1, Math.round((right - left) * width / spanX)) : 0
  let canvasHeight = height ? Math.max(1, Math.round((bottom - top) * height / spanY)) : 0
  if (canvasWidth && canvasHeight) {
    const scale = Math.min(1, limit / Math.max(canvasWidth, canvasHeight))
    canvasWidth = Math.max(1, Math.round(canvasWidth * scale))
    canvasHeight = Math.max(1, Math.round(canvasHeight * scale))
  }
  const scaleX = canvasWidth && right > left ? canvasWidth / (right - left) : 1
  const scaleY = canvasHeight && bottom > top ? canvasHeight / (bottom - top) : 1
  /* The raster is mirrored into the PDF image space first, then the
   * placement of the image is applied, then the result is moved onto the
   * capture canvas. */
  const matrix = multiply(
    [scaleX, 0, 0, scaleY, 0, 0],
    multiply([1, 0, 0, 1, -left, -top], multiply(combined, SOURCE_RASTER_FLIP)),
  )
  return { matrix, canvasWidth, canvasHeight, left, top, right, bottom }
}
