import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../icons'
import { tabbable } from 'tabbable'

const THEME_PROPERTIES = ['--bg', '--panel', '--panel-hover', '--border', '--text', '--text-dim', '--muted', '--accent', '--accent-soft', '--accent-border', '--accent-contrast', '--focus-ring']

export function ThemedSelect({ value, options = [], onChange, className = '', style, ariaLabel, disabled = false, id }) {
  const generatedId = useId()
  const triggerId = id || `${generatedId}-trigger`
  const listId = `${id || generatedId}-options`
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [menuPosition, setMenuPosition] = useState(null)
  const [themeStyle, setThemeStyle] = useState({})
  const stringValue = value == null ? '' : String(value)
  const selectedIndex = options.findIndex((option) => String(option.value) === stringValue)
  const safeSelectedIndex = selectedIndex >= 0 ? selectedIndex : 0
  const selectedOption = options[safeSelectedIndex]

  const close = (restoreFocus = true) => {
    setOpen(false)
    setMenuPosition(null)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const showMenu = (index = safeSelectedIndex) => {
    if (disabled || !options.length) return
    setActiveIndex(Math.max(0, Math.min(index, options.length - 1)))
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const availableWidth = Math.max(rect.width, 176)
    const width = Math.min(availableWidth, window.innerWidth - 16)
    const maxHeight = Math.min(300, Math.max(120, options.length * 36 + 8))
    const below = window.innerHeight - rect.bottom - 8
    const top = below >= Math.min(maxHeight, 180)
      ? rect.bottom + 4
      : Math.max(8, rect.top - Math.min(maxHeight, rect.top - 8) - 4)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    const computed = getComputedStyle(trigger)
    const vars = Object.fromEntries(THEME_PROPERTIES.map((property) => [property, computed.getPropertyValue(property).trim()]))
    setThemeStyle({ ...vars, fontFamily: computed.fontFamily })
    setMenuPosition({ top, left, width, maxHeight })
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return undefined
    menuRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.focus()
    return undefined
  }, [open, activeIndex])

  useEffect(() => {
    if (!open) return undefined
    const dismiss = (event) => {
      if (event.type === 'keydown') {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
        return
      }
      if (rootRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return
      close(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    const dismissOnFocus = (event) => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) close(false)
    }
    document.addEventListener('focusin', dismissOnFocus, true)
    window.addEventListener('keydown', dismiss, true)
    const reposition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const width = Math.min(Math.max(rect.width, 176), window.innerWidth - 16)
      const maxHeight = Math.min(300, Math.max(120, options.length * 36 + 8))
      const below = window.innerHeight - rect.bottom - 8
      const top = below >= Math.min(maxHeight, 180) ? rect.bottom + 4 : Math.max(8, rect.top - Math.min(maxHeight, rect.top - 8) - 4)
      setMenuPosition({ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width, maxHeight })
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('focusin', dismissOnFocus, true)
      window.removeEventListener('keydown', dismiss, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, options.length])

  const commit = (option) => {
    onChange?.({ target: { value: String(option.value) } })
    close()
  }

  const moveActive = (offset) => setActiveIndex((index) => (index + offset + options.length) % options.length)
  const onTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      showMenu(event.key === 'ArrowUp' ? options.length - 1 : safeSelectedIndex)
    }
  }
  const onOptionKeyDown = (event) => {
    if (event.key === 'Tab') {
      const trigger = triggerRef.current
      const dialog = trigger?.closest('[role="dialog"], [role="alertdialog"]')
      const scope = dialog || document.body
      const controls = tabbable(scope).filter(node => !menuRef.current?.contains(node))
      const index = controls.indexOf(trigger)
      let nextIndex = index + (event.shiftKey ? -1 : 1)
      if (dialog && controls.length) nextIndex = (nextIndex + controls.length) % controls.length
      const next = index >= 0 ? controls[nextIndex] : null
      close(false)
      if (next) { event.preventDefault(); next.focus() }
      else trigger?.focus()
    }
    else if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1) }
    else if (event.key === 'Home') { event.preventDefault(); setActiveIndex(0) }
    else if (event.key === 'End') { event.preventDefault(); setActiveIndex(options.length - 1) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (options[activeIndex]) commit(options[activeIndex]) }
  }

  return <>
    <span className="themed-select-host" ref={rootRef}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`themed-select-trigger ${className}`.trim()}
        style={style}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => open ? close(false) : showMenu()}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="themed-select-value">{selectedOption?.label ?? ''}</span>
        <Icon name="chevron" size={13} className={`themed-select-chevron ${open ? 'is-open' : ''}`} />
      </button>
    </span>
    {open && menuPosition && createPortal(<div
      ref={menuRef}
      data-select-trigger={triggerId}
      id={listId}
      className="themed-select-menu"
      role="listbox"
      aria-label={ariaLabel}
      style={{ ...themeStyle, top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
      onKeyDown={onOptionKeyDown}
    >
      {options.map((option, index) => <button
        key={`${option.value}-${index}`}
        id={`${listId}-${index}`}
        data-option-index={index}
        type="button"
        role="option"
        aria-selected={index === safeSelectedIndex}
        tabIndex={index === activeIndex ? 0 : -1}
        className={`themed-select-option ${index === safeSelectedIndex ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => commit(option)}
      >
        <span>{option.label}</span>
        {index === safeSelectedIndex && <Icon name="check" size={14} />}
      </button>)}
    </div>, document.body)}
  </>
}
