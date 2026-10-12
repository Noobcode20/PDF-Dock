export function textStyleAt(ranges, offset, defaults = {}) {
  return { ...defaults, ...(ranges || []).find(range => offset >= range.start && offset < range.end) }
}

// Partition at every boundary so a change to one attribute preserves the others.
export function appendTextStyleRange(ranges, start, end, style) {
  if (end <= start) return ranges || []
  const boundaries = [...new Set([start, end, ...(ranges || []).flatMap(r => [r.start, r.end])])].sort((a, b) => a - b)
  const result = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i], b = boundaries[i + 1]
    const existing = (ranges || []).find(r => a >= r.start && a < r.end)
    const selected = a >= start && a < end
    if (!existing && !selected) continue
    result.push({ ...existing, ...(selected ? style : {}), start: a, end: b })
  }
  return result
}

export function rebaseTextStyleRanges(ranges, before, after, insertionStyle) {
  let start = 0, suffix = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  const oldEnd = before.length - suffix, newEnd = after.length - suffix, delta = newEnd - oldEnd
  const result = []
  for (const range of ranges || []) {
    if (range.start < start) result.push({ ...range, end: Math.min(range.end, start) })
    if (range.end > oldEnd) result.push({ ...range, start: Math.max(range.start, oldEnd) + delta, end: range.end + delta })
  }
  // Replacement inherits the first selected character; typing inherits the preceding run.
  const inherited = insertionStyle || (ranges || []).find(r => (oldEnd > start ? start : Math.max(0, start - 1)) >= r.start && (oldEnd > start ? start : Math.max(0, start - 1)) < r.end)
  return newEnd > start && inherited
    ? appendTextStyleRange(result, start, newEnd, inherited)
    : result.filter(r => r.end > r.start).sort((a, b) => a.start - b.start)
}
