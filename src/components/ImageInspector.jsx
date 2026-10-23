import { useState, useEffect } from 'react'

const MAX_ROTATION = 180
const MAX_SKEW = 60
const MAX_CROP = 95

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const finite = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** Rotation shown as a signed angle in -180..180 so it fits the input range. */
const signedRotation = (degrees) => {
  const number = finite(degrees)
  return ((number + 180) % 360 + 360) % 360 - 180
}

/** A number input that keeps the typed text until the value is committed. */
function NumberField({ label, ariaLabel, value, min, max, step = 1, disabled = false, onCommit }) {
  const [draft, setDraft] = useState(() => String(value))

  useEffect(() => { setDraft(String(value)) }, [value])

  const commit = () => {
    if (String(draft).trim() === '') { setDraft(String(value)); return }
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) { setDraft(String(value)); return }
    const next = clamp(parsed, min, max)
    setDraft(String(next))
    if (next !== finite(value)) onCommit(next)
  }

  return (
    <label className="image-inspector-field">
      <span>{label}</span>
      <input
        type="number"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }}
      />
    </label>
  )
}

export function ImageInspector({
  image = null,
  page = 1,
  pageSize = { width: 612, height: 792 },
  busy = false,
  onChange = () => {},
  onAddImage = () => {},
  onReplaceImage = () => {},
  onDelete = () => {},
  onDuplicate = () => {},
  onCropChange = () => {},
  onResetCrop = () => {},
}) {
  const frameWidth = Math.max(1, finite(pageSize?.width, 612))
  const frameHeight = Math.max(1, finite(pageSize?.height, 792))

  if (!image) {
    return (
      <div className="image-inspector image-inspector-empty">
        <p className="image-inspector-empty-title">No image selected</p>
        <p className="image-inspector-note">Click an outlined image on the page to select it, then edit its size, position, rotation, and crop.</p>
        <button type="button" className="editor-open-button image-inspector-secondary-action" aria-label="Add a new image to the page" onClick={onAddImage} disabled={busy}>Add image</button>
      </div>
    )
  }

  const identity = `${image.key || 'image'}-${page}`
  const crop = { top: 0, right: 0, bottom: 0, left: 0, ...(image.crop || {}) }
  const rotation = signedRotation(image.rotation)
  const rotationRaw = finite(image.rotation)
  const skew = clamp(finite(image.skew), -MAX_SKEW, MAX_SKEW)
  const widthPoints = finite(image.width) * frameWidth
  const heightPoints = finite(image.height) * frameHeight
  const xPoints = finite(image.x) * frameWidth
  const yPoints = finite(image.y) * frameHeight

  const setCrop = (side, value) => onCropChange({ ...crop, [side]: clamp(finite(value), 0, MAX_CROP) })
  const handleReplacement = (event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    onReplaceImage(file)
  }

  return (
    <div className="image-inspector">
      <section className="image-inspector-section" aria-label="Image source">
        <h3>Source</h3>
        <div className="image-inspector-grid">
          <p className="image-inspector-note">Image on page {page}</p>
          <button type="button" className="editor-open-button" aria-label="Add image" onClick={onAddImage} disabled={busy}>Add image</button>
          <label className="image-replace-field">
            Replace image
            <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={busy} onChange={handleReplacement} />
          </label>
          <button type="button" className="editor-open-button" aria-label="Duplicate" onClick={onDuplicate} disabled={busy}>Duplicate</button>
          <button type="button" className="editor-open-button danger" aria-label="Delete image" onClick={onDelete} disabled={busy}>Delete</button>
        </div>
      </section>

      <section className="image-inspector-section" aria-label="Image transform">
        <h3>Transform</h3>
        <div className="image-inspector-grid">
          <button type="button" className="editor-open-button" aria-label="Rotate image left" onClick={() => onChange({ rotation: (rotationRaw - 90 + 360) % 360 })} disabled={busy}>Rotate left</button>
          <button type="button" className="editor-open-button" aria-label="Rotate image right" onClick={() => onChange({ rotation: (rotationRaw + 90) % 360 })} disabled={busy}>Rotate right</button>
          <NumberField
            key={`${identity}-rotation`}
            label="Rotation (°)"
            ariaLabel="Rotation angle in degrees"
            value={rotation}
            min={-MAX_ROTATION}
            max={MAX_ROTATION}
            step={1}
            disabled={busy}
            onCommit={(value) => onChange({ rotation: value })}
          />
          <button type="button" className="editor-open-button" aria-label="Flip image horizontally" onClick={() => onChange({ flipHorizontal: !image.flipHorizontal })} disabled={busy}>Flip horizontal</button>
          <button type="button" className="editor-open-button" aria-label="Flip image vertically" onClick={() => onChange({ flipVertical: !image.flipVertical })} disabled={busy}>Flip vertical</button>
          <NumberField
            key={`${identity}-skew`}
            label="Skew (°)"
            ariaLabel="Skew angle in degrees"
            value={skew}
            min={-MAX_SKEW}
            max={MAX_SKEW}
            step={1}
            disabled={busy}
            onCommit={(value) => onChange({ skew: value })}
          />
          <button type="button" className="editor-open-button" aria-label="Straighten image" onClick={() => onChange({ rotation: 0, skew: 0 })} disabled={busy}>Straighten</button>
          <button type="button" className="editor-open-button" aria-label="Reset image transform" onClick={() => onChange({ rotation: 0, skew: 0, flipHorizontal: false, flipVertical: false })} disabled={busy}>Reset transform</button>
        </div>
      </section>

      <section className="image-inspector-section" aria-label="Image size">
        <h3>Size</h3>
        <div className="image-inspector-grid">
          <NumberField
            key={`${identity}-width`}
            label="Width (pt)"
            ariaLabel="Image width in points"
            value={widthPoints}
            min={0}
            max={frameWidth}
            step={1}
            disabled={busy}
            onCommit={(value) => onChange({ width: value / frameWidth })}
          />
          <NumberField
            key={`${identity}-height`}
            label="Height (pt)"
            ariaLabel="Image height in points"
            value={heightPoints}
            min={0}
            max={frameHeight}
            step={1}
            disabled={busy}
            onCommit={(value) => onChange({ height: value / frameHeight })}
          />
          <label className="image-inspector-field">
            <span>Lock aspect ratio</span>
            <input type="checkbox" aria-label="Lock aspect ratio" checked={Boolean(image.aspectLocked)} disabled={busy} onChange={(event) => onChange({ aspectLocked: event.target.checked })} />
          </label>
          <button type="button" className="editor-open-button" aria-label="Fit image to page" onClick={() => onChange({ fitToPage: true })} disabled={busy}>Fit to page</button>
          <button type="button" className="editor-open-button" aria-label="Fill image to page" onClick={() => onChange({ fillToPage: true })} disabled={busy}>Fill page</button>
        </div>
      </section>

      <section className="image-inspector-section" aria-label="Image position">
        <h3>Position</h3>
        <div className="image-inspector-grid">
          <NumberField
            key={`${identity}-x`}
            label="X from left (pt)"
            ariaLabel="Image X position in points"
            value={xPoints}
            min={0}
            max={frameWidth}
            step={1}
            disabled={busy}
            onCommit={(value) => onChange({ x: value / frameWidth })}
          />
          <NumberField
            key={`${identity}-y`}
            label="Y from top (pt)"
            ariaLabel="Image Y position in points"
            value={yPoints}
            min={0}
            max={frameHeight}
            step={1}
            disabled={busy}
            onCommit={(value) => onChange({ y: value / frameHeight })}
          />
        </div>
      </section>

      <section className="image-inspector-section" aria-label="Image crop">
        <h3>Crop</h3>
        <div className="image-inspector-grid">
          {['top', 'right', 'bottom', 'left'].map((side) => (
            <label className="image-crop-field" key={`${identity}-crop-${side}`}>
              Crop {side} · {clamp(finite(crop[side]), 0, MAX_CROP)}%
              <input
                type="range"
                aria-label={`Crop ${side}`}
                min="0"
                max={MAX_CROP}
                step="1"
                value={clamp(finite(crop[side]), 0, MAX_CROP)}
                disabled={busy}
                onChange={(event) => setCrop(side, event.target.value)}
              />
            </label>
          ))}
          <button type="button" className="editor-open-button" aria-label="Reset image crop" onClick={onResetCrop} disabled={busy}>Reset crop</button>
        </div>
      </section>

      <p className="image-inspector-note">Moving or deleting an image covers the area it came from. Page content behind an image cannot be reconstructed automatically — use Redact for confidential content.</p>
    </div>
  )
}
