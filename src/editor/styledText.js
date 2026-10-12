import { resolveTextRuns } from './fonts.js'
import { textStyleAt } from './textStyles.js'

export async function layoutStyledText(pdf, text, operation, assets, size, width) {
  const boundaries = [...new Set([0, text.length, ...(operation.styleRanges || []).flatMap(r => [r.start, r.end])])].filter(n => n >= 0 && n <= text.length).sort((a,b) => a-b)
  const runs = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const style = textStyleAt(operation.styleRanges, boundaries[i], operation)
    const runSize = Math.max(2, Math.min(144, Number(style.fontSize) || size))
    for (const run of await resolveTextRuns(pdf, text.slice(boundaries[i], boundaries[i+1]), style, assets)) runs.push({ ...run, size: runSize, color: style.color })
  }
  const lines = [{ runs: [], width: 0 }]
  const noWrap = !operation.isNew && operation.sourceLineCount > 0
  for (const run of runs) {
    for (const token of run.text.split(/(\n|[^\S\n]+)/).filter(Boolean)) {
      if (token === '\n') { lines.push({ runs: [], width: 0 }); continue }
      let line = lines.at(-1)
      const tokenWidth = run.font.widthOfTextAtSize(token, run.size)
      if (!noWrap && line.width && line.width + tokenWidth > width && token.trim()) { lines.push({ runs: [], width: 0 }); line = lines.at(-1) }
      // Keep whole words/script runs together for shaping; split only oversized tokens.
      for (const chunk of !noWrap && tokenWidth > width ? Array.from(token) : [token]) {
        const chunkWidth = run.font.widthOfTextAtSize(chunk, run.size)
        if (!noWrap && line.width && line.width + chunkWidth > width) { lines.push({ runs: [], width: 0 }); line = lines.at(-1) }
        line.runs.push({ ...run, text: chunk, width: chunkWidth }); line.width += chunkWidth
      }
    }
  }
  return lines
}
