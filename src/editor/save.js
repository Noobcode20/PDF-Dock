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
  if (bridge?.saveFile) {
    const result = await bridge.saveFile({
      name: file.name,
      data,
      filePath: mode === "save" ? session.sourcePath : null,
    });
    if (result.canceled) return null;
    path = result.filePath;
  } else await download({ name: file.name, data, mimeType: "application/pdf" });
  try {
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
    name: path?.split(/[\\/]/).pop() || file.name,
    saved: mode !== "export",
  };
}
