import React from 'react'
import { Icon } from '../icons'

export function InspectorSection({ title, children, defaultOpen = true, className = '' }) {
  return <details className={`inspector-section ${className}`} open={defaultOpen}>
    <summary><span>{title}</span><Icon name="chevron" size={12} /></summary>
    <div className="inspector-section-body">{children}</div>
  </details>
}

export function InspectorAction({ label, icon, onClick, disabled, pressed, danger = false }) {
  return <button className={`inspector-icon-action${danger ? ' is-danger' : ''}`} type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onClick}><Icon name={icon} size={16} /></button>
}
