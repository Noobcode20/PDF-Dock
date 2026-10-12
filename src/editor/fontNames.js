export function systemFontKey(name = "", weight = "", style = "") {
  const clean = String(name)
    .replace(/^[A-Z]{6}\+/, "")
    .toLowerCase();
  const family = /^(arial|helvetica|liberation.?sans)/.test(clean)
    ? "Arial"
    : /^(times|nimbus.?rom|liberation.?serif|texgyretermes|georgia|palatino|cambria|^serif)/.test(clean)
      ? "TimesNewRoman"
      : /^(courier|mono|consolas|menlo|monaco|inconsolata|liberation.?mono)/.test(clean)
        ? "CourierNew"
        : null;
  const bold = parseInt(weight) >= 600 || /bold/i.test(String(weight)),
    italic = /italic|oblique/i.test(String(style));
  return family
    ? `${family}-${bold ? (italic ? "BoldItalic" : "Bold") : italic ? "Italic" : "Regular"}`
    : "";
}
