import { applyOperations } from "./operations.js";
self.onmessage = async ({ data }) => {
  try {
    const bytes = await applyOperations(data.bytes, data.operations, {
      fonts: data.fonts,
    });
    self.postMessage({ bytes }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
