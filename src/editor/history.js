// Semantic snapshots share File/Blob references. Byte checkpoints are retained only
// when a PDF transformation is committed. Never clone a PDF for a typing event.
export function boundHistory(
  snapshots,
  maxBytes = 96 * 1024 * 1024,
  maxSteps = 50,
) {
  const result = snapshots.slice(-maxSteps),
    unique = new Set();
  let bytes = 0;
  for (let i = result.length - 1; i >= 0; i--) {
    for (const file of result[i].files || [])
      if (!unique.has(file)) {
        unique.add(file);
        bytes += file.size || file.byteLength || 0;
      }
    for (const edit of result[i].imageEdits || [])
      for (const data of [edit.sourceData, edit.replacementData])
        if (data && !unique.has(data)) {
          unique.add(data);
          bytes += data.byteLength || 0;
        }
    if (bytes > maxBytes) return result.slice(i + 1);
  }
  return result;
}
export const newRevision = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
export function pushHistory(history, snapshot) {
  return { past: boundHistory([...history.past, snapshot]), future: [] };
}
