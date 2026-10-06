import React from 'react'
import { Icon } from '../icons'
import { categories } from '../toolsData'

export function Sidebar({ currentView, onNavigate, onOpenNewDocument, collapsed, userName = 'User', userAvatar }) {
  const isNavActive = (id) => currentView.type === id

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Main sidebar">
      <div
        className="brand-row clickable"
        onClick={() => onNavigate({ type: 'home' })}
        role="button"
        tabIndex={0}
      >
        <div className="brand-mark">
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="brand-name">
          PDF <span>King</span>
        </span>
      </div>

      <button
        className="new-document"
        type="button"
        onClick={onOpenNewDocument}
      >
        <span className="new-document-icon">
          <Icon name="plus" size={18} />
        </span>
        <span className="new-document-label">New document</span>
      </button>

      <div className="side-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Workspace navigation">
        <button
          className={`nav-item ${isNavActive('home') ? 'active' : ''}`}
          type="button"
          onClick={() => onNavigate({ type: 'home' })}
        >
          <Icon name="home" size={18} />
          <span>Home</span>
        </button>

        {categories.map((cat) => {
          const active = currentView.type === 'category' && currentView.categoryId === cat.id
          return (
            <button
              className={`nav-item ${active ? 'active' : ''}`}
              key={cat.id}
              type="button"
              onClick={() => onNavigate({ type: 'category', categoryId: cat.id })}
            >
              <Icon name={cat.icon} size={18} />
              <span>{cat.label}</span>
              {cat.id === 'popular' && <span className="nav-count">{cat.count}</span>}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-bottom">
        <button
          className={`profile-button ${currentView.type === 'settings' ? 'active-profile' : ''}`}
          type="button"
          onClick={() => onNavigate({ type: 'settings' })}
        >
          {userAvatar ? (
            <img className="profile-avatar" src={userAvatar} alt={userName} />
          ) : (
            <span className="profile-avatar">U</span>
          )}
          <span className="profile-copy">
            <strong>{userName}</strong>
          </span>
          <Icon name="chevron" size={15} className="profile-chevron" />
        </button>
      </div>
    </aside>
  )
}
