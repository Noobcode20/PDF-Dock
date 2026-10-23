/** Display coordinates are normalized to the visible crop box, after page rotation.
 * Matrices map an upright, bottom-left display frame to absolute PDF user space. */
export function displayFrame(page, extraRotation = 0) {
  const b = page.getCropBox(),
    r = (((page.getRotation().angle + extraRotation) % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(r))
    throw new Error("Page rotation must be a multiple of 90 degrees.");
  const matrices = {
    0: [1, 0, 0, 1, b.x, b.y],
    90: [0, 1, -1, 0, b.x + b.width, b.y],
    180: [-1, 0, 0, -1, b.x + b.width, b.y + b.height],
    270: [0, -1, 1, 0, b.x, b.y + b.height],
  };
  return {
    width: r % 180 ? b.height : b.width,
    height: r % 180 ? b.width : b.height,
    matrix: matrices[r],
  };
}
export function transformPoint(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}
export function inversePoint(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix,
    determinant = a * d - b * c;
  return [
    (d * (x - e) - c * (y - f)) / determinant,
    (-b * (x - e) + a * (y - f)) / determinant,
  ];
}
export function displayRect(frame, rect) {
  const values = ["x", "y", "width", "height"].map((k) => Number(rect[k]));
  if (!values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0)
    throw new Error("Invalid edit bounds.");
  return {
    x: values[0] * frame.width,
    y: (1 - values[1] - values[3]) * frame.height,
    width: values[2] * frame.width,
    height: values[3] * frame.height,
  };
}
export function pdfRect(frame, rect) {
  const b = displayRect(frame, rect),
    p = transformPoint(frame.matrix, b.x, b.y),
    q = transformPoint(frame.matrix, b.x + b.width, b.y + b.height);
  return {
    x: Math.min(p[0], q[0]),
    y: Math.min(p[1], q[1]),
    width: Math.abs(p[0] - q[0]),
    height: Math.abs(p[1] - q[1]),
  };
}
/** Upright text-box frame mapped into the displayed page, preserving the
 * source run's clockwise display rotation without scattering angle offsets. */
export function textFrame(box, rotation = 0) {
  const r = ((Math.round(rotation) % 360) + 360) % 360;
  if (r === 90)
    return {
      width: box.height,
      height: box.width,
      matrix: [0, -1, 1, 0, box.x, box.y + box.height],
    };
  if (r === 180)
    return {
      width: box.width,
      height: box.height,
      matrix: [-1, 0, 0, -1, box.x + box.width, box.y + box.height],
    };
  if (r === 270)
    return {
      width: box.height,
      height: box.width,
      matrix: [0, 1, -1, 0, box.x + box.width, box.y],
    };
  return {
    width: box.width,
    height: box.height,
    matrix: [1, 0, 0, 1, box.x, box.y],
  };
}

/** DOM coordinates always normalize against the page, never the scroll frame.
 * DPR is confined to canvas backing pixels and never enters operation bounds. */
export function normalizedPoint(bounds, clientX, clientY) {
  if (!(bounds.width > 0 && bounds.height > 0)) throw new Error('Page bounds are unavailable.');
  return [Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
    Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height))];
}
export function regionFromPoints(start, end) {
  return {x: Math.min(start[0], end[0]), y: Math.min(start[1], end[1]),
    width: Math.abs(end[0] - start[0]), height: Math.abs(end[1] - start[1])};
}
export function gestureRegion(region, dx, dy, resize = false) {
  if (resize) return {...region, width: Math.max(.005, Math.min(1-region.x, region.width+dx)), height: Math.max(.005, Math.min(1-region.y, region.height+dy))};
  return {...region, x: Math.max(0, Math.min(1-region.width, region.x+dx)), y: Math.max(0, Math.min(1-region.height, region.y+dy))};
}
/** Image unit space -> upright display points.
 * The placement lives in src/editor/imageModel.js so the on-screen preview and
 * the PDF writer always agree on the same affine transform. */
export { imagePlacement, imagePlacementMatrix, imageCorners } from "./imageModel.js";

export function reframeRegion(page, region, toRotation=0) {
 const from=displayFrame(page,Number(region.viewerRotation)||0),to=displayFrame(page,toRotation),box=displayRect(from,region);
 const points=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(p=>inversePoint(to.matrix,...transformPoint(from.matrix,...p)));
 const left=Math.min(...points.map(p=>p[0])),right=Math.max(...points.map(p=>p[0])),bottom=Math.min(...points.map(p=>p[1])),top=Math.max(...points.map(p=>p[1]));
 return {...region,x:left/to.width,y:1-top/to.height,width:(right-left)/to.width,height:(top-bottom)/to.height,viewerRotation:toRotation};
}
