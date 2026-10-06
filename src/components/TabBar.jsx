import React from 'react'
import { Icon } from '../icons'

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab, getTitle }) {
  return (
    <div className="tabs-bar">
      <div className="tabs-list" role="tablist" aria-label="Workspace tabs">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          return (
            <div className={`workspace-tab ${active ? 'active' : ''}`} role="presentation" key={tab.id}>
              <button
                className="tab-select"
                type="button"
                role="tab"
                id={`workspace-tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`workspace-panel-${tab.id}`}
                onClick={() => onSelectTab(tab)}
                title={getTitle(tab.view)}
              >
                <span>{getTitle(tab.view)}</span>
              </button>
              {tabs.length > 1 && (
                <button
                  className="tab-close"
                  type="button"
                  onClick={() => onCloseTab(tab.id)}
                  aria-label={`Close ${getTitle(tab.view)} tab`}
                  title="Close tab"
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button className="new-tab-button" type="button" onClick={onNewTab} aria-label="New tab" title="New tab">
        <Icon name="plus" size={15} />
      </button>
    </div>
  )
}
