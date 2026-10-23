/** Shared geometry for image placement.
 *
 * One placement pipeline drives the on-screen preview and the PDF writer, so a
 * transform can never drift between what the editor shows and what it saves.
 *
 * Spaces:
 *  - source space: the unit square of the image pixels (0,0 top-left, 1,1 bottom-right).
 *  - display space: normalized page coordinates, x right and y DOWN (top-left origin),
 *    relative to the upright display frame of the page.
 *  - frame space: PDF points of the upright display frame, y UP.
 *
 * Matrices are [a,b,c,d,e,f] with x' = a*x + c*y + e and y' = b*x + d*y + f,
 * matching the PDF `cm` operator and pdf-lib's concatTransformationMatrix.
 */

/** Composition `m` after `n` (n is applied to the coordinates first). */
export function multiplyMatrices(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export function invertMatrix(m) {
  const [a, b, c, d, e, f] = m,
    determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new Error("This image transform cannot be inverted.");
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}
export function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
export const identityMatrix = () => [1, 0, 0, 1, 0, 0];
export const translationMatrix = (x, y) => [1, 0, 0, 1, x, y];
export const scalingMatrix = (x, y) => [x, 0, 0, y, 0, 0];

export const EMPTY_CROP = { top: 0, right: 0, bottom: 0, left: 0 };
/* A crop may trim almost the whole image: "fill page" has to crop away
 * everything outside the page aspect, which can be more than half of the
 * picture for an extreme source. */
const MAX_CROP_SIDE = 95;

/** Clamp a crop to a usable window. Percentages are of the source image. */
export function clampCrop(crop) {
  const side = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(MAX_CROP_SIDE, number)) : 0;
  };
  const next = {
    top: side(crop?.top),
    right: side(crop?.right),
    bottom: side(crop?.bottom),
    left: side(crop?.left),
  };
  if (next.top + next.bottom > 100 - 1) {
    const overflow = next.top + next.bottom - (100 - 1);
    next.bottom = Math.max(0, next.bottom - overflow);
    next.top = Math.max(0, next.top - overflow);
  }
  if (next.left + next.right > 100 - 1) {
    const overflow = next.left + next.right - (100 - 1);
    next.right = Math.max(0, next.right - overflow);
    next.left = Math.max(0, next.left - overflow);
  }
  return next;
}

/** The visible window of the source image, as fractions of the image rows
 * (v grows downwards, the way the picture looks). */
export function cropWindow(crop) {
  const safe = clampCrop(crop);
  const left = safe.left / 100,
    top = safe.top / 100,
    right = safe.right / 100,
    bottom = safe.bottom / 100;
  return {
    left,
    top,
    width: Math.max(0.02, 1 - left - right),
    height: Math.max(0.02, 1 - top - bottom),
    right: 1 - right,
    bottom: 1 - bottom,
  };
}
/** The same window in source space, where y grows upwards like PDF points. */
export function sourceCropWindow(crop) {
  const window = cropWindow(crop);
  return {
    left: window.left,
    bottom: 1 - window.top - window.height,
    width: window.width,
    height: window.height,
  };
}
export const hasCrop = (crop) =>
  ["top", "right", "bottom", "left"].some((side) => Number(crop?.[side]) > 0);

/** Sanitized copy of an image edit. Bounds stay inside the page. */
export function normalizeImageEdit(edit = {}) {
  const width = Math.max(0.005, Math.min(1, Number(edit.width) || 0.2)),
    height = Math.max(0.005, Math.min(1, Number(edit.height) || 0.2));
  return {
    ...edit,
    x: Math.max(0, Math.min(1 - width, Number(edit.x) || 0)),
    y: Math.max(0, Math.min(1 - height, Number(edit.y) || 0)),
    width,
    height,
    rotation: Number.isFinite(Number(edit.rotation)) ? Number(edit.rotation) : 0,
    skew: Number.isFinite(Number(edit.skew)) ? Number(edit.skew) : 0,
    flipHorizontal: Boolean(edit.flipHorizontal),
    flipVertical: Boolean(edit.flipVertical),
    aspectLocked: edit.aspectLocked === undefined ? true : Boolean(edit.aspectLocked),
    crop: clampCrop(edit.crop || EMPTY_CROP),
    sourceWidth: Number(edit.sourceWidth) || null,
    sourceHeight: Number(edit.sourceHeight) || null,
  };
}

/** Source unit square -> content unit square, applying the crop zoom.
 * Source space uses PDF orientation (y up), so the crop that removes rows from
 * the top of the picture trims the upper edge of that square. */
export function imageContentMatrix(edit) {
  const window = sourceCropWindow(edit?.crop);
  return [
    1 / window.width,
    0,
    0,
    1 / window.height,
    -window.left / window.width,
    -window.bottom / window.height,
  ];
}

