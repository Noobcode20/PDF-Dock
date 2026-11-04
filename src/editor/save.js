/** Export doesn't change path or saved revision. A failed recent update cannot
 * turn a completed file write into a failure. Native writes are atomic. */
export async function writeEditorDocument({
  file,
  session,
  mode = "save",
  bridge,
  download,
  recordRecent,
}) {
  if (!file) throw new Error("Open a PDF first.");
  const data = new Uint8Array(await file.arrayBuffer());
  let path = null;
  let libraryId = session.libraryId || null;
  if (mode === "library") {
    if (typeof recordRecent !== 'function') throw new Error('The local PDF library is unavailable.');
    const entry = await recordRecent({ name: file.name, data, libraryId, sourcePath: null });
    if (!entry?.id) throw new Error('The PDF could not be saved to the local library.');
    libraryId = entry.id;
  } else if (bridge?.saveFile) {
    const result = await bridge.saveFile({
      name: file.name,
      data,
      filePath: mode === "save" ? session.sourcePath : null,
    });
    if (result.canceled) return null;
    path = result.filePath;
  } else if (mode !== "library") await download({ name: file.name, data, mimeType: "application/pdf" });
  if (mode !== 'library') try {
    await recordRecent?.({
      ...file,
      name: path?.split(/[\\/]/).pop() || file.name,
      sourcePath: path || session.sourcePath,
      data,
    });
  } catch (error) {
    console.warn("Saved PDF; recent history update failed.", error);
  }
  return {
    path,
    libraryId,
    name: path?.split(/[\\/]/).pop() || file.name,
    saved: mode !== "export",
  };
}
