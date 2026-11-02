import assert from 'node:assert/strict'
import { previewRasterSize, PAGE_PREVIEW_PIXELS, THUMBNAIL_PREVIEW_PIXELS } from '../src/editor/renderBudget.js'
for (const [width, height] of [[612, 792], [4896, 6336], [100000, 100000], [400, 12000]]) {
  for (const density of [1, 2, 3]) for (const thumbnail of [false, true]) {
    const raster = previewRasterSize(width, height, density, thumbnail)
    assert.ok(raster.width * raster.height <= (thumbnail ? THUMBNAIL_PREVIEW_PIXELS : PAGE_PREVIEW_PIXELS))
    assert.ok(raster.width > 0 && raster.height > 0)
    assert.ok(Math.abs(raster.width - width * raster.scale) < 1)
    assert.ok(Math.abs(raster.height - height * raster.scale) < 1)
  }
}
assert.equal(previewRasterSize(612, 792, 1).scale, 1)
console.log('PASS screen raster budgets at normal, high-DPI, high-zoom and oversized page dimensions')