/** Rotation, flips and skew applied around the centre of the placement rect.
 * The rect is given in FRAME POINTS so the rotation stays isotropic: normalized
 * page axes have different point scales on a non-square page. */
export function imageUserMatrix(edit, rect) {
  const rotation = (Number(edit?.rotation) || 0) * Math.PI / 180,
    skew = (Number(edit?.skew) || 0) * Math.PI / 180;
  const centerX = (Number(rect?.x) || 0) + (Number(rect?.width) || 0) / 2,
    centerY = (Number(rect?.y) || 0) + (Number(rect?.height) || 0) / 2;
  // Applied to the point first: skew, then flips, then the rotation, all about the rect centre.
  let matrix = identityMatrix();
  if (skew) matrix = multiplyMatrices(matrix, [1, 0, Math.tan(skew), 1, 0, 0]);
  if (edit?.flipHorizontal) matrix = multiplyMatrices(matrix, [-1, 0, 0, 1, 0, 0]);
  if (edit?.flipVertical) matrix = multiplyMatrices(matrix, [1, 0, 0, -1, 0, 0]);
  // Frame points are y up, so a clockwise rotation on screen is [cos, -sin, sin, cos].
  matrix = multiplyMatrices(
    [Math.cos(rotation), -Math.sin(rotation), Math.sin(rotation), Math.cos(rotation), 0, 0],
    matrix,
  );
  matrix = multiplyMatrices(translationMatrix(centerX, centerY), matrix);
  return multiplyMatrices(matrix, translationMatrix(-centerX, -centerY));
}

/** The placement rectangle in frame points (y up). */
export function imageRectPoints(edit, frame) {
  const normalized = normalizeImageEdit(edit);
  const width = frame?.width || 1,
    height = frame?.height || 1;
  return {
    x: normalized.x * width,
    y: (1 - normalized.y - normalized.height) * height,
    width: normalized.width * width,
    height: normalized.height * height,
  };
}

/** Source unit square -> frame points (y up). */
export function imagePlacementPoints(edit, frame) {
  const normalized = normalizeImageEdit(edit);
  const rect = imageRectPoints(normalized, frame);
  const content = imageContentMatrix(normalized);
  const place = multiplyMatrices(
    translationMatrix(rect.x, rect.y),
    scalingMatrix(rect.width, rect.height),
  );
  return multiplyMatrices(
    imageUserMatrix(normalized, rect),
    multiplyMatrices(place, content),
  );
}

/** Source unit square -> normalized display space (y down). */
export function imagePlacementMatrix(edit, frame) {
  const width = frame?.width || 1,
    height = frame?.height || 1;
  return multiplyMatrices([1 / width, 0, 0, -1 / height, 0, 1], imagePlacementPoints(edit, frame));
}

/** Normalized display space -> frame points (y up). */
export function displayToFrameMatrix(matrix, frame) {
  const width = frame?.width || 1,
    height = frame?.height || 1;
  return multiplyMatrices([width, 0, 0, -height, 0, height], matrix);
}

/** Source unit square -> frame points (y up). Used by the PDF writer. */
export function imagePlacement(frame, edit) {
  return imagePlacementPoints(edit, frame);
}

/** Source unit square -> preview pixels (y down), for the SVG preview. */
export function imageSvgMatrix(edit, frame) {
  // The picture box of an SVG element starts at its top left, so the source
  // space has to be flipped before it is mapped into the page.
  return multiplyMatrices(imagePlacementMatrix(edit, frame), [1, 0, 0, -1, 0, 1]);
}

/** The four corners of the placed image in normalized display space. */
export function imageCorners(edit, frame) {
  const matrix = imagePlacementMatrix(edit, frame);
  return [
    applyMatrix(matrix, 0, 0),
    applyMatrix(matrix, 1, 0),
    applyMatrix(matrix, 1, 1),
    applyMatrix(matrix, 0, 1),
  ];
}

/** Aspect of the visible content (source pixels), crop included. */
export function contentAspect(edit, pageAspect = 1) {
  const width = Number(edit?.sourceWidth) || null,
    height = Number(edit?.sourceHeight) || null;
  const window = cropWindow(edit?.crop);
  if (width && height) return (width * window.width) / (height * window.height);
  const rectWidth = (Number(edit?.width) || 0.01) * (pageAspect || 1);
  const rectHeight = Number(edit?.height) || 0.01;
  return rectWidth / rectHeight;
}

