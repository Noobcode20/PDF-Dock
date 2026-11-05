import React from 'react'
import { FontSizeInput } from './FontSizeInput'
import { ThemedSelect } from './ThemedSelect'
import { InspectorSection, InspectorAction } from './InspectorSection'

export function TextInspector({ style, setStyle, fonts, localFonts, onFontChange, isAdding }) {
  const update = patch => setStyle(current => ({ ...current, ...patch }))
  const fontOptions = [...(!fonts.includes(style.fontFamily) && !style.localFontId ? [{ value: style.fontFamily, label: style.fontFamily }] : []), ...fonts.map(font => ({ value: font, label: font })), ...localFonts.map(font => ({ value: `local:${font.id}`, label: `${font.name} · local` }))]
  return <div className="property-inspector text-inspector">
    <InspectorSection title="Typography">
      <label className="inspector-field inspector-field-wide text-style-control"><span>Font family</span><ThemedSelect ariaLabel="Font family" value={style.localFontId ? `local:${style.localFontId}` : style.fontFamily} onChange={event => void onFontChange(event.target.value)} options={fontOptions} /></label>
      <div className="inspector-field-pair">
        <label className="inspector-field text-style-control"><span>Weight</span><ThemedSelect ariaLabel="Font weight" value={style.bold ? '700' : '400'} onChange={event => update({ bold: event.target.value === '700' })} options={[{ value: '400', label: 'Regular' }, { value: '700', label: 'Bold' }]} /></label>
        <label className="inspector-field text-style-control"><span>Size</span><FontSizeInput value={style.fontSize} onChange={fontSize => update({ fontSize })} /></label>
      </div>
      <div className="inspector-field-pair">
        <label className="inspector-field text-style-control"><span>Line height</span><ThemedSelect ariaLabel="Line height" value={style.lineHeight || 1.2} onChange={event => update({ lineHeight: Number(event.target.value) })} options={[1,1.15,1.2,1.5,2].map(value => ({ value, label: `${Math.round(value*100)}%` }))} /></label>
        <label className="inspector-field text-style-control"><span>Tracking</span><input aria-label="Letter spacing" type="number" min="-2" max="20" step="0.25" value={style.letterSpacingPt || 0} onChange={event => update({ letterSpacingPt: Number(event.target.value) })} /></label>
      </div>
      <div className="inspector-toolbar" aria-label="Text formatting">
        <button type="button" className="inspector-icon-action text-style-toggle" aria-label="Bold" title="Bold" aria-pressed={Boolean(style.bold)} onMouseDown={event => event.preventDefault()} onClick={() => update({ bold: !style.bold })}><b>B</b></button>
        <button type="button" className="inspector-icon-action text-style-toggle" aria-label="Italic" title="Italic" aria-pressed={Boolean(style.italic)} onMouseDown={event => event.preventDefault()} onClick={() => update({ italic: !style.italic })}><i>I</i></button>
        <span className="inspector-toolbar-divider" />
        {['left','center','right'].map(alignment => <InspectorAction key={alignment} label={`Align ${alignment}`} icon={`align${alignment[0].toUpperCase()+alignment.slice(1)}`} pressed={(style.alignment || 'left') === alignment} onClick={() => update({ alignment })} />)}
      </div>
    </InspectorSection>
    <InspectorSection title="Appearance">
      <label className="inspector-color-row text-style-control"><span>Text color</span><span className="inspector-color-value"><input aria-label="Text color" type="color" value={style.color} onChange={event => update({ color: event.target.value })} /><code>{style.color.toUpperCase()}</code></span></label>
      <label className="inspector-slider-row text-style-control"><span>Opacity</span><input aria-label="Text opacity" type="range" min="10" max="100" step="5" value={style.opacity ?? 100} onChange={event => update({ opacity: Number(event.target.value) })} /><output>{style.opacity ?? 100}%</output></label>
    </InspectorSection>
    <InspectorSection title="Editing" defaultOpen={false}>
      <p className="inspector-hint">{isAdding ? 'Click the page to place text. Select the box to move, resize or delete it.' : 'Double-click text to edit. Drag the box or its handles to move and resize it.'}</p>
      <p className="inspector-hint">Use Redact to permanently remove confidential content. Complex text may use visual replacement.</p>
    </InspectorSection>
  </div>
}
