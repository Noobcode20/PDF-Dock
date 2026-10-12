// Layout inference is deliberately local: indentation elsewhere on the page
// must never create a column in a table here.
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
}
export const lineBounds = (row) => ({
  left: Math.min(...row.items.map((part) => part.x)),
  right: Math.max(...row.items.map((part) => part.x + part.width)),
})
export function groupPdfLines(items, viewport) {
  const rows = []
  for (const item of items) {
    const [a, b, c, d, e, f] = item.transform
    const [v0, v1, v2, v3, v4, v5] = viewport.transform
    const x = v0 * e + v2 * f + v4
    const baseline = viewport.height - (v1 * e + v3 * f + v5)
    const fontSize = Math.max(1, Math.hypot(v0 * c + v2 * d, v1 * c + v3 * d))
    const width = item.width * Math.hypot(v0 * a + v2 * b, v1 * a + v3 * b) / (Math.hypot(a, b) || 1)
    let row = rows.find((entry) => Math.abs(entry.baseline - baseline) <= Math.max(1, Math.min(3, fontSize * 0.18)))
    if (!row) rows.push(row = { baseline, items: [], fontSize })
    row.items.push({ item, x, width, fontSize })
    row.fontSize = Math.max(row.fontSize, fontSize)
  }
  return rows.sort((a, b) => b.baseline - a.baseline).map((row) => ({ ...row, items: row.items.sort((a, b) => a.x - b.x) }))
}

export function splitPdfLine(row) {
  const groups = []
  let right = -Infinity
  for (const part of row.items) {
    if (part.x - right > Math.max(18, part.fontSize * 1.6)) groups.push([])
    groups.at(-1).push(part)
    right = Math.max(right, part.x + part.width)
  }
  return groups
}
const listMarker = /^\s*(?:\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|[ivxlcdm]+[.)]|[•●▪◦–-])(?:\s|$)/i
export const isPdfListLine = (row) => listMarker.test(row.items.map((part) => part.item.str).join(' '))
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance
const unique = (values) => values.sort((a, b) => a - b).filter((value, index, all) => !index || !near(value, all[index - 1]))

function ruledTables(rows, lines) {
  const horizontal = lines.filter((line) => line.axis === 'h' && line.end - line.start > 40)
  const vertical = lines.filter((line) => line.axis === 'v' && line.end - line.start > 8)
  const remaining = new Set([...horizontal, ...vertical])
  const tables = []
  const crosses = (a, b) => a.axis !== b.axis && (() => {
    const h = a.axis === 'h' ? a : b, v = a.axis === 'v' ? a : b
    return v.at >= h.start - 3 && v.at <= h.end + 3 && h.at >= v.start - 3 && h.at <= v.end + 3
  })()
  while (remaining.size) {
    const connected = [remaining.values().next().value]
    remaining.delete(connected[0])
    for (let index = 0; index < connected.length; index += 1) {
      for (const line of remaining) if (crosses(connected[index], line)) { connected.push(line); remaining.delete(line) }
    }
    const xs = unique(connected.filter((line) => line.axis === 'v').map((line) => line.at))
    const ys = unique(connected.filter((line) => line.axis === 'h').map((line) => line.at)).reverse()
    if (xs.length < 3 || ys.length < 2) continue
    const members = rows.filter((row) => row.baseline < ys[0] && row.baseline > ys.at(-1)
      && row.items.some((part) => part.x >= xs[0] - 2 && part.x < xs.at(-1)))
    if (!members.length) continue
    // Avoid stealing unrelated text beside a table.
    if (members.some((row) => row.items.some((part) => part.x < xs[0] - 3 || part.x >= xs.at(-1) + 3))) continue
    const tableRows = ys.slice(0, -1).map((top, index) => {
      const bottom = ys[index + 1]
      return xs.slice(0, -1).map((left, column) => ({
        left, right: xs[column + 1], top, bottom,
        lines: members.filter((row) => row.baseline < top && row.baseline > bottom).map((row) => ({
          ...row, items: row.items.filter((part) => part.x >= left - 2 && part.x < xs[column + 1] - 2),
        })).filter((row) => row.items.length),
      }))
    })
    tables.push({ left: xs[0], right: xs.at(-1), top: ys[0], bottom: ys.at(-1), rows: tableRows, members, rules: connected })
  }
  return tables
}

