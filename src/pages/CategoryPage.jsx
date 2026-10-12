import React from 'react'
import { ToolCard } from '../components/ToolCard'
import { categories, allTools } from '../toolsData'
import { Icon } from '../icons'

export function CategoryPage({ categoryId, onNavigate, onSelectTool }) {
  const category = categories.find((c) => c.id === categoryId) || categories[0]

  // Get tools for this category
  let categoryTools = allTools.filter((t) => t.category === categoryId)

  const tools = categoryTools
  const isOrganize = categoryId === 'organize'

  return (
    <div className={`page-content category-view ${isOrganize ? 'organize-category-view' : ''}`}>
      {isOrganize ? <header className="organize-category-hero">
        <div className="organize-category-copy"><span className="organize-eyebrow">PDF WORKSPACE / ORGANIZE</span><h1>Shape your document.</h1><p>Bring pages together, set their order, and remove what you don’t need. Every change stays local until you export.</p></div>
        <div className="organize-category-summary"><span className="organize-category-glyph"><Icon name="pages" size={22} /></span><strong>{tools.length}</strong><span>page tools</span><i /></div>
      </header> : <div className="category-header"><h1>{category.label}</h1><p className="category-desc">{category.description}</p></div>}

      <div className="category-tool-grid">
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} onClick={() => onSelectTool(tool)} />
        ))}
      </div>

    </div>
  )
}
