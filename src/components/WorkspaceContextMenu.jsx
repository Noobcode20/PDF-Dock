import React, { useEffect, useRef } from 'react'
import { Icon } from '../icons'
import { Presence } from './Presence'

export function WorkspaceContextMenu({ menu, onClose, onAction }) {
  const menuRef = useRef(null)
  const lastMenu = useRef(menu)
  if (menu) lastMenu.current = menu
  useEffect(() => {
    if (!menu) return undefined
    menuRef.current?.querySelector('[role="menuitem"]')?.focus()
    const dismiss = (event) => {
      if (event.type === 'keydown') {
        if (event.key === 'Escape') { onClose(); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])]
          const index = items.indexOf(document.activeElement)
          const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length
          event.preventDefault()
          items[next]?.focus()
          return
        }
        return
      }
      if (event.type === 'pointerdown' && menuRef.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', dismiss)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', dismiss) }
  }, [menu, onClose])
  const visibleMenu = menu || lastMenu.current
  return <Presence present={!!menu} exitDuration={120}><div ref={menuRef} className="workspace-context-menu" role="menu" style={{ left: visibleMenu?.x, top: visibleMenu?.y }}>
    {visibleMenu?.items.map((item, index) => item.separator
      ? <div className="workspace-context-separator" role="separator" key={`sep-${index}`} />
      : <button type="button" role="menuitem" key={item.id} autoFocus={index === visibleMenu.items.findIndex((menuItem) => !menuItem.separator)} onClick={() => onAction(item)}>
        {item.icon && <Icon name={item.icon} size={15} />}<span>{item.label}</span>
        {item.shortcut && <small>{item.shortcut}</small>}
      </button>)}
  </div></Presence>
}
