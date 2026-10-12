import React, { useLayoutEffect, useEffect, useRef } from 'react'
import { rebaseTextStyleRanges, textStyleAt } from './textStyles.js'

export function readTextSelection(root) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null
  const range = selection.getRangeAt(0), prefix = range.cloneRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(range.startContainer, range.startOffset)
  const start = prefix.toString().length
  return { selectionStart: start, selectionEnd: start + range.toString().length }
}
function restoreSelection(root, start, end) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes = []; let node
  while ((node = walker.nextNode())) nodes.push(node)
  if (!nodes.length) { root.append(document.createTextNode('')); nodes.push(root.firstChild) }
  const point = offset => {
    for (const node of nodes) {
      if (offset <= node.length) return [node, offset]
      offset -= node.length
    }
    return [nodes.at(-1), nodes.at(-1).length]
  }
  const range = document.createRange()
  range.setStart(...point(start)); range.setEnd(...point(end))
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range)
}

export const RichTextInput = React.forwardRef(function RichTextInput({ edit, preserveSourceLayout, displayWidth, displayHeight, pageHeight, onEdit, onFit, onSelection, onKeyDown, ...props }, forwardedRef) {
  const root = useRef(null), composing = useRef(false), latest = useRef({ edit, onEdit, onSelection })
  latest.current = { edit, onEdit, onFit, onSelection }
  const select = () => {
    const selection = readTextSelection(root.current)
    if (selection) latest.current.onSelection(selection)
  }
  useEffect(() => {
    document.addEventListener('selectionchange', select)
    root.current.focus()
    return () => document.removeEventListener('selectionchange', select)
  }, [])
  useLayoutEffect(() => {
    const element = root.current
    const measure = () => {
      if (!element || composing.current) return
      let left = 0, top = 0, width = element.clientWidth, height = element.scrollHeight
      if (preserveSourceLayout) {
        // offset sizes omit scaleX; use each run's actual rendered bounds.
        const bounds = element.getBoundingClientRect()
        for (const span of element.children) {
          const rect = span.getBoundingClientRect()
          left = Math.min(left, rect.left - bounds.left)
          top = Math.min(top, rect.top - bounds.top)
          width = Math.max(width, rect.right - bounds.left)
          height = Math.max(height, rect.bottom - bounds.top)
        }
      } else if (getComputedStyle(element).whiteSpace === 'pre') width = Math.max(width, element.scrollWidth)
      latest.current.onFit?.({ left, top, width: Math.ceil(width), height: Math.ceil(height) + (height > element.clientHeight ? 2 : 0) })
    }
    // Measure after the run DOM is installed, and again after embedded PDF
    // fonts load. Selection and font formatting are left intact.
    const frame = requestAnimationFrame(measure)
    document.fonts?.addEventListener('loadingdone', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.fonts?.removeEventListener('loadingdone', measure) }
  }, [edit, preserveSourceLayout, displayWidth, displayHeight])
  useLayoutEffect(() => {
    if (composing.current) return
    const element = root.current, focused = document.activeElement === element
    const selection = readTextSelection(element) || { selectionStart: edit.selectionStart || 0, selectionEnd: edit.selectionEnd || 0 }
    const fragment = document.createDocumentFragment()
    const context = document.createElement('canvas').getContext('2d')
    if (preserveSourceLayout) {
      let offset = 0
      for (const run of edit.sourceLayout) {
        if (run.start > offset) fragment.append(document.createTextNode(edit.value.slice(offset, run.start)))
        const span = document.createElement('span'), style = run.style
        span.textContent = edit.value.slice(run.start, run.end)
        const size = style.fontSize / pageHeight * displayHeight
        const family = style.previewFontFamily || style.fontFamily
        context.font = `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${size}px ${family}`
        const metrics = context.measureText(span.textContent)
        const ascent = metrics.fontBoundingBoxAscent ?? size * .8
        const descent = metrics.fontBoundingBoxDescent ?? size * .2
        const top = run.baseline == null ? (run.top - edit.y) * displayHeight : (run.baseline - edit.y) * displayHeight - ascent
        Object.assign(span.style, { position: 'absolute', left: `${(run.x - edit.x) * displayWidth}px`, top: `${top}px`, fontFamily: family, fontWeight: style.fontWeight, fontStyle: style.fontStyle, color: 'transparent', caretColor: style.color || edit.color, fontSize: `${size}px`, lineHeight: `${ascent + descent}px`, whiteSpace: 'pre', transformOrigin: '0 0', transform: `scaleX(${metrics.width > 0 ? run.width * displayWidth / metrics.width : 1})` })
        fragment.append(span)
        offset = run.end
      }
      if (offset < edit.value.length) fragment.append(document.createTextNode(edit.value.slice(offset)))
    } else {
      const boundaries = [...new Set([0, edit.value.length, ...(edit.styleRanges || []).flatMap(r => [r.start, r.end])])].filter(n => n >= 0 && n <= edit.value.length).sort((a,b) => a-b)
      for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i], end = boundaries[i+1], style = textStyleAt(edit.styleRanges, start, edit)
        const span = document.createElement('span')
        span.textContent = edit.value.slice(start, end)
        const letterSpacingVal = style.letterSpacing != null
          ? (typeof style.letterSpacing === "number" ? `${style.letterSpacing}px` : style.letterSpacing)
          : edit.letterSpacingPt != null
          ? `${edit.letterSpacingPt * displayHeight / pageHeight}px`
          : edit.letterSpacing != null
          ? (typeof edit.letterSpacing === "number" ? `${edit.letterSpacing}px` : edit.letterSpacing)
          : "inherit"
        Object.assign(span.style, {
          fontFamily: style.previewFontFamily || style.fontFamily,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          color: style.color,
          backgroundColor: "transparent",
          fontSize: `${Math.max(.1, (style.fontSize ? style.fontSize / pageHeight : style.fontScale) * displayHeight)}px`,
          letterSpacing: letterSpacingVal,
        })
        fragment.append(span)
      }
    }
    element.replaceChildren(fragment)
    if (focused) restoreSelection(element, selection.selectionStart, selection.selectionEnd)
  }, [edit.value, edit.styleRanges, edit.fontFamily, edit.previewFontFamily, edit.fontWeight, edit.fontStyle, edit.color, edit.fontSize, edit.letterSpacing, edit.letterSpacingPt, edit.x, edit.y, edit.sourceLayout, preserveSourceLayout, displayWidth, displayHeight, pageHeight])
  const input = () => {
    const { edit, onEdit } = latest.current
    const value = root.current.textContent || '', selection = readTextSelection(root.current) || {}
    onEdit({ ...edit, value, ...(value !== edit.oldText ? { sourceLineCount: 0, sourceLayout: [] } : {}), styleRanges: rebaseTextStyleRanges(edit.styleRanges, edit.value, value, edit.typingStyle), ...selection })
  }
  return <div {...props} ref={element => { root.current = element; if (typeof forwardedRef === 'function') forwardedRef(element); else if (forwardedRef) forwardedRef.current = element }} role="textbox" aria-multiline="true" contentEditable suppressContentEditableWarning onFocus={() => { const current = latest.current.edit; if (current.selectionStart != null) restoreSelection(root.current, current.selectionStart, current.selectionEnd ?? current.selectionStart) }} onInput={input} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false; input() }} onPaste={event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')) }} onKeyDown={event => {
    onKeyDown?.(event)
    if (!event.defaultPrevented && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); document.execCommand('insertText', false, '\n') }
  }} />
})
