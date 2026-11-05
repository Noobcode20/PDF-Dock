import { useState, useEffect, useRef } from 'react'
import { Icon } from '../icons'
import { InspectorSection, InspectorAction } from './InspectorSection'

const MAX_ROTATION = 180
const MAX_SKEW = 60
const MAX_CROP = 95

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const displayNumber = value => String(Math.round(Number(value) * 100) / 100)

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
  const [draft, setDraft] = useState(() => displayNumber(value))

  useEffect(() => { setDraft(displayNumber(value)) }, [value])

  const commit = () => {
    if (String(draft).trim() === '') { setDraft(displayNumber(value)); return }
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) { setDraft(displayNumber(value)); return }
    const next = clamp(parsed, min, max)
    setDraft(String(next))
    if (Math.abs(next - finite(value)) > 0.005) onCommit(next)
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
  const replacementPicker = useRef(null)
  const frameWidth = Math.max(1, finite(pageSize?.width, 612))
  const frameHeight = Math.max(1, finite(pageSize?.height, 792))

  if (!image) {
    return (
      <div className="image-inspector property-inspector image-inspector-empty">
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
    <div className="image-inspector property-inspector">
      <InspectorSection title="Source" className="image-inspector-section">
        <div className="inspector-toolbar">
          <InspectorAction label="Add image" icon="plus" onClick={onAddImage} disabled={busy} />
          <InspectorAction label="Duplicate" icon="copy" onClick={onDuplicate} disabled={busy} />
          <InspectorAction label="Delete image" icon="trash" onClick={onDelete} disabled={busy} danger />
          <span className="inspector-toolbar-divider" />
          <button type="button" className="inspector-replace-action" disabled={busy} onClick={() => replacementPicker.current?.click()}><Icon name="upload" size={14} />Replace</button>
          <label className="image-replace-field inspector-hidden-file">Replace image<input ref={replacementPicker} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={busy} onChange={handleReplacement} /></label>
        </div>
        <p className="inspector-hint">Image on page {page}</p>
      </InspectorSection>

      <InspectorSection title="Transform" className="image-inspector-section">
        <div className="inspector-toolbar" aria-label="Image transform actions">
          <InspectorAction label="Rotate image left" icon="undo" onClick={() => onChange({ rotation: (rotationRaw - 90 + 360) % 360 })} disabled={busy} />
          <InspectorAction label="Rotate image right" icon="redo" onClick={() => onChange({ rotation: (rotationRaw + 90) % 360 })} disabled={busy} />
          <span className="inspector-toolbar-divider" />
          <InspectorAction label="Flip image horizontally" icon="flipHorizontal" pressed={Boolean(image.flipHorizontal)} onClick={() => onChange({ flipHorizontal: !image.flipHorizontal })} disabled={busy} />
          <InspectorAction label="Flip image vertically" icon="flipVertical" pressed={Boolean(image.flipVertical)} onClick={() => onChange({ flipVertical: !image.flipVertical })} disabled={busy} />
        </div>
        <div className="image-inspector-grid">
          <NumberField key={`${identity}-rotation`} label="Rotation (°)" ariaLabel="Rotation angle in degrees" value={rotation} min={-MAX_ROTATION} max={MAX_ROTATION} disabled={busy} onCommit={value => onChange({ rotation: value })} />
          <NumberField key={`${identity}-skew`} label="Skew (°)" ariaLabel="Skew angle in degrees" value={skew} min={-MAX_SKEW} max={MAX_SKEW} disabled={busy} onCommit={value => onChange({ skew: value })} />
        </div>
        <div className="inspector-toolbar">
          <button type="button" className="inspector-replace-action" aria-label="Straighten image" disabled={busy} onClick={() => onChange({ rotation: 0, skew: 0 })}><Icon name="straighten" size={14} />Straighten</button>
          <InspectorAction label="Reset image transform" icon="rotate" disabled={busy} onClick={() => onChange({ rotation: 0, skew: 0, flipHorizontal: false, flipVertical: false })} />
        </div>
      </InspectorSection>

      <InspectorSection title="Size" className="image-inspector-section">
        <div className="image-inspector-grid">
          <NumberField
            key={`${identity}-width`}
            label="Width (pt)"
            ariaLabel="Image width in points"
            value={widthPoints}
            min={frameWidth * 0.01}
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
            min={frameHeight * 0.01}
            max={frameHeight}
            step={1}
            disabled={busy}
            onCommit={(value) => onChange({ height: value / frameHeight })}
          />
          <label className="image-aspect-row">
            <span>Lock aspect ratio</span>
            <input type="checkbox" aria-label="Lock aspect ratio" checked={Boolean(image.aspectLocked)} disabled={busy} onChange={(event) => onChange({ aspectLocked: event.target.checked })} />
          </label>
          <button type="button" className="inspector-replace-action" aria-label="Fit image to page" title="Fit image to page" onClick={() => onChange({ fitToPage: true })} disabled={busy}><Icon name="compress" size={14} />Fit to page</button>
          <button type="button" className="inspector-replace-action" aria-label="Fill image to page" title="Fill image to page" onClick={() => onChange({ fillToPage: true })} disabled={busy}><Icon name="expand" size={14} />Fill page</button>
        </div>
      </InspectorSection>

      <InspectorSection title="Position" className="image-inspector-section">
        <div className="image-inspector-grid">
          <NumberField
            key={`${identity}-x`}
            label="X (pt)"
            ariaLabel="Image X position in points"
            value={xPoints}
            min={0}
            max={Math.max(0, frameWidth - widthPoints)}
            step={1}
            disabled={busy}
            onCommit={(value) => onChange({ x: value / frameWidth })}
          />
          <NumberField
            key={`${identity}-y`}
            label="Y (pt)"
            ariaLabel="Image Y position in points"
            value={yPoints}
            min={0}
            max={Math.max(0, frameHeight - heightPoints)}
            step={1}
            disabled={busy}
            onCommit={(value) => onChange({ y: value / frameHeight })}
          />
        </div>
      </InspectorSection>

      <InspectorSection title="Crop" className="image-inspector-section" defaultOpen={false}>
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
      </InspectorSection>

      <p className="image-inspector-note">Moving or deleting an image covers the area it came from. Page content behind an image cannot be reconstructed automatically — use Redact for confidential content.</p>
    </div>
  )
}
