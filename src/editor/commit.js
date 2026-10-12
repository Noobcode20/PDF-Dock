import { systemFontKey } from "./fontNames.js";
let assets;
export async function fontAssets(operations = []) {
  assets ||= Promise.all([
    fetch(new URL("fonts/NotoSans-Regular.ttf", document.baseURI), {
      cache: "no-store",
    }).then((r) => r.arrayBuffer()),
    fetch(new URL("fonts/NotoSansDevanagari-Regular.ttf", document.baseURI), {
      cache: "no-store",
    }).then((r) => r.arrayBuffer()),
  ]).then(([unicode, devanagari]) => ({
    unicode: new Uint8Array(unicode),
    devanagari: new Uint8Array(devanagari),
  }));
  const fonts = { ...(await assets) };
  for (const op of operations.flatMap(operation => [operation, ...(operation.styleRanges || []).map(range => ({ ...operation, ...range }))])) {
    const key = systemFontKey(op.sourceFontName, op.fontWeight, op.fontStyle);
    if (key && window.pdfKing?.readSystemFont && !fonts[key])
      fonts[key] = await window.pdfKing.readSystemFont(key);
  }
  return fonts;
}
export async function commitOperations(file, operations, signal) {
  const fonts = await fontAssets(operations),
    bytes = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./operations.worker.js", import.meta.url),
      { type: "module" },
    );
    const finish = (error, value) => {
      worker.terminate();
      signal?.removeEventListener("abort", cancel);
      error ? reject(error) : resolve(value);
    };
    const cancel = () => finish(new DOMException("Cancelled", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }) =>
      finish(data.error ? new Error(data.error) : null, data.bytes);
    worker.onerror = (e) =>
      finish(new Error(e.message || "PDF worker failed."));
    worker.postMessage({ bytes, operations, fonts }, [bytes.buffer]);
  });
}
