import React from 'react'
import { Icon } from '../icons'

export function ToolCard({ tool, onClick }) {
  return (
    <button
      className="tool-card"
      type="button"
      onClick={() => onClick && onClick(tool)}
      aria-label={`${tool.name}: ${tool.description}`}
    >
      <span className={`tool-icon ${tool.tone}`}>
        <Icon name={tool.icon} size={21} />
      </span>
      <span className="tool-copy">
        <strong>{tool.name}</strong>
        <small>{tool.description}</small>
      </span>
      <Icon name="arrow" size={16} className="card-arrow" />
    </button>
  )
}
