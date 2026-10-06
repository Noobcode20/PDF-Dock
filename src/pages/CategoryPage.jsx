import React, { useState } from 'react'
import { ToolCard } from '../components/ToolCard'
import { categories, allTools } from '../toolsData'

export function CategoryPage({ categoryId, onNavigate, onSelectTool }) {
  const category = categories.find((c) => c.id === categoryId) || categories[0]

  // Get tools for this category
  let categoryTools = allTools.filter((t) => t.category === categoryId)

  const tools = categoryTools

  return (
    <div className="page-content category-view">
      <div className="category-header">
        <h1>{category.label}</h1>
        <p className="category-desc">{category.description}</p>
      </div>

      <div className="category-tool-grid">
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} onClick={() => onSelectTool(tool)} />
        ))}
      </div>

    </div>
  )
}
