/** Settle even when a terminated third-party worker leaves its job pending. */
export function abortable(promise, signal, onAbort = () => {}) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const aborted = () => {
      onAbort();
      reject(new DOMException("Operation cancelled.", "AbortError"));
    };
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
