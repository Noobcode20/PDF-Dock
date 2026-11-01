import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, StandardFontEmbedder, decodePDFRawStream } from 'pdf-lib';
import { inversePoint } from './coordinates.js';

const IDENTITY = [1, 0, 0, 1, 0, 0];
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

function multiplyMatrices(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function transformPoint(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

function translated(x, y) {
  return [1, 0, 0, 1, x, y];
}

function numberValue(value, fallback = 0) {
  const number = typeof value === 'number' ? value : value?.asNumber ? value.asNumber() : Number(value?.value);
  return Number.isFinite(number) ? number : fallback;
}

function latin1(bytes) {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

function latin1Bytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

function hexBytes(value) {
  const clean = String(value).replace(/[^0-9a-f]/gi, '');
  const padded = clean.length % 2 ? `${clean}0` : clean;
  const bytes = new Uint8Array(padded.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(padded.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function byteKey(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function bytesValue(bytes) {
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

function unicodeHex(value) {
  const bytes = hexBytes(value);
  let text = '';
  for (let index = 0; index + 1 < bytes.length; index += 2) text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  return text;
}

function decodeLiteral(source, start) {
  let index = start + 1;
  let depth = 1;
  while (index < source.length && depth) {
    const code = source.charCodeAt(index);
    if (code === 92) {
      index += source[index + 1] === '\r' && source[index + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (code === 40) depth += 1;
    else if (code === 41) depth -= 1;
    index += 1;
  }
  const inner = source.slice(start + 1, Math.max(start + 1, index - 1));
  const bytes = [];
  for (let cursor = 0; cursor < inner.length; cursor += 1) {
    const char = inner[cursor];
    if (char !== '\\') {
      bytes.push(char.charCodeAt(0) & 0xff);
      continue;
    }
    const next = inner[cursor + 1];
    if (next === undefined) break;
    if (next === '\r' || next === '\n') {
      cursor += next === '\r' && inner[cursor + 2] === '\n' ? 2 : 1;
      continue;
    }
    const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
    if (Object.prototype.hasOwnProperty.call(escapes, next)) {
      bytes.push(escapes[next]);
      cursor += 1;
      continue;
    }
    const octal = inner.slice(cursor + 1).match(/^[0-7]{1,3}/);
    if (octal) {
      bytes.push(parseInt(octal[0], 8) & 0xff);
      cursor += octal[0].length;
      continue;
    }
    bytes.push(next.charCodeAt(0) & 0xff);
    cursor += 1;
  }
  return { token: { type: 'string', raw: source.slice(start, index), bytes: Uint8Array.from(bytes) }, index };
}

function tokenize(source) {
  const output = [];
  const stack = [];
  let index = 0;
  while (index < source.length) {
    const current = stack.length ? stack[stack.length - 1].items : output;
    const code = source.charCodeAt(index);
    if (WS.has(code)) {
      let end = index + 1;
      while (end < source.length && WS.has(source.charCodeAt(end))) end += 1;
      if (!stack.length) output.push({ type: 'raw', raw: source.slice(index, end) });
      index = end;
      continue;
    }
    if (code === 37) {
      let end = index + 1;
      while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end += 1;
      if (!stack.length) output.push({ type: 'raw', raw: source.slice(index, end) });
      index = end;
      continue;
    }
    if (source.startsWith('<<', index)) {
      let end = index + 2;
      let depth = 1;
      while (end < source.length && depth) {
        if (source.startsWith('<<', end)) { depth += 1; end += 2; continue; }
        if (source.startsWith('>>', end)) { depth -= 1; end += 2; continue; }
        if (source[end] === '(') { end = decodeLiteral(source, end).index; continue; }
        if (source[end] === '<') {
          end += 1;
          while (end < source.length && source[end] !== '>') end += 1;
          end += 1;
          continue;
        }
        if (source[end] === '%') {
          while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end += 1;
          continue;
        }
        end += 1;
      }
      current.push({ type: 'dict', raw: source.slice(index, end) });
      index = end;
      continue;
    }
    if (code === 40) {
      const literal = decodeLiteral(source, index);
      current.push(literal.token);
      index = literal.index;
      continue;
    }
    if (code === 60) {
      let end = index + 1;
      while (end < source.length && source[end] !== '>') end += 1;
      const raw = source.slice(index, end + 1);
      current.push({ type: 'string', raw, bytes: hexBytes(raw.slice(1, -1)) });
      index = end + 1;
      continue;
    }
    if (code === 91) {
      stack.push({ start: index, items: [] });
      index += 1;
      continue;
    }
    if (code === 93) {
      const array = stack.pop();
      if (!array) return null;
      const token = { type: 'array', raw: source.slice(array.start, index + 1), items: array.items };
      const parent = stack.length ? stack[stack.length - 1].items : output;
      parent.push(token);
      index += 1;
      continue;
    }
    if (code === 47) {
      let end = index + 1;
      while (end < source.length && !WS.has(source.charCodeAt(end)) && !DELIMITERS.has(source[end])) end += 1;
      const raw = source.slice(index, end);
      current.push({ type: 'name', raw, value: raw.slice(1) });
      index = end;
      continue;
    }
    let end = index + 1;
    while (end < source.length && !WS.has(source.charCodeAt(end)) && !DELIMITERS.has(source[end])) end += 1;
    const raw = source.slice(index, end);
    if (raw === 'BI') return null;
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) current.push({ type: 'number', raw, value: Number(raw) });
    else current.push({ type: 'op', raw });
    index = end;
  }
  if (stack.length) return null;
  return output;
}

function cmapString(value) {
  return unicodeHex(value);
}

function parseCMap(bytes) {
  const text = latin1(bytes);
  const ranges = [];
  for (const match of text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const range of match[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const lo = hexBytes(range[1]);
      const hi = hexBytes(range[2]);
      if (lo.length === hi.length) ranges.push({ length: lo.length, lo: bytesValue(lo), hi: bytesValue(hi) });
    }
  }
  const map = new Map();
  for (const match of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of match[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(pair[1].toUpperCase(), cmapString(pair[2]));
  }
  for (const match of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of match[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const loBytes = hexBytes(range[1]);
      const hiBytes = hexBytes(range[2]);
      const lo = bytesValue(loBytes);
      const hi = bytesValue(hiBytes);
      if (hi < lo || hi - lo > 65535) continue;
      if (range[3] !== undefined) {
        const start = hexBytes(range[3]);
        for (let offset = 0; offset <= hi - lo; offset += 1) {
          const value = bytesValue(start) + offset;
          const key = new Uint8Array(loBytes.length);
          let source = lo + offset;
          for (let index = key.length - 1; index >= 0; index -= 1) { key[index] = source & 0xff; source >>= 8; }
          const target = new Uint8Array(start.length);
          let remaining = value;
          for (let index = target.length - 1; index >= 0; index -= 1) { target[index] = remaining & 0xff; remaining >>= 8; }
          map.set(byteKey(key), cmapString(byteKey(target)));
        }
      } else {
        const values = [...(range[4] || '').matchAll(/<([0-9a-fA-F]*)>/g)].map((entry) => entry[1]);
        values.forEach((value, offset) => {
          if (lo + offset > hi) return;
          const key = new Uint8Array(loBytes.length);
          let source = lo + offset;
          for (let index = key.length - 1; index >= 0; index -= 1) { key[index] = source & 0xff; source >>= 8; }
          map.set(byteKey(key), cmapString(value));
        });
      }
    }
  }
  const lengths = [...new Set([...ranges.map((range) => range.length), ...[...map.keys()].map((key) => key.length / 2)])].sort((a, b) => a - b);
  return { map, ranges, lengths };
}

function splitCodes(bytes, cmap) {
  const codes = [];
  let index = 0;
  const lengths = cmap?.lengths?.length ? cmap.lengths : [1];
  while (index < bytes.length) {
    let found = null;
    for (const range of cmap?.ranges || []) {
      if (index + range.length > bytes.length) continue;
      const value = bytesValue(bytes.subarray(index, index + range.length));
      if (value >= range.lo && value <= range.hi) { found = { length: range.length, value }; break; }
    }
    if (!found) {
      for (const length of lengths) {
        if (index + length > bytes.length) continue;
        const key = byteKey(bytes.subarray(index, index + length));
        if (cmap?.map?.has(key)) { found = { length, value: bytesValue(bytes.subarray(index, index + length)) }; break; }
      }
    }
    if (!found) {
      const length = Math.min(...lengths.filter((candidate) => index + candidate <= bytes.length));
      if (!Number.isFinite(length)) return null;
      found = { length, value: bytesValue(bytes.subarray(index, index + length)) };
    }
    codes.push({ length: found.length, value: found.value, bytes: bytes.subarray(index, index + found.length) });
    index += found.length;
  }
  return codes;
}

const standardMetricsCache = new Map();

function standardFontMetrics(base) {
  const name = String(base || '').replace(/^\//, '');
  if (!name) return null;
  if (standardMetricsCache.has(name)) return standardMetricsCache.get(name);
  let metrics = null;
  try {
    const embedder = StandardFontEmbedder.for(name);
    const glyphs = new Map();
    const unicode = new Map();
    for (const mapping of Object.values(embedder.encoding?.unicodeMappings || {})) {
      if (!Array.isArray(mapping) || mapping.length < 2) continue;
      const code = Number(mapping[0]);
      const glyph = String(mapping[1]);
      glyphs.set(code, glyph);
      if (Number.isFinite(code)) unicode.set(glyph, String.fromCharCode(code));
    }
    const widthOf = (glyph) => {
      const width = embedder.font.getWidthOfGlyph(glyph);
      return Number.isFinite(width) ? width / 1000 : null;
    };
    metrics = {
      widthForCode: (code) => {
        const glyph = glyphs.get(code);
        return glyph === undefined ? null : widthOf(glyph);
      },
      widthForGlyph: (glyph) => widthOf(glyph),
      unicodeForGlyph: (glyph) => unicode.get(glyph) ?? null,
    };
  } catch { metrics = null; }
  standardMetricsCache.set(name, metrics);
  return metrics;
}

function parseWidths(font, type0, descendant, standard, differences) {
  if (!type0) {
    const first = numberValue(font.lookupMaybe?.(PDFName.of('FirstChar'), PDFNumber), 0);
    const widths = font.lookupMaybe?.(PDFName.of('Widths'), PDFArray);
    const descriptor = font.lookupMaybe?.(PDFName.of('FontDescriptor'), PDFDict);
    const missing = numberValue(descriptor?.lookupMaybe?.(PDFName.of('MissingWidth'), PDFNumber), 500) / 1000;
    return {
      reliable: Boolean(widths) || Boolean(standard),
      width: (code) => {
        const value = widths?.get?.(code - first);
        if (value) return numberValue(value, missing * 1000) / 1000;
        if (widths) return missing;
        const glyph = differences?.get(code);
        const known = glyph === undefined ? standard?.widthForCode?.(code) : standard?.widthForGlyph?.(glyph);
        return known === null || known === undefined ? null : known;
      },
    };
  }
  const defaultWidth = numberValue(descendant?.lookupMaybe?.(PDFName.of('DW'), PDFNumber), 1000) / 1000;
  const ranges = [];
  const widths = descendant?.lookupMaybe?.(PDFName.of('W'), PDFArray);
  if (widths) {
    for (let index = 0; index < widths.size();) {
      const start = numberValue(widths.lookup(index), 0);
      const next = widths.lookup(index + 1);
      if (next instanceof PDFArray) {
        const values = [];
        for (let offset = 0; offset < next.size(); offset += 1) values.push(numberValue(next.lookup(offset), 1000) / 1000);
        ranges.push({ start, end: start + values.length - 1, values });
        index += 2;
      } else {
        const end = numberValue(next, start);
        const width = numberValue(widths.lookup(index + 2), defaultWidth * 1000) / 1000;
        ranges.push({ start, end, value: width });
        index += 3;
      }
    }
  }
  return {
    reliable: widths instanceof PDFArray,
    width: (code) => {
      for (const range of ranges) {
        if (code < range.start || code > range.end) continue;
        if (range.values) return range.values[code - range.start] ?? defaultWidth;
        return range.value;
      }
      return defaultWidth;
    },
  };
}

function fontInfo(pdf, fonts, name, cache) {
  if (!name || !fonts?.lookup) return null;
  if (cache.has(name)) return cache.get(name);
  const font = fonts.lookup(PDFName.of(name));
  if (!(font instanceof PDFDict)) { cache.set(name, null); return null; }
  const subtype = font.get(PDFName.of('Subtype'))?.toString();
  const type0 = subtype === '/Type0';
  const descendant = type0 ? pdf.context.lookup(font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookup(0)) : null;
  const toUnicodeRef = font.get(PDFName.of('ToUnicode'));
  const toUnicode = toUnicodeRef ? pdf.context.lookup(toUnicodeRef) : null;
  let bytes = null;
  if (toUnicode instanceof PDFRawStream) {
    try { bytes = decodePDFRawStream(toUnicode).decode(); } catch { bytes = null; }
  }
  const cmap = bytes ? parseCMap(bytes) : null;
  const base = font.get(PDFName.of('BaseFont'))?.toString() || '';
  const encoding = font.get(PDFName.of('Encoding'));
  const encodingName = encoding?.toString?.() || '';
  const baseEncoding = encoding?.lookupMaybe?.(PDFName.of('BaseEncoding'), PDFName)?.toString?.() || '';
  const differences = encoding?.lookupMaybe?.(PDFName.of('Differences'), PDFArray);
  const differenceGlyphs = new Map();
  let differencesReliable = true;
  if (differences instanceof PDFArray) {
    let code = 0;
    for (let index = 0; index < differences.size(); index += 1) {
      const item = differences.lookup(index);
      if (item instanceof PDFNumber) code = numberValue(item);
      else if (item instanceof PDFName) {
        differenceGlyphs.set(code, item.decodeText ? item.decodeText() : item.toString().slice(1));
        code += 1;
      } else differencesReliable = false;
    }
  }
  const standard = type0 ? null : standardFontMetrics(base);
  const widths = parseWidths(font, type0, descendant, standard, differenceGlyphs);
  const namedEncoding = /^\//.test(encodingName) ? encodingName : baseEncoding;
  const simpleEncoding = !namedEncoding || /WinAnsiEncoding|StandardEncoding/.test(namedEncoding);
  const decodeReliable = Boolean(cmap?.map?.size) || (!type0 && differencesReliable && simpleEncoding);
  const decodeBase = (textBytes) => {
    try { return new TextDecoder('windows-1252').decode(textBytes); } catch { return latin1(textBytes); }
  };
  const decode = (textBytes) => {
    if (cmap?.map?.size) {
      const codes = splitCodes(textBytes, cmap);
      if (!codes) return null;
      let output = '';
      for (const code of codes) {
        const value = cmap.map.get(byteKey(code.bytes));
        if (value === undefined) return null;
        output += value;
      }
      return output;
    }
    if (type0 || !differencesReliable || !simpleEncoding) return null;
    if (!differenceGlyphs.size) return decodeBase(textBytes);
    let output = '';
    for (const byte of textBytes) {
      const glyph = differenceGlyphs.get(byte);
      if (glyph === undefined) { output += decodeBase(Uint8Array.of(byte)); continue; }
      const value = standard?.unicodeForGlyph?.(glyph);
      if (value === null || value === undefined) return null;
      output += value;
    }
    return output;
  };
  const advance = (textBytes, size, charSpacing, wordSpacing, horizontalScale) => {
    const scale = horizontalScale / 100;
    const codes = type0 ? (cmap ? splitCodes(textBytes, cmap) : [{ length: Math.min(2, textBytes.length), value: bytesValue(textBytes.subarray(0, 2)), bytes: textBytes.subarray(0, 2) }]) : Array.from(textBytes, (byte) => ({ length: 1, value: byte, bytes: Uint8Array.of(byte) }));
    if (!codes) return null;
    let total = 0;
    for (const code of codes) {
      const width = widths.width(code.value);
      if (width === null || !Number.isFinite(width)) return null;
      total += (width * size + charSpacing + (code.value === 32 && code.length === 1 ? wordSpacing : 0)) * scale;
    }
    return total;
  };
  const info = { decode, advance, reliable: decodeReliable && widths.reliable };
  cache.set(name, info);
  return info;
}

function normalized(value) {
  return String(value || '').normalize('NFKC').replace(/[\u00ad\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, '');
}

function shim(advance, size, horizontalScale) {
  if (!advance) return '';
  const scale = horizontalScale / 100;
  const divisor = size * scale;
  if (!divisor) return '';
  const adjustment = -advance * 1000 / divisor;
  if (!Number.isFinite(adjustment)) return '';
  return `[${Number(adjustment.toFixed(4))}] TJ`;
}

function tjNumber(advance, size, horizontalScale) {
  const divisor = size * horizontalScale / 100;
  if (!divisor) return '0';
  const adjustment = -advance * 1000 / divisor;
  return Number.isFinite(adjustment) ? String(Number(adjustment.toFixed(4))) : '0';
}

function coverRects(operation, frame) {
  const covers = operation.sourceCoverRects?.length ? operation.sourceCoverRects : [{
    x: operation.coverX ?? operation.x,
    y: operation.coverY ?? operation.y,
    width: operation.coverWidth || operation.width,
    height: operation.coverHeight || operation.height,
  }];
  return covers.map((cover) => {
    const x = Number(cover.x);
    const y = Number(cover.y);
    const width = Number(cover.width);
    const height = Number(cover.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    const padX = 2 / frame.width;
    const padY = 2 / frame.height;
    return {
      left: x - padX,
      right: x + width + padX,
      top: y - padY,
      bottom: y + height + padY,
    };
  }).filter(Boolean);
}

function insideCovers(point, covers) {
  return covers.some((cover) => point[0] >= cover.left && point[0] <= cover.right && point[1] >= cover.top && point[1] <= cover.bottom);
}

function editorState() {
  return {
    ctm: IDENTITY,
    textMatrix: IDENTITY,
    lineMatrix: IDENTITY,
    stack: [],
    fontSize: 0,
    fontName: '',
    leading: 0,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 100,
  };
}

function analyze(source, state, covers, frame, pdf, fonts, cache) {
  const tokens = tokenize(source);
  if (!tokens) return null;
  const candidates = [];
  const parts = [];
  const operands = [];
  let unsafe = false;
  const display = (matrix) => {
    const point = transformPoint(matrix, 0, 0);
    const back = inversePoint(frame.matrix, point[0], point[1]);
    return [back[0] / frame.width, 1 - back[1] / frame.height];
  };
  const position = () => display(multiplyMatrices(state.ctm, state.textMatrix));
  const pointAt = (amount) => display(multiplyMatrices(state.ctm, multiplyMatrices(state.textMatrix, translated(amount, 0))));
  const fallbackAdvance = (bytes, size, horizontalScale) => bytes.length * size * 0.5 * horizontalScale / 100;
  const advance = (info, bytes, size, charSpacing, wordSpacing, horizontalScale) => info
    ? info.advance(bytes, size, charSpacing, wordSpacing, horizontalScale)
    : null;
  const move = (amount) => { state.textMatrix = multiplyMatrices(state.textMatrix, translated(amount, 0)); };
  const fullyInside = (total) => Number.isFinite(total)
    && [0, total / 2, total].every((amount) => insideCovers(pointAt(amount), covers));
  const record = (bytes, operandTokens, replacementPrefix, token) => {
    const info = fontInfo(pdf, fonts, state.fontName, cache);
    const decoded = info?.decode(bytes);
    const shown = decoded || '';
    if (!info?.reliable || (bytes.length > 0 && decoded === null)) unsafe = true;
    const total = advance(info, bytes, state.fontSize, state.charSpacing, state.wordSpacing, state.horizontalScale);
    if (total === null) unsafe = true;
    const hit = Boolean(shown) && info?.reliable && total !== null && fullyInside(total);
    if (hit) {
      parts.push(shown);
      candidates.push({
        type: 'whole',
        token,
        operands: operandTokens,
        replacement: `${replacementPrefix || ''}${shim(total, state.fontSize, state.horizontalScale)}`,
      });
    }
    move(total ?? fallbackAdvance(bytes, state.fontSize, state.horizontalScale));
    return total;
  };
  const showArray = (array, token) => {
    const info = fontInfo(pdf, fonts, state.fontName, cache);
    if (!info?.reliable) unsafe = true;
    const items = array.items || [];
    const stringItems = items.map((item, index) => (item.type === 'string' ? index : -1)).filter((index) => index >= 0);
    const selected = [];
    let total = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.type === 'number') {
        const amount = (-item.value / 1000) * state.fontSize * state.horizontalScale / 100;
        total += amount;
        move(amount);
        continue;
      }
      if (item.type !== 'string') continue;
      const decoded = info?.decode(item.bytes);
      const text = decoded || '';
      if (item.bytes.length > 0 && decoded === null) unsafe = true;
      const measured = advance(info, item.bytes, state.fontSize, state.charSpacing, state.wordSpacing, state.horizontalScale);
      const amount = measured ?? fallbackAdvance(item.bytes, state.fontSize, state.horizontalScale);
      if (measured === null) unsafe = true;
      const points = [pointAt(0), pointAt(amount / 2), pointAt(amount)];
      const covered = points.map((point) => insideCovers(point, covers));
      const allInside = Boolean(text) && info?.reliable && measured !== null && covered.every(Boolean);
      if (Boolean(text) && info?.reliable && covered.some(Boolean) && !allInside) unsafe = true;
      if (allInside) {
        selected.push({ index, text, amount });
        parts.push(text);
      }
      total += amount;
      move(amount);
    }
    if (!selected.length) return;
    if (selected.length === stringItems.length) {
      candidates.push({ type: 'whole', token, operands: [array], replacement: shim(total, state.fontSize, state.horizontalScale) });
    } else {
      candidates.push({
        type: 'items',
        token,
        array,
        items: selected.map(({ index, amount }) => ({ index, amount })),
        size: state.fontSize,
        horizontalScale: state.horizontalScale,
      });
    }
  };
  for (const token of tokens) {
    if (token.type === 'raw') continue;
    if (token.type !== 'op') { operands.push(token); continue; }
    const op = token.raw;
    if (op === 'q') {
      const { stack, ...saved } = state;
      state.stack.push({ ...saved, ctm: [...state.ctm], textMatrix: [...state.textMatrix], lineMatrix: [...state.lineMatrix] });
    } else if (op === 'Q') {
      const saved = state.stack.pop();
      if (saved) {
        const stack = state.stack;
        Object.assign(state, saved);
        state.stack = stack;
      }
    } else if (op === 'cm' && operands.length >= 6) {
      const matrix = operands.slice(-6).map((operand) => numberValue(operand));
      state.ctm = multiplyMatrices(state.ctm, matrix);
    } else if (op === 'BT') {
      state.textMatrix = [...IDENTITY];
      state.lineMatrix = [...IDENTITY];
    } else if (op === 'Tf' && operands.length >= 2) {
      state.fontName = operands[operands.length - 2].value || '';
      state.fontSize = numberValue(operands[operands.length - 1]);
    } else if (op === 'TL' && operands.length) {
      state.leading = numberValue(operands[operands.length - 1]);
    } else if (op === 'Tc' && operands.length) {
      state.charSpacing = numberValue(operands[operands.length - 1]);
    } else if (op === 'Tw' && operands.length) {
      state.wordSpacing = numberValue(operands[operands.length - 1]);
    } else if (op === 'Tz' && operands.length) {
      state.horizontalScale = numberValue(operands[operands.length - 1], 100);
    } else if (op === 'Tm' && operands.length >= 6) {
      state.lineMatrix = operands.slice(-6).map((operand) => numberValue(operand));
      state.textMatrix = [...state.lineMatrix];
    } else if (op === 'Td' && operands.length >= 2) {
      const tx = numberValue(operands[operands.length - 2]);
      const ty = numberValue(operands[operands.length - 1]);
      state.lineMatrix = multiplyMatrices(state.lineMatrix, translated(tx, ty));
      state.textMatrix = [...state.lineMatrix];
    } else if (op === 'TD' && operands.length >= 2) {
      const tx = numberValue(operands[operands.length - 2]);
      const ty = numberValue(operands[operands.length - 1]);
      state.leading = -ty;
      state.lineMatrix = multiplyMatrices(state.lineMatrix, translated(tx, ty));
      state.textMatrix = [...state.lineMatrix];
    } else if (op === 'T*') {
      state.lineMatrix = multiplyMatrices(state.lineMatrix, translated(0, -state.leading));
      state.textMatrix = [...state.lineMatrix];
    } else if (op === 'Tj' && operands.length) {
      const string = operands[operands.length - 1];
      if (string?.type === 'string') record(string.bytes, [string], '', token);
    } else if (op === 'TJ' && operands.length) {
      const array = operands[operands.length - 1];
      if (array?.type === 'array') showArray(array, token);
    } else if (op === "'" && operands.length) {
      state.lineMatrix = multiplyMatrices(state.lineMatrix, translated(0, -state.leading));
      state.textMatrix = [...state.lineMatrix];
      const string = operands[operands.length - 1];
      if (string?.type === 'string') record(string.bytes, [string], 'T* ', token);
    } else if (op === '"' && operands.length >= 3) {
      state.wordSpacing = numberValue(operands[operands.length - 3]);
      state.charSpacing = numberValue(operands[operands.length - 2]);
      state.lineMatrix = multiplyMatrices(state.lineMatrix, translated(0, -state.leading));
      state.textMatrix = [...state.lineMatrix];
      const string = operands[operands.length - 1];
      if (string?.type === 'string') {
        const prefix = `${state.wordSpacing} Tw ${state.charSpacing} Tc T* `;
        record(string.bytes, [operands[operands.length - 3], operands[operands.length - 2], string], prefix, token);
      }
    }
    operands.length = 0;
  }
  return { tokens, candidates, shown: parts.join(''), unsafe };
}

export function removeSimpleTextRun(pdf, page, operation, frame) {
  if (operation.isNew || !operation.oldText) return false;
  const wanted = normalized(operation.oldText);
  if (!wanted) return false;
  const covers = coverRects(operation, frame);
  if (!covers.length) return false;
  const resources = page.node.Resources();
  const fonts = resources?.lookupMaybe?.(PDFName.of('Font'), PDFDict);
  const contents = page.node.Contents();
  const refs = contents?.asArray ? contents.asArray() : contents ? [contents] : [];
  const sources = [];
  for (const ref of refs) {
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) return false;
    try { sources.push(latin1(decodePDFRawStream(stream).decode())); } catch { return false; }
  }
  const source = sources.join('\n');
  const result = analyze(source, editorState(), covers, frame, pdf, fonts, new Map());
  if (!result || result.unsafe) return false;
  if (!result.shown || normalized(result.shown) !== wanted || !result.candidates.length) return false;
  for (const candidate of result.candidates) {
    if (candidate.type === 'whole') {
      for (const operand of candidate.operands) operand.raw = '';
      candidate.token.raw = candidate.replacement;
    } else {
      for (const item of candidate.items) {
        candidate.array.items[item.index].raw = tjNumber(item.amount, candidate.size, candidate.horizontalScale);
      }
      candidate.array.raw = `[${candidate.array.items.map((item) => item.raw).join(' ')}]`;
    }
  }
  const replacement = result.tokens.map((token) => token.raw).join('');
  if (replacement === source) return false;
  const fresh = pdf.context.register(pdf.context.flateStream(latin1Bytes(replacement)));
  page.node.set(PDFName.of('Contents'), fresh);
  return true;
}
