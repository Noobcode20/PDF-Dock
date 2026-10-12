import "regenerator-runtime/runtime.js";
import { systemFontKey } from "./fontNames.js";
export { systemFontKey } from "./fontNames.js";
import { StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export function resolveFontFamilyStack(fontName = "", fallback = "sans-serif") {
  const clean = String(fontName).replace(/^[A-Z]{6}\+/, "").trim();
  const lower = clean.toLowerCase();
  if (/times|nimbus.?rom|liberation.?serif|texgyretermes|georgia|palatino|cambria|minion|baskerville|garamond|^serif/i.test(lower)) {
    return {
      family: "Times New Roman",
      cssStack: '"Times New Roman", Times, "Nimbus Roman No9 L", "Liberation Serif", serif',
      isSerif: true,
    };
  }
  if (/courier|mono|consolas|menlo|monaco|inconsolata|cascadia|liberation.?mono/i.test(lower)) {
    return {
      family: "Courier New",
      cssStack: '"Courier New", Courier, "Liberation Mono", monospace',
      isMono: true,
    };
  }
  return {
    family: "Arial",
    cssStack: 'Arial, Helvetica, "Liberation Sans", sans-serif',
    isSans: true,
  };
}

export function normalizeFont(family = "", bold = false, italic = false) {
  const name = String(family)
    .replace(/^[A-Z]{6}\+/, "")
    .toLowerCase();
  const base = /courier|mono|consolas|menlo/.test(name)
    ? "Courier"
    : /times|nimbus.?rom|liberation.?serif|texgyretermes|georgia|palatino|cambria|^serif/.test(name)
      ? "Times"
      : "Helvetica";
  return base === "Times"
    ? StandardFonts[
        `TimesRoman${bold ? "Bold" : ""}${italic ? "Italic" : ""}`
      ] ||
        (bold && italic
          ? StandardFonts.TimesRomanBoldItalic
          : StandardFonts.TimesRoman)
    : StandardFonts[`${base}${bold ? "Bold" : ""}${italic ? "Oblique" : ""}`];
}
const cleanText = (text) => String(text).replace(/[\r\n\t]/g, " ");
function supports(font, text) {
  try {
    font.encodeText(cleanText(text));
    if (font.getCharacterSet) {
      const set = new Set(font.getCharacterSet());
      return [...cleanText(text)].every((c) => set.has(c.codePointAt(0)));
    }
    return true;
  } catch {
    return false;
  }
}
const fontCache = new WeakMap();
export async function resolveFont(pdf, text, style = {}, assets = {}) {
  const bold =
      parseInt(style.fontWeight) >= 600 ||
      style.bold ||
      /bold/i.test(String(style.fontWeight)),
    italic = style.italic || /italic|oblique/i.test(String(style.fontStyle));
  pdf.registerFontkit(fontkit);
  const key = systemFontKey(
    style.sourceFontName,
    style.fontWeight,
    style.fontStyle,
  );
  const candidates = [
    style.fontData,
    assets[key],
    normalizeFont(style.fontFamily, bold, italic),
    ...(/[\u0900-\u097f]/u.test(text) ? [assets.devanagari] : []),
    assets.unicode,
  ];
  for (const candidate of candidates.filter(Boolean)) {
    let cache = fontCache.get(pdf);
    if (!cache) {
      cache = new Map();
      fontCache.set(pdf, cache);
    }
    let font = cache.get(candidate);
    if (!font) {
      try {
        font = await pdf.embedFont(candidate, {
          subset: typeof candidate !== "string",
        });
        cache.set(candidate, font);
      } catch {
        continue;
      }
    }
    if (supports(font, text)) return font;
  }
  throw new Error(
    "The selected and bundled fonts do not contain all of these characters. Choose a local font with the required script.",
  );
}
export function wrapText(text, font, size, width) {
  const lines = [];
  for (const paragraph of String(text).replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const token of paragraph.split(/(\s+)/)) {
      if (line && font.widthOfTextAtSize(line + token, size) > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      for (const char of token) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

// Keep script runs together so fontkit can shape combining marks and ligatures.
export async function resolveTextRuns(pdf, text, style = {}, assets = {}) {
  try {
    return [{ text, font: await resolveFont(pdf, text, style, assets) }];
  } catch (error) {
    const chunks =
      String(text).match(/[\u0900-\u097f]+|[^\u0900-\u097f]+/gu) || [];
    if (chunks.length < 2) throw error;
    const runs = [];
    for (const chunk of chunks)
      runs.push({
        text: chunk,
        font: await resolveFont(pdf, chunk, style, assets),
      });
    return runs;
  }
}