/** Resize an edit, keeping the aspect ratio when the aspect is locked. */
export function resizeImage(edit, patch, frame) {
  const next = normalizeImageEdit(edit);
  const pageAspect = (frame?.width || 1) / (frame?.height || 1);
  const aspect = contentAspect(next, pageAspect);
  let width = patch.width === undefined ? next.width : Math.max(0.01, Math.min(1, Number(patch.width)));
  let height = patch.height === undefined ? next.height : Math.max(0.01, Math.min(1, Number(patch.height)));
  if (next.aspectLocked) {
    if (patch.width !== undefined && patch.height === undefined)
      height = Math.max(0.005, Math.min(1, (width * pageAspect) / (aspect || 1)));
    else if (patch.height !== undefined && patch.width === undefined)
      width = Math.max(0.005, Math.min(1, (height * aspect) / (pageAspect || 1)));
  }
  return normalizeImageEdit({
    ...next,
    width,
    height,
    x: patch.x === undefined ? Math.min(next.x, Math.max(0, 1 - width)) : patch.x,
    y: patch.y === undefined ? Math.min(next.y, Math.max(0, 1 - height)) : patch.y,
  });
}

/** Largest centred rectangle with the content aspect that fits the page. */
export function fitImageToPage(edit, frame) {
  const next = normalizeImageEdit(edit);
  const pageAspect = (frame?.width || 1) / (frame?.height || 1);
  const aspect = contentAspect(next, pageAspect);
  let width = 1,
    height = 1;
  if (aspect >= pageAspect) {
    width = 1;
    height = pageAspect / aspect;
  } else {
    height = 1;
    width = aspect / pageAspect;
  }
  return normalizeImageEdit({
    ...next,
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
  });
}

/** Cover the page with the content, cropping the overflow instead of stretching. */
export function fillImageToPage(edit, frame) {
  const next = normalizeImageEdit(edit);
  const pageAspect = (frame?.width || 1) / (frame?.height || 1);
  const sourceWidth = Number(next.sourceWidth) || null,
    sourceHeight = Number(next.sourceHeight) || null;
  if (!sourceWidth || !sourceHeight) {
    return normalizeImageEdit({ ...next, x: 0, y: 0, width: 1, height: 1 });
  }
  const window = cropWindow(next.crop);
  const visibleWidth = sourceWidth * window.width,
    visibleHeight = sourceHeight * window.height;
  const visibleAspect = visibleWidth / visibleHeight;
  let cropWidth = visibleWidth,
    cropHeight = visibleHeight;
  if (visibleAspect > pageAspect) {
    cropWidth = visibleHeight * pageAspect;
  } else {
    cropHeight = visibleWidth / pageAspect;
  }
  const extraLeft = (visibleWidth - cropWidth) / 2,
    extraTop = (visibleHeight - cropHeight) / 2;
  const crop = clampCrop({
    left: (window.left * sourceWidth + extraLeft) / sourceWidth * 100,
    top: (window.top * sourceHeight + extraTop) / sourceHeight * 100,
    right: (window.right * sourceWidth - extraLeft) / sourceWidth * 100,
    bottom: (window.bottom * sourceHeight - extraTop) / sourceHeight * 100,
  });
  return normalizeImageEdit({ ...next, x: 0, y: 0, width: 1, height: 1, crop });
}

/** Rotate the placed image by the given amount of degrees. */
export function rotateImage(edit, degrees) {
  const next = normalizeImageEdit(edit);
  const rotation = (((Number(degrees) || 0) % 360) + 360) % 360;
  return { ...next, rotation };
}
export function flipImage(edit, axis) {
  const next = normalizeImageEdit(edit);
  if (axis === "horizontal") return { ...next, flipHorizontal: !next.flipHorizontal };
  if (axis === "vertical") return { ...next, flipVertical: !next.flipVertical };
  return next;
}
export function skewImage(edit, degrees) {
  const next = normalizeImageEdit(edit);
  const skew = Math.max(-60, Math.min(60, Number(degrees) || 0));
  return { ...next, skew };
}
/** Remove rotation, flips and skew, keeping size and position. */
export function resetImageTransform(edit) {
  const next = normalizeImageEdit(edit);
  return { ...next, rotation: 0, skew: 0, flipHorizontal: false, flipVertical: false };
}
/** Straighten: drop the skew and the tilt. */
export function straightenImage(edit) {
  const next = normalizeImageEdit(edit);
  return { ...next, rotation: 0, skew: 0 };
}
/** A copy of the image placed next to the original. The copy is a new placement,
 * so it never covers the source artwork the original edit still hides. */
export function duplicateImage(edit, key) {
  const next = normalizeImageEdit(edit);
  const offset = 0.02;
  const x = Math.min(1 - next.width, next.x + offset);
  const y = Math.min(1 - next.height, next.y + offset);
  return {
    ...next,
    key: key || next.key,
    x,
    y,
    isNew: true,
    deleted: false,
    original: undefined,
    originalQuad: undefined,
  };
}
