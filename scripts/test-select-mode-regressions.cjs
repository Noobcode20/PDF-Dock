#!/usr/bin/env node
/* Standalone regression checks for Select mode interactions. Does not require
 * the app toolchain, which is unavailable while package manifests conflict. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/pages/ToolStudioPage.jsx'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8')

async function main() {
  const helperText = fs.readFileSync(path.join(root, 'src/editor/imageInteraction.js'), 'utf8')
  const helper = await import(`data:text/javascript;base64,${Buffer.from(helperText).toString('base64')}`)

  // Image hit targets are present in normal Select mode, but beneath text,
  // annotations, and native form widgets. Explicit Images mode keeps them on top.
  assert.match(source, /imageSelectMode \|\| annotationMode === 'pdf-editor' \? engine\.inspectPdfPageImages/)
  assert.match(source, /imageRegions\.length > 0 && <div className=\{`pdf-image-object-layer \$\{imageSelectMode \? 'is-image-select-mode' : 'is-image-detection-mode'\}`\}/)
  assert.match(styles, /\.pdf-image-object-layer\.is-image-detection-mode\s*\{[^}]*z-index:\s*1;[^}]*pointer-events:\s*none;/)
  assert.match(styles, /\.pdf-image-object-layer\.is-image-detection-mode \.pdf-image-object\s*\{\s*pointer-events:\s*auto;/)
  assert.match(source, /annotationMode!=='form-design' && formFields\.length > 0 && <PdfNativeFormLayer/)
  assert.match(source, /<AnnotationLayer page=\{pageNumber\} mode=\{annotationMode\}/)

  // Image double-click selects/opens without committing a pointer gesture and
  // avoids rereading already-loaded or currently-loading image bytes.
  assert.deepEqual(helper.imageDoubleClickPlan(), {
    select: true, openInspector: true, cancelGesture: true, clearPreview: true, captureSource: true,
  })
  assert.equal(helper.imageDoubleClickPlan({ sourceLoaded: true }).captureSource, false)
  assert.equal(helper.imageDoubleClickPlan({ capturePending: true }).captureSource, false)
  assert.match(source, /onDoubleClick=\{open\}/)
  assert.match(source, /if \(plan\.cancelGesture\) gesture\.current = null/)
  assert.match(source, /if \(plan\.openInspector\) onOpen\?\.\(image\)/)

  // Select-mode text supports double-click editing, while markup tools retain
  // their own gesture semantics. Existing edited text boxes remain editable.
  assert.match(source, /onDoubleClick=\{\(event\) => \{ if\(\['highlight','underline','strike'\]\.includes\(annotationMode\)\)return;/)
  assert.match(source, /onDoubleClick=\{\(event\) => openEditedText\(event, edit\)\}/)
  console.log('Select-mode regression checks passed (image, text, annotation, and form interaction contracts).')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
