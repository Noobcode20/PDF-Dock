import React, { useEffect, useRef } from 'react'
import { Icon } from '../icons'

export function WorkspaceContextMenu({ menu, onClose, onAction }) {
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menu) return undefined
    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return
      if (event.type === 'pointerdown' && menuRef.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', dismiss)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', dismiss) }
  }, [menu, onClose])
  if (!menu) return null
  return <div ref={menuRef} className="workspace-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
    {menu.items.map((item, index) => item.separator
      ? <div className="workspace-context-separator" role="separator" key={`sep-${index}`} />
      : <button type="button" role="menuitem" key={item.id} onClick={() => onAction(item)}>
        {item.icon && <Icon name={item.icon} size={15} />}<span>{item.label}</span>
        {item.shortcut && <small>{item.shortcut}</small>}
      </button>)}
  </div>
}
