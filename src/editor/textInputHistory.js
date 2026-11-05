const signature = edit => JSON.stringify([edit.value, edit.styleRanges, edit.fontFamily, edit.fontSize, edit.fontWeight, edit.fontStyle, edit.color, edit.alignment, edit.letterSpacing, edit.letterSpacingPt])

export function createTextInputHistory(edit) {
  return { past: [], present: edit, future: [] }
}

export function recordTextInput(history, edit) {
  if (signature(history.present) === signature(edit)) return { ...history, present: edit }
  return { past: [...history.past.slice(-99), history.present], present: edit, future: [] }
}

export function restoreTextInput(history, direction) {
  const from = direction === 'undo' ? history.past : history.future
  if (!from.length) return history
  return direction === 'undo'
    ? { past: from.slice(0, -1), present: from.at(-1), future: [...history.future, history.present] }
    : { past: [...history.past, history.present], present: from.at(-1), future: from.slice(0, -1) }
}
