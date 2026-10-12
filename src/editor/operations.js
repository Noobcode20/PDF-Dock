import { layoutStyledText } from './styledText.js';
import { removeSimpleTextRun } from "./simpleText.js";
import {
  PDFDocument,
  rgb,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  rectangle, clip, endPath,
  PDFName,
  PDFHexString,
} from "pdf-lib";
import {
  displayFrame,
  displayRect,
  pdfRect,
  textFrame,
  imagePlacement,
} from "./coordinates.js";
import { resolveFont, resolveTextRuns, wrapText } from "./fonts.js";
const color = (value = "#111111") => {
  const m = String(value).match(/^#([0-9a-f]{6})$/i);
  const n = m ? m[1] : "111111";
  return rgb(...[0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255));
};
function withFrame(page, frame, fn) {
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...frame.matrix),
  );
  try {
    return fn();
  } finally {
    page.pushOperators(popGraphicsState());
  }
}
export async function applyOperations(bytes, operations, { fonts = {} } = {}) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const operation of operations) {
    const { type } = operation;
    if (type === "pages") {
      if (operation.action === "duplicate") {
        const [copy] = await pdf.copyPages(pdf, [operation.index]);
        pdf.insertPage(operation.index + 1, copy);
      } else applyPages(pdf, operation);
      continue;
    }
    if (type === "insert") {
      const source = await PDFDocument.load(operation.bytes);
      const pages = await pdf.copyPages(source, source.getPageIndices());
      pages.forEach((p, i) => pdf.insertPage(operation.index + i, p));
      continue;
    }
    if (type === "metadata") {
      for (const [key, value] of Object.entries(operation.values)) {
        const setter = {
          title: "setTitle",
          author: "setAuthor",
          subject: "setSubject",
          keywords: "setKeywords",
          creator: "setCreator",
        }[key];
        if (setter)
          pdf[setter](
            key === "keywords"
              ? String(value)
                  .split(",")
                  .map((s) => s.trim())
              : String(value),
          );
      }
      continue;
    }
    const page = pdf.getPage(Number(operation.page || 1) - 1),
      frame = displayFrame(page, Number(operation.viewerRotation) || 0);
    if (type === "text") {
      const box = displayRect(frame, operation),
        text = String(operation.text ?? "").replace(/\r/g, "");
      const size = Math.max(
        2,
        Math.min(
          144,
          Number(operation.fontSize) ||
            Number(operation.fontScale) * frame.height ||
            14,
        ),
      );
      const local = textFrame(box, Number(operation.rotation) || 0),
        horizontalScale = Math.max(
          0.4,
          Math.min(2, Number(operation.horizontalScale) || 1),
        );
      const lines = text ? await layoutStyledText(pdf, text, operation, fonts, size, local.width / horizontalScale) : [];
      const baseline = Number(operation.sourceBaselineOffset) * frame.height || size;
      const lineHeight = Number(operation.lineHeightScale) * frame.height || size*1.2;
      if (text && (lines.some(line=>line.width>local.width/horizontalScale+.75) || baseline+(lines.length-1)*lineHeight>local.height+size*.35))
        throw new Error('Text exceeds its selected region. Resize the text box or reduce the font size before saving.');
      if (!operation.isNew) removeSimpleTextRun(pdf,page,operation,frame);
      withFrame(page, frame, () => {
        if (!operation.isNew) {
          const covers = operation.sourceCoverRects?.length ? operation.sourceCoverRects : [{
            x: operation.coverX ?? operation.x,
            y: operation.coverY ?? operation.y,
            width: operation.coverWidth || operation.width,
            height: operation.coverHeight || operation.height,
            backgroundColor: operation.sourceBackgroundColor || operation.backgroundColor || '#FFFFFF',
          }];
          for (const cover of covers) page.drawRectangle({
            ...displayRect(frame, cover),
            color: color(cover.backgroundColor),
          });
        }
        if (text) {
          const baseline = operation.rotation
            ? size
            : Number(operation.sourceBaselineOffset) * frame.height || size;
          const lineHeight =
            Number(operation.lineHeightScale) * frame.height || size * 1.2;
          page.pushOperators(
            pushGraphicsState(),
            concatTransformationMatrix(...local.matrix),
            concatTransformationMatrix(horizontalScale, 0, 0, 1, 0, 0),
          );
          lines.forEach((line, index) => {
            if (!line.runs.length) return;
            const align = operation.alignment || "left",
              available = local.width / horizontalScale,
              offset =
                align === "center"
                  ? (available - line.width) / 2
                  : align === "right"
                    ? available - line.width
                    : 0;
            let cursor = offset;
            for (const run of line.runs) {
              page.drawText(run.text, {
                x: cursor,
                y: local.height - baseline - index * lineHeight,
                size: run.size,
                font: run.font,
                color: color(run.color),
              });
              cursor += run.width;
            }
          });
          page.pushOperators(popGraphicsState());
        }
      });
      continue;
    }
    if (type === "image") {
      const data = operation.replacementData || operation.sourceData;
      const image =
        data && !operation.deleted
          ? operation.replacementType === "image/jpeg"
            ? await pdf.embedJpg(data)
            : await pdf.embedPng(data)
          : null;
      withFrame(page, frame, () => {
        if (!operation.isNew)
          page.drawRectangle({
            ...displayRect(frame, operation.original || operation),
            color: color(operation.backgroundColor || "#FFFFFF"),
          });
        if (image) {
          const bounds = displayRect(frame, operation);
          page.pushOperators(pushGraphicsState(), rectangle(bounds.x, bounds.y, bounds.width, bounds.height), clip(), endPath(), concatTransformationMatrix(...imagePlacement(frame, operation)));
          page.drawImage(image, { x: 0, y: 0, width: 1, height: 1 });
          page.pushOperators(popGraphicsState());
        }
      });
      continue;
    }
    if (type === "annotation") {
      const c = color(operation.color),
        thickness = Number(operation.thickness) || 2,
        opacity = Number(operation.opacity ?? 0.5);
      withFrame(page, frame, () => {
        if (
          operation.kind === "draw" ||
          operation.kind === "line" ||
          operation.kind === "arrow"
        ) {
          const points = operation.points || [];
          for (let i = 1; i < points.length; i++)
            page.drawLine({
              start: {
                x: points[i - 1][0] * frame.width,
                y: (1 - points[i - 1][1]) * frame.height,
              },
              end: {
                x: points[i][0] * frame.width,
                y: (1 - points[i][1]) * frame.height,
              },
              color: c,
              thickness,
              opacity,
            });
          if (operation.kind === "arrow" && points.length > 1) {
            const end = points.at(-1),
              start = points.at(-2),
              a = Math.atan2(
                (start[1] - end[1]) * frame.height,
                (end[0] - start[0]) * frame.width,
              );
            for (const delta of [-0.5, 0.5])
              page.drawLine({
                start: {
                  x: end[0] * frame.width,
                  y: (1 - end[1]) * frame.height,
                },
                end: {
                  x: end[0] * frame.width - 12 * Math.cos(a + delta),
                  y: (1 - end[1]) * frame.height - 12 * Math.sin(a + delta),
                },
                color: c,
                thickness,
                opacity,
              });
          }
          return;
        }
        const box = displayRect(frame, operation);
        if (operation.kind === "ellipse")
          page.drawEllipse({
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
            xScale: box.width / 2,
            yScale: box.height / 2,
            borderColor: c,
            borderWidth: thickness,
            borderOpacity: opacity,
          });
        else if (["underline", "strike"].includes(operation.kind))
          page.drawLine({
            start: {
              x: box.x,
              y: box.y + (operation.kind === "strike" ? box.height / 2 : 0),
            },
            end: {
              x: box.x + box.width,
              y: box.y + (operation.kind === "strike" ? box.height / 2 : 0),
            },
            color: c,
            thickness,
            opacity,
          });
        else
          page.drawRectangle({
            ...box,
            ...(operation.kind === "highlight"
              ? { color: c, opacity }
              : {
                  borderColor: c,
                  borderWidth: thickness,
                  borderOpacity: opacity,
                }),
          });
      });
      if (operation.kind === "comment") {
        const rect = pdfRect(frame, operation);
        const note = pdf.context.obj({
          Type: "Annot",
          Subtype: "Text",
          Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
          Contents: PDFHexString.fromText(String(operation.text || "")),
          Name: "Comment",
          C: [1, 0.8, 0],
          P: page.ref,
        });
        page.node.addAnnot(pdf.context.register(note));
      }
      continue;
    }
    if (type === "form-update") {
      const form = pdf.getForm(), field = form.getField(operation.originalName || operation.name);
      if (operation.deleted) { form.removeField(field); continue; }
      if (operation.name !== field.getName()) {
        if (form.getFieldMaybe(operation.name)) throw new Error(`Field name already exists: ${operation.name}`);
        const prefix = field.getName().split('.').slice(0,-1).join('.');
        if (prefix && !operation.name.startsWith(prefix+'.')) throw new Error('Keep the existing field group prefix when renaming.');
        field.acroField.setPartialName(prefix ? operation.name.slice(prefix.length+1) : operation.name);
      }
      const widgets=field.acroField.getWidgets();
      const widget=widgets.find(w => `${pdf.context.getObjectRef(w.dict)?.objectNumber}R`===operation.widgetId);
      if (!widget) throw new Error('The selected form widget is no longer available.');
      widget.setRectangle(pdfRect(frame,operation));
      if (operation.required !== undefined) operation.required ? field.enableRequired() : field.disableRequired();
      if (operation.readOnly !== undefined) operation.readOnly ? field.enableReadOnly() : field.disableReadOnly();
      if (operation.multiline !== undefined && field.enableMultiline) operation.multiline ? field.enableMultiline() : field.disableMultiline();
      if (operation.choices && field.setOptions) field.setOptions(operation.choices);
      form.markFieldAsDirty(field.ref);
      continue;
    }
    if (type === "form-create") {
      const form = pdf.getForm(), name = String(operation.name || '').trim(), box = pdfRect(frame, operation);
      if (!name || name.includes('.')) throw new Error('New fields need a unique name without dots.');
      if (form.getFieldMaybe(name)) throw new Error(`Field name already exists: ${name}`);
      const kinds={text:'createTextField',checkbox:'createCheckBox',dropdown:'createDropdown',list:'createOptionList',radio:'createRadioGroup'};
      if (!kinds[operation.kind]) throw new Error(`Unsupported field type: ${operation.kind}`);
      const field=form[kinds[operation.kind]](name);
      if (operation.kind==='dropdown'||operation.kind==='list') field.addOptions(operation.choices || ['Option 1','Option 2']);
      if (operation.required) field.enableRequired();
      if (operation.readOnly) field.enableReadOnly();
      if (operation.multiline && field.enableMultiline) field.enableMultiline();
      if (operation.kind==='radio') {
        // A radio group owns distinct widgets and export values.
        const choices=operation.choices || ['Option 1','Option 2'];
        choices.forEach((choice,index)=>field.addOptionToPage(choice,page,{...box,x:box.x+index*box.width/choices.length,width:box.width/choices.length,borderWidth:1}));
      } else field.addToPage(page,{...box,borderWidth:1});
      continue;
    }
    if (type === "forms") {
      const form = pdf.getForm();
      for (const [name, value] of Object.entries(operation.values)) {
        const field = form.getField(name);
        if (field.setText) field.setText(String(value));
        else if (field.check)
          value === true || value === "true" ? field.check() : field.uncheck();
        else if (field.select)
          field.select(Array.isArray(value) ? value : String(value));
      }
      const text = Object.values(operation.values).flat().join(" ");
      form.updateFieldAppearances(await resolveFont(pdf, text, {}, fonts));
      continue;
    }
    throw new Error(`Unsupported editor operation: ${type}`);
  }
  return new Uint8Array(await pdf.save({ addDefaultPage: false }));
}
export function applyPages(pdf, operation) {
  const index = Number(operation.index),
    pages = pdf.getPages();
  if (operation.action === "rotate") {
    const page = pages[index];
    page.setRotation(
      degrees((page.getRotation().angle + (operation.angle || 90)) % 360),
    );
  } else if (operation.action === "crop") {
    const page = pages[index],
      rect = pdfRect(displayFrame(page), operation.rect);
    page.setCropBox(rect.x, rect.y, rect.width, rect.height);
  } else if (operation.action === "delete") {
    if (pages.length <= 1)
      throw new Error("Keep at least one page in the document.");
    pdf.removePage(index);
  } else if (operation.action === "blank")
    pdf.insertPage(index, operation.size || [612, 792]);
  else if (operation.action === "reorder") {
    const order = operation.order;
    if (
      order.length !== pages.length ||
      new Set(order).size !== pages.length ||
      order.some((n) => !Number.isInteger(n) || !pages[n])
    )
      throw new Error("Page order must contain every page exactly once.");
    for (let i = pages.length - 1; i >= 0; i--) pdf.removePage(i);
    order.forEach((i) => pdf.addPage(pages[i]));
  } else throw new Error("Unknown page operation.");
}
