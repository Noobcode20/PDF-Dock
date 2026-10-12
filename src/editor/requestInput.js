export function requestInput(title, value = "") {
  return new Promise((resolve) =>
    window.dispatchEvent(
      new CustomEvent("pdfking-input", { detail: { title, value, resolve } }),
    ),
  );
}
