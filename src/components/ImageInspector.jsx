import { useState, useEffect } from 'react'
import { Icon } from '../icons'

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
        <button type="button" className="editor-open-button image-inspector-secondary-action" aria-label="Add a new image to the page" onClick={onAddImage} disabled={busy}><Icon name="plus" size={16} />Add image</button>
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
      <details className="image-inspector-section" aria-label="Image source" open>
        <summary><span>Source</span><small>Manage image</small></summary>
        <div className="image-inspector-grid">
          <p className="image-inspector-note">Image on page {page}</p>
          <button type="button" className="editor-open-button" aria-label="Add image" title="Add image" onClick={onAddImage} disabled={busy}><Icon name="plus" size={16} /></button>
          <label className="image-replace-field">
            Replace image
            <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={busy} onChange={handleReplacement} />
          </label>
          <button type="button" className="editor-open-button" aria-label="Duplicate" title="Duplicate" onClick={onDuplicate} disabled={busy}><Icon name="copy" size={16} /></button>
          <button type="button" className="editor-open-button danger" aria-label="Delete image" title="Delete image" onClick={onDelete} disabled={busy}><Icon name="trash" size={16} /></button>
        </div>
      </details>

      <details className="image-inspector-section" aria-label="Image transform" open>
        <summary><span>Transform</span><small>Rotate · flip · skew</small></summary>
        <div className="image-inspector-grid">
          <button type="button" className="editor-open-button" aria-label="Rotate image left" title="Rotate image left" onClick={() => onChange({ rotation: (rotationRaw - 90 + 360) % 360 })} disabled={busy}><Icon name="undo" size={16} /></button>
          <button type="button" className="editor-open-button" aria-label="Rotate image right" title="Rotate image right" onClick={() => onChange({ rotation: (rotationRaw + 90) % 360 })} disabled={busy}><Icon name="redo" size={16} /></button>
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
          <button type="button" className="editor-open-button" aria-pressed={Boolean(image.flipHorizontal)} aria-label="Flip image horizontally" title="Flip image horizontally" onClick={() => onChange({ flipHorizontal: !image.flipHorizontal })} disabled={busy}><Icon name="flipHorizontal" size={16} /></button>
          <button type="button" className="editor-open-button" aria-pressed={Boolean(image.flipVertical)} aria-label="Flip image vertically" title="Flip image vertically" onClick={() => onChange({ flipVertical: !image.flipVertical })} disabled={busy}><Icon name="flipVertical" size={16} /></button>
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
          <button type="button" className="editor-open-button" aria-label="Straighten image" title="Straighten image" onClick={() => onChange({ rotation: 0, skew: 0 })} disabled={busy}><Icon name="straighten" size={16} /></button>
          <button type="button" className="editor-open-button" aria-label="Reset image transform" title="Reset image transform" onClick={() => onChange({ rotation: 0, skew: 0, flipHorizontal: false, flipVertical: false })} disabled={busy}><Icon name="rotate" size={16} /></button>
        </div>
      </details>

      <details className="image-inspector-section" aria-label="Image size">
        <summary><span>Size</span><small>Dimensions and fit</small></summary>
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
          <button type="button" className="editor-open-button" aria-label="Fit image to page" title="Fit image to page" onClick={() => onChange({ fitToPage: true })} disabled={busy}><Icon name="compress" size={16} /></button>
          <button type="button" className="editor-open-button" aria-label="Fill image to page" title="Fill image to page" onClick={() => onChange({ fillToPage: true })} disabled={busy}><Icon name="expand" size={16} /></button>
        </div>
      </details>

      <details className="image-inspector-section" aria-label="Image position">
        <summary><span>Position</span><small>Placement on page</small></summary>
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
      </details>

      <details className="image-inspector-section" aria-label="Image crop">
        <summary><span>Crop</span><small>Trim edges</small></summary>
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
          <button type="button" className="editor-open-button" aria-label="Reset image crop" title="Reset image crop" onClick={onResetCrop} disabled={busy}><Icon name="rotate" size={16} /></button>
        </div>
      </details>

      <p className="image-inspector-note">Moving or deleting an image covers the area it came from. Page content behind an image cannot be reconstructed automatically — use Redact for confidential content.</p>
    </div>
  )
}
