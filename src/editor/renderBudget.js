// Screen previews have a bounded backing store. Export rendering uses its own DPI.
export const PAGE_PREVIEW_PIXELS = 3_000_000
export const THUMBNAIL_PREVIEW_PIXELS = 160_000
export function previewRasterSize(width, height, devicePixelRatio = 1, thumbnail = false) {
  const budget = thumbnail ? THUMBNAIL_PREVIEW_PIXELS : PAGE_PREVIEW_PIXELS
  const density = thumbnail ? 1 : Math.min(1.5, Math.max(1, Number(devicePixelRatio) || 1))
  const scale = Math.min(density, Math.sqrt(budget / Math.max(1, width * height)))
  // Floor each dimension so rounding cannot breach the pixel budget.
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale }
}
