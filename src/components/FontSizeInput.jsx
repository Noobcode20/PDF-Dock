import React, { useEffect, useId, useState } from 'react'

export function FontSizeInput({ value, onChange }) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const valid = text => text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) >= 2 && Number(text) <= 144
  return <><input aria-label="Font size" type="number" min="2" max="144" step="any" list={id} value={draft} onChange={event => {
    const next = event.target.value
    setDraft(next)
    if (valid(next)) onChange(Number(next))
  }} onBlur={() => { if (!valid(draft)) setDraft(String(value)) }} onKeyDown={event => {
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur() }
  }} /><datalist id={id}>{[8, 10, 12, 14, 16, 18, 24, 32, 48].map(size => <option key={size} value={size}>{size} pt</option>)}</datalist></>
}
