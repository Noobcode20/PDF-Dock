/** Normalize image payloads before they reach the PDF writer.
 *
 * The placement matrix carries the crop, so the pixels are never cropped here:
 * a crop must not be applied twice, and the transform must stay analytic so the
 * preview and the saved PDF agree. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

export function detectImageType(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return "image/png";
  if (JPEG_SIGNATURE.every((value, index) => bytes[index] === value)) return "image/jpeg";
  return null;
}
export function toBytes(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== "undefined" && data instanceof Blob) return null;
  return null;
}
async function bytesOf(data) {
  const direct = toBytes(data);
  if (direct) return direct;
  if (typeof Blob !== "undefined" && data instanceof Blob)
    return new Uint8Array(await data.arrayBuffer());
  return null;
}

/** Returns the operation with embeddable bytes and a truthful MIME type. */
export async function prepareImageOperation(operation, signal) {
  if (operation.type !== "image") return operation;
  signal?.throwIfAborted();
  const source = operation.replacementData || operation.sourceData;
  if (!source) {
    if (operation.deleted) return { ...operation, replacementData: undefined, sourceData: undefined };
    throw new Error("The image source has not loaded. Select it again before saving.");
  }
  const bytes = await bytesOf(source);
  if (!bytes || !bytes.length)
    throw new Error("The image data is empty and cannot be placed in the PDF.");
  const detected = detectImageType(bytes);
  if (!detected)
    throw new Error("Only PNG and JPEG images can be placed in a PDF.");
  return {
    ...operation,
    sourceData: operation.sourceData ? bytes : operation.sourceData,
    replacementData: operation.replacementData ? bytes : operation.replacementData,
    replacementType: detected,
  };
}

/** Decode/crop locally, then use the SAME image operation path as ordinary
 * placement. Crop must never send a transformed image to the legacy writer. */
export async function prepareImageOperations(operations, signal) {
  const output = [];
  for (const operation of operations) {
    signal?.throwIfAborted();
    if (operation.type !== "image") {
      output.push(operation);
      continue;
    }
    output.push(await prepareImageOperation(operation, signal));
  }
  return output;
}
