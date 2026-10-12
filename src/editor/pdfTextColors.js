// PDF.js's selection layer is transparent and does not expose paint colors.
// Match its text items to the glyph stream while tracking PDF fill state.
export function extractTextColorStyles(operatorList, ops, items) {
  let fill = '#000000', text = '', cursor = 0
  const stack = [], colors = []
  const clean = value => String(value).normalize('NFKC').replace(/\s/g, '')
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const fn = operatorList.fnArray[i], args = operatorList.argsArray[i] || []
    if (fn === ops.save) stack.push(fill)
    else if (fn === ops.restore) fill = stack.pop() ?? '#000000'
    else if (fn === ops.setFillRGBColor) fill = typeof args[0] === 'string' ? args[0] : `#${args.slice(0,3).map(n=>Math.round(n).toString(16).padStart(2,'0')).join('')}`
    else if (fn === ops.setFillColorN || fn === ops.setFillColor) fill = null
    else if ([ops.showText,ops.showSpacedText,ops.nextLineShowText,ops.nextLineSetSpacingShowText].includes(fn)) {
      for (const glyph of args.flat(Infinity)) {
        if (!glyph || typeof glyph !== 'object' || !glyph.unicode) continue
        const value = clean(glyph.unicode)
        text += value
        for (let j = 0; j < value.length; j++) colors.push(fill)
      }
    }
  }
  return items.map(item => {
    const value = clean(item.str || '')
    if (!value) return null
    const start = text.indexOf(value, cursor)
    if (start < 0) return null
    cursor = start + value.length
    const ranges = []
    let glyphOffset = start, previousColor = colors[start]
    for (let offset = 0; offset < String(item.str).length;) {
      const char = String.fromCodePoint(item.str.codePointAt(offset))
      const normalized = clean(char)
      const color = normalized ? colors[glyphOffset] : previousColor
      glyphOffset += normalized.length
      if (color) {
        const last = ranges.at(-1)
        if (last?.color === color && last.end === offset) last.end = offset + char.length
        else ranges.push({ start: offset, end: offset + char.length, color })
      }
      previousColor = color
      offset += char.length
    }
    return { color: colors[start], ranges }

  })
}

export function extractTextColors(operatorList, ops, items) {
  return extractTextColorStyles(operatorList, ops, items).map(style => style?.color || null)
}