export function inferPdfTables(rows, rules, pageWidth) {
  const tables = ruledTables(rows, rules)
  const used = new Set(tables.flatMap((table) => table.members))
  // Borderless columns often have just a header separator and a bottom rule.
  // Their centered headers reveal empty columns that body-text anchors miss.
  for (const header of rows) {
    if (used.has(header) || isPdfListLine(header)) continue
    const groups = splitPdfLine(header)
    if (groups.length < 2) continue
    const divider = rules.find((rule) => rule.axis === 'h' && header.baseline - rule.at > 0
      && header.baseline - rule.at < header.fontSize * 1.3 && rule.start <= groups[0][0].x && rule.end >= lineBounds({ items: groups.at(-1) }).right - 3)
    if (!divider) continue
    const bottom = rules.filter((rule) => rule.axis === 'h' && rule.at < divider.at - header.fontSize * 2
      && near(rule.start, divider.start, 4) && near(rule.end, divider.end, 4)).sort((a, b) => b.at - a.at)[0]
    if (!bottom) continue
    const centers = groups.map((group) => { const bounds = lineBounds({ items: group }); return (bounds.left + bounds.right) / 2 })
    const xs = [divider.start, ...centers.slice(1).map((center, index) => (center + centers[index]) / 2), divider.end]
    const top = header.baseline + header.fontSize * 1.2
    const members = rows.filter((row) => row.baseline <= header.baseline && row.baseline > bottom.at
      && row.items.every((part) => part.x >= xs[0] - 2 && part.x < xs.at(-1)))
    const ys = [top, divider.at, bottom.at]
    const tableRows = ys.slice(0, -1).map((cellTop, index) => xs.slice(0, -1).map((left, column) => ({
      left, right: xs[column + 1], top: cellTop, bottom: ys[index + 1],
      lines: members.filter((row) => row.baseline <= cellTop && row.baseline > ys[index + 1]).map((row) => ({
        ...row, items: row.items.filter((part) => part.x >= left - 2 && part.x < xs[column + 1] - 2),
      })).filter((row) => row.items.length),
    })))
    tables.push({ left: xs[0], right: xs.at(-1), top, bottom: bottom.at, rows: tableRows, members, rules: [divider, bottom] })
    members.forEach((row) => used.add(row))
  }
  for (let index = 0; index < rows.length; index += 1) {
    const first = rows[index]
    if (used.has(first) || isPdfListLine(first)) continue
    const groups = splitPdfLine(first)
    if (groups.length < 2) continue
    const anchors = groups.map((group) => group[0].x)
    const tolerance = Math.max(6, first.fontSize * 0.6)
    const members = [first]
    let confirmations = 0
    for (let next = index + 1; next < rows.length; next += 1) {
      const row = rows[next]
      if (used.has(row) || isPdfListLine(row) || members.at(-1).baseline - row.baseline > Math.max(38, row.fontSize * 3)) break
      const parts = splitPdfLine(row)
      const starts = parts.map((group) => group[0].x)
      if (starts.some((x) => !anchors.some((anchor) => near(anchor, x, tolerance)))) break
      // A full-width paragraph crossing a gutter marks the end of this table.
      if (parts.some((group) => {
        const column = anchors.findIndex((anchor) => near(anchor, group[0].x, tolerance))
        return column < anchors.length - 1 && lineBounds({ items: group }).right > anchors[column + 1] - 8
      })) break
      if (parts.length === groups.length) confirmations += 1
      members.push(row)
    }
    if (!confirmations) continue
    const right = Math.min(pageWidth, Math.max(...members.map((row) => lineBounds(row).right)) + 6)
    const boundaries = [...anchors, right]
    const logicalRows = []
    let previous
    const typicalSize = median(members.map((row) => row.fontSize))
    for (const row of members) {
      const parts = splitPdfLine(row)
      const full = parts.length === groups.length
      const gap = previous ? previous.baseline - row.baseline : Infinity
      // Wrapped lines stay in their cells. A new populated row begins after
      // paragraph spacing or a header/body font-size change.
      const newRow = !previous || (full && (gap > typicalSize * 1.55 || Math.abs(previous.fontSize - row.fontSize) > 1))
      if (newRow) logicalRows.push(anchors.map((left, column) => ({ left, right: boundaries[column + 1], lines: [] })))
      for (const group of parts) {
        const column = anchors.findIndex((anchor) => near(anchor, group[0].x, tolerance))
        logicalRows.at(-1)[column].lines.push({ ...row, items: group })
      }
      previous = row
    }
    // With no row boundary evidence, prefer ordinary paragraphs over guessing.
    if (logicalRows.length < 2) continue
    logicalRows.forEach((cells, rowIndex) => {
      const populated = cells.flatMap((cell) => cell.lines)
      const top = Math.max(...populated.map((row) => row.baseline + row.fontSize))
      const following = logicalRows[rowIndex + 1]?.flatMap((cell) => cell.lines)
      const bottom = following?.length ? Math.max(...following.map((row) => row.baseline + row.fontSize))
        : Math.min(...populated.map((row) => row.baseline - row.fontSize * 0.3))
      cells.forEach((cell) => { cell.top = top; cell.bottom = bottom })
    })
    const table = { left: anchors[0], right, top: first.baseline + first.fontSize, bottom: members.at(-1).baseline - typicalSize * 0.3,
      rows: logicalRows, members, rules: [] }
    tables.push(table)
    members.forEach((row) => used.add(row))
    index += members.length - 1
  }
  return tables.sort((a, b) => b.top - a.top)
}

export function pdfLineAlignment(row, left, right, bodyCenter) {
  const bounds = lineBounds(row)
  const tolerance = Math.max(4, row.fontSize * 0.5)
  const midpoint = (bounds.left + bounds.right) / 2
  const insetLeft = bounds.left - left, insetRight = right - bounds.right
  const center = insetLeft > tolerance && insetRight > tolerance
    && (near(midpoint, (left + right) / 2, tolerance) || (bodyCenter != null && near(midpoint, bodyCenter, tolerance)))
  return center ? 'center' : insetRight <= tolerance && insetLeft > tolerance * 2 ? 'right' : 'left'
}
