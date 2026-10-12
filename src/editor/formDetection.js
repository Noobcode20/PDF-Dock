// Suggestions only. No PDF mutation occurs until a candidate is accepted.
export function detectTextFormCandidates(items, viewport) {
  const candidates = [];
  for (const item of items) {
    if (!item.str || !item.transform) continue;
    const match = item.str.match(/_{3,}|[□☐]|\[\s*\]/);
    if (!match) continue;
    const label =
      item.str
        .slice(0, match.index)
        .replace(/[:\s]+$/, "")
        .trim() || `Field ${candidates.length + 1}`;
    const fraction = match.index / Math.max(1, item.str.length),
      extent = match[0].length / Math.max(1, item.str.length),
      size = Math.max(10, Math.abs(item.transform[3]) || 12);
    const a = viewport.convertToViewportPoint(
        item.transform[4] + (item.width || size) * fraction,
        item.transform[5],
      ),
      b = viewport.convertToViewportPoint(
        item.transform[4] + (item.width || size) * (fraction + extent),
        item.transform[5] + size * 1.4,
      );
    const x = Math.max(0, Math.min(a[0], b[0]) / viewport.width),
      y = Math.max(0, Math.min(a[1], b[1]) / viewport.height);
    const kind = /□|☐|\[/.test(match[0]) ? "checkbox" : "text";
    candidates.push({
      name: label.replace(/[^\p{L}\p{N}_ -]/gu, "").slice(0, 64),
      kind,
      x,
      y,
      width: Math.min(
        1 - x,
        Math.max(
          kind === "checkbox" ? 0.025 : 0.12,
          Math.abs(b[0] - a[0]) / viewport.width,
        ),
      ),
      height: Math.min(
        1 - y,
        Math.max(0.02, Math.abs(b[1] - a[1]) / viewport.height),
      ),
    });
  }
  return candidates.slice(0, 100);
}
