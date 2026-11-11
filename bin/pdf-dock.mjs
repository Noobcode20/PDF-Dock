#!/usr/bin/env node
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const commands = ['run', 'tools', 'inspect', 'search', 'edit', 'create']
let human = process.stdout.isTTY && !args.includes('--json') && !args.includes('--pretty')
let pretty = args.includes('--pretty')

function usage(command) {
  const examples = {
    inspect: 'inspect document.pdf', search: 'search document.pdf "invoice"',
    create: `create -o blank.pdf --options '{"pageCount":2}'`,
    run: `run compress-pdf input.pdf -o optimized.pdf --options '{"level":"lossless"}'`,
    edit: 'edit --request edit-request.json',
    tools: 'tools --json',
  }
  return `PDF Dock · local PDF tools

Run pdf-dock without arguments for an interactive PDF workspace.

Usage: pdf-dock ${command && examples[command] ? examples[command] : '<command> [arguments] [options]'}

  inspect FILE              Page count and dimensions
  search FILE QUERY         Find text in a PDF
  create -o FILE            Create a blank PDF
  run TOOL FILE...          Process PDFs with a tool
  edit FILE...              Apply JSON editor operations
  tools                     Discover tools and option schemas

  -o, --output PATH         Output file or directory
  --options JSON            Tool options as a JSON object
  --operations JSON         Editor operations as a JSON array
  --request PATH            Read a complete JSON request (- for stdin)
  --force                   Replace existing output files
  --progress                Progress events on stderr
  --json                    Machine JSON output (default when piped)
  --pretty                  Indented JSON output
  --human                   Readable terminal output
  -h, --help                Show help, optionally after a command
  -v, --version             Print version

Examples:
  pdf-dock inspect report.pdf
  pdf-dock search report.pdf "total" --json
  pdf-dock run compress-pdf report.pdf -o small.pdf
  pdf-dock create -o blank.pdf --options '{"pageCount":2}'
  cat request.json | pdf-dock run --json
  pdf-dock run request.json --pretty

Exit codes: 0 success, 1 processing failure, 2 invalid usage.
JSON requests remain supported on stdin or through --request.
`
}

function emit(value) {
  if (!human) return process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`)
  if (value.ok === false) return process.stderr.write(`PDF Dock: ${value.error}\n`)
  process.stdout.write(`PDF Dock · ${value.command || 'done'}\n`)
  if (value.message) process.stdout.write(`${value.message}\n`)
  if (value.data?.tools) {
    for (const tool of value.data.tools) process.stdout.write(`  ${tool.id.padEnd(24)} ${tool.description}\n`)
  } else if (value.data !== undefined) process.stdout.write(`${JSON.stringify(value.data, null, 2)}\n`)
  for (const output of value.outputs || []) process.stdout.write(`  Saved ${output.path} (${output.size} bytes)\n`)
}

async function stdin() {
  if (process.stdin.isTTY) throw new Error('Provide arguments or a JSON request. Run pdf-dock --help for examples.')
  let value = ''
  for await (const chunk of process.stdin) value += chunk
  return value
}

// Terminal design supplied by Luna; kept inline for standalone CLI installation.
const ANSI = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', teal: '\x1b[38;5;37m', blue: '\x1b[38;5;75m', white: '\x1b[38;5;255m', green: '\x1b[38;5;78m', yellow: '\x1b[38;5;221m', red: '\x1b[38;5;203m' }
function colorEnabled() {
  return Boolean(process.stdout.isTTY && !Object.hasOwn(process.env, 'NO_COLOR') && process.env.TERM !== 'dumb')
}
function paint(text, ...styles) {
  return colorEnabled() ? styles.map(style => ANSI[style] || '').join('') + String(text) + ANSI.reset : String(text)
}
function cleanDisplay(value) {
  return String(value ?? '').replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g, '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
}
function fitText(value, width) {
  const text = Array.from(cleanDisplay(value))
  return text.length <= width ? text.join('') : text.slice(0, Math.max(0, width - 1)).join('') + '…'
}
function terminalWidth() { return Math.max(24, Math.min(100, Number(process.stdout.columns) || 80)) }
function sectionTitle(title, width) {
  const label = ` ${title} `
  return paint(label, 'bold', 'teal') + paint('─'.repeat(Math.max(0, width - label.length)), 'dim')
}
function actionLine(key, label, width) {
  const text = `  [${key}] ${label}`
  // Pad before styling so ANSI codes do not disturb column alignment.
  return paint(`  [${key}]`, 'teal') + fitText(` ${label}`, Math.max(0, width - 5)) + ' '.repeat(Math.max(0, width - text.length))
}
function renderHome(files, selected) {
  const width = terminalWidth(), inner = width - 4
  const rule = '  ' + paint('─'.repeat(inner), 'dim')
  const lines = ['', `  ${paint('PDF', 'bold', 'white')} ${paint('DOCK', 'bold', 'teal')}`]
  lines.push('  ' + paint('DOCUMENT WORKBENCH', 'dim'), rule, '')
  if (!files.length) {
    lines.push('  ' + paint(fitText('Your next PDF starts here.', inner), 'bold', 'white'))
    for (const line of ['[a] Add a PDF to begin.', 'Paste a path or drag a file.', 'Edits save to new copies.']) lines.push('  ' + paint(fitText(line, inner), 'dim'))
  } else {
    lines.push('  ' + paint('SESSION FILES', 'bold', 'teal') + paint(`  ${files.length}`, 'dim'), '')
    files.forEach((file, index) => {
      const active = index === selected
      const prefix = `${active ? '›' : ' '} ${index + 1}. `
      const name = fitText(path.basename(file), Math.max(1, inner - prefix.length))
      lines.push('  ' + paint(prefix + name, ...(active ? ['bold', 'teal'] : [])))
      lines.push('  ' + paint(fitText(`     ${file}`, inner), 'dim'))
    })
    lines.push('', '  ' + paint(fitText(`Active · ${path.basename(files[selected] || '')}`, inner), 'blue'))
  }
  lines.push('', rule, '')
  const groups = [
    { title: 'FILES', actions: [['a', 'Add PDF'], ['s', 'Select'], ['x', 'Remove']] },
    { title: 'READ & CREATE', actions: [['i', 'Inspect'], ['f', 'Find text'], ['c', 'Create']] },
    { title: 'EDIT', actions: [['r', 'Rotate'], ['d', 'Delete pages'], ['w', 'Watermark']] },
    { title: 'PAGES & OUTPUT', actions: [['e', 'Extract pages'], ['m', 'Merge'], ['z', 'Compress']] },
  ]
  if (width < 76) {
    for (const group of groups) {
      lines.push('  ' + sectionTitle(group.title, inner))
      for (const [key, label] of group.actions) lines.push('  ' + actionLine(key, label, inner))
      lines.push('')
    }
  } else {
    const gap = '    ', col = Math.floor((inner - gap.length) / 2)
    for (let i = 0; i < groups.length; i += 2) {
      const left = groups[i], right = groups[i + 1]
      lines.push('  ' + sectionTitle(left.title, col) + gap + sectionTitle(right.title, col))
      for (let row = 0; row < 3; row++) lines.push('  ' + actionLine(...left.actions[row], col) + gap + actionLine(...right.actions[row], col))
      lines.push('')
    }
  }
  lines.push('  ' + sectionTitle('MORE', inner), '  ' + actionLine('t', 'More tools', inner), '  ' + actionLine('q', 'Quit', inner), '')
  lines.push('  ' + paint(fitText('Enter a key and press Enter', inner), 'dim'), '')
  return lines.join('\n')
}
function prompt(label) { return `  ${paint(cleanDisplay(label), 'bold', 'teal')} ` }
function status(text, kind = 'info') {
  return paint(cleanDisplay(text), { success: 'green', warning: 'yellow', error: 'red', info: 'blue' }[kind] || 'blue')
}

async function interactive() {
  const { createInterface } = await import('node:readline/promises')
  const { stat } = await import('node:fs/promises')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const files = []
  let selected = 0
  let closed = false
  rl.on('close', () => { closed = true })
  const ask = async (label) => {
    if (closed) return null
    try { return (await rl.question(prompt(label))).trim() } catch { return null }
  }
  const add = async () => {
    const answer = await ask('PDF path (drag a file here, or paste its path): ')
    if (!answer) return
    // Accept quoted paths and paths escaped by macOS drag-and-drop.
    const clean = answer.replace(/^(["'])(.*)\1$/, '$2').replace(/\\(.)/g, '$1')
    const file = path.resolve(clean.startsWith('~/') ? path.join(process.env.HOME || '', clean.slice(2)) : clean)
    try {
      if (!(await stat(file)).isFile() || !/\.pdf$/i.test(file)) throw new Error('Choose a PDF file.')
      if (!files.includes(file)) files.push(file)
      selected = files.indexOf(file)
      process.stdout.write(`\n  ${status('Added ' + path.basename(file), 'success')}\n`)
    } catch (error) { process.stdout.write(`\n  ${status('Could not add PDF: ' + error.message, 'error')}\n`) }
  }
  const execute = async (argv) => {
    process.stdout.write(`\n  ${status('Working…')}\n`)
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv, '--human'], { env: process.env, stdio: ['ignore', 'inherit', 'inherit'] })
      child.once('error', (error) => { process.stderr.write(`${error.message}\n`); resolve(1) })
      child.once('close', (code) => resolve(code ?? 1))
    })
    process.stdout.write(`\n  ${status(code === 0 ? 'Done · saved a new copy.' : 'Operation failed · review the message above.', code === 0 ? 'success' : 'error')}\n`)
    return code
  }
  try {
    while (!closed) {
      process.stdout.write(renderHome(files, selected))
      const action = (await ask('Choose an action › '))?.toLowerCase()
      if (action == null || action === 'q' || action === 'quit') break
      if (action === 'a') { await add(); continue }
      if (action === 's' || action === 'x') {
        const index = Number(await ask('PDF number: ')) - 1
        if (!Number.isInteger(index) || index < 0 || index >= files.length) { process.stdout.write('Choose a number from the PDF list.\n'); continue }
        if (action === 's') selected = index
        else { files.splice(index, 1); selected = Math.max(0, Math.min(selected, files.length - 1)) }
        continue
      }
      if (!['i', 'f', 'c', 'r', 'd', 'w', 'e', 'm', 'z', 't'].includes(action)) { process.stdout.write('Choose one of the actions shown above.\n'); continue }
      if (action !== 'c' && action !== 't' && !files.length) { await add(); continue }
      if (action === 'i') { await execute(['inspect', files[selected]]); continue }
      if (action === 'f') {
        const query = await ask('Find text: ')
        if (query) await execute(['search', files[selected], query])
        continue
      }
      let tool, options = {}, inputs = [files[selected]]
      if (action === 'c') {
        const count = await ask('Number of pages [1]: ')
        if (count == null) break
        const pageCount = Number(count || 1)
        if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 500) { process.stdout.write('Enter a page count from 1 to 500.\n'); continue }
        options = { pageCount }
      } else if (action === 't') {
        await execute(['tools'])
        tool = await ask('Tool ID (blank to cancel): ')
        if (!tool) continue
        if (!files.length) { await add(); if (!files.length) continue }
        inputs = [files[selected]]
        const raw = await ask('Options as JSON [ {} ]: ')
        if (raw == null) break
        try { options = JSON.parse(raw || '{}'); if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error() }
        catch { process.stdout.write('Enter a JSON object for options.\n'); continue }
      } else if (action === 'm') {
        if (files.length < 2) { process.stdout.write('Add at least two PDFs before merging.\n'); continue }
        tool = 'merge-pdf'; inputs = [...files]
        process.stdout.write('Merging all PDFs in the order listed above.\n')
      } else if (action === 'z') { tool = 'compress-pdf'; options = { level: 'lossless' } }
      else if (action === 'w') {
        tool = 'add-watermark'
        const text = await ask('Watermark text: ')
        if (!text) continue
        options = { text }
      } else {
        const pages = await ask(action === 'r' ? 'Pages (e.g. 1-3,5; blank for all): ' : 'Pages (e.g. 1-3,5): ')
        if (pages == null) break
        if (action !== 'r' && !pages) continue
        if (action === 'r') {
          const rotation = Number(await ask('Clockwise rotation [90]: ') || 90)
          if (![90, 180, 270].includes(rotation)) { process.stdout.write('Choose 90, 180 or 270.\n'); continue }
          tool = 'rotate-pages'; options = { pages, rotation }
        } else { tool = action === 'd' ? 'delete-pages' : 'extract-pages'; options = { pages } }
      }
      const output = await ask('Save to a new PDF path (blank to cancel): ')
      if (!output) continue
      const target = path.resolve(output.replace(/^(["'])(.*)\1$/, '$2'))
      if (files.includes(target)) { process.stdout.write('Choose a new output path to preserve your source PDFs.\n'); continue }
      const argv = action === 'c' ? ['create'] : ['run', tool, ...inputs]
      const code = await execute([...argv, '-o', target, '--options', JSON.stringify(options)])
      if (code === 0 && /\.pdf$/i.test(target)) {
        const answer = await ask('Add the saved PDF to this workspace? [Y/n]: ')
        if (answer != null && answer.toLowerCase() !== 'n') { if (!files.includes(target)) files.push(target); selected = files.indexOf(target) }
      }
    }
  } finally { rl.close() }
  process.stdout.write('\nPDF Dock closed. Your saved files are on disk.\n')
}

let processing = false
try {
  const flags = {}
  const positional = []
  const boolean = new Set(['--json', '--pretty', '--human', '--force', '--progress', '--help', '-h', '--version', '-v'])
  const valued = new Set(['--output', '-o', '--options', '--operations', '--request'])
  let literal = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--' && !literal) { literal = true; continue }
    if (literal || !arg.startsWith('-') || arg === '-') { positional.push(arg); continue }
    if (boolean.has(arg)) flags[arg] = true
    else if (valued.has(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}.`)
      flags[arg === '-o' ? '--output' : arg] = args[++i]
    } else throw new Error(`Unknown option: ${arg}. Run pdf-dock --help.`)
  }
  if (flags['--human'] && (flags['--json'] || flags['--pretty'])) throw new Error('Choose --human or --json/--pretty.')
  if (flags['--human']) human = true
  const command = positional.shift() || 'run'
  if (!args.length && process.stdin.isTTY && process.stdout.isTTY) { await interactive(); process.exit(0) }
  if (flags['--help'] || flags['-h']) {
    process.stdout.write(usage(positional.length || args.some(a => commands.includes(a)) ? command : null)); process.exit(0)
  }
  if (flags['--version'] || flags['-v']) {
    const version = process.env.PDF_DOCK_VERSION || await readFile(path.join(root, 'package.json'), 'utf8').then(raw => JSON.parse(raw).version).catch(() => 'installed')
    process.stdout.write(`${version}\n`); process.exit(0)
  }
  if (!commands.includes(command)) throw new Error(`Unknown command: ${command}. Run pdf-dock --help.`)
  const parse = (raw, array = false) => {
    let value
    try { value = JSON.parse(raw) } catch { throw new Error('Invalid JSON. Quote JSON arguments or use --request PATH.') }
    if (!value || typeof value !== 'object' || Array.isArray(value) !== array) throw new Error(`Expected a JSON ${array ? 'array' : 'object'}.`)
    return value
  }
  let request
  const legacyFile = positional.length === 1 && /\.json$/i.test(positional[0])
  const requestPath = flags['--request'] || (legacyFile ? positional.shift() : null)
  if (requestPath || (!positional.length && ['run', 'inspect', 'search', 'edit'].includes(command) && !flags['--options'] && !flags['--operations'])) {
    if (positional.length) throw new Error('Do not combine --request with positional arguments.')
    request = parse(requestPath && requestPath !== '-' ? await readFile(path.resolve(requestPath), 'utf8') : await stdin())
    request.command ||= command
  } else {
    request = { command }
    if (command === 'inspect' || command === 'search') {
      request.file = positional.shift()
      if (!request.file) throw new Error('Provide an input PDF path.')
      if (command === 'search') { request.query = positional.shift(); if (!request.query) throw new Error('Provide a search query.') }
    } else if (command === 'run' || command === 'edit') {
      if (command === 'run') request.tool = positional.shift()
      request.files = positional.splice(0)
      if (!request.files.length || (command === 'run' && !request.tool)) throw new Error('Provide a tool ID and input files for run, or input files for edit.')
    }
    if (positional.length) throw new Error('Unexpected extra arguments.')
  }
  if (!commands.includes(request.command)) throw new Error(`Unknown request command: ${request.command}.`)
  if (flags['--options']) request.options = parse(flags['--options'])
  if (flags['--operations'] && request.command !== 'edit') throw new Error('--operations is only valid for edit.')
  if (flags['--operations']) request.operations = parse(flags['--operations'], true)
  if (request.command === 'edit' && !request.operations?.length) throw new Error('Provide --operations JSON or operations in the request.')
  if (flags['--output']) request.output = flags['--output']
  if (flags['--force']) request.force = true
  request.progress = flags['--progress'] || request.progress === true
  processing = true
  let electron = process.env.PDF_DOCK_ELECTRON
  let appPath = process.env.PDF_DOCK_APP || root
  if (!electron) {
    try { electron = require('electron') }
    catch {
      const bundle = ['/Applications/PDF Dock.app', path.join(process.env.HOME || '', 'Applications/PDF Dock.app')].find(dir => existsSync(path.join(dir, 'Contents/MacOS/PDF Dock')))
      if (!bundle) throw new Error('PDF Dock runtime not found. Install the desktop app or run from the source checkout.')
      electron = path.join(bundle, 'Contents/MacOS/PDF Dock')
      appPath = path.join(bundle, 'Contents/Resources/app.asar')
    }
  }
  const childEnv = { ...process.env, PDF_DOCK_CLI_REQUEST: JSON.stringify(request), PDFKING_USE_BUILD: '1' }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [appPath, '--pdf-dock-cli'], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    process.stderr.write(chunk)
  })
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('PDF Dock CLI timed out while processing the request.')) }, 120000)
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code) => { clearTimeout(timeout); resolve(code ?? 1) })
  })
  const resultLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!resultLine) throw new Error(stderr.trim() || 'PDF Dock did not return a result.')
  let result
  try { result = JSON.parse(resultLine) } catch { throw new Error(`PDF Dock returned invalid JSON: ${resultLine.slice(0, 500)}`) }
  emit(result)
  if (exitCode !== 0 || result.ok === false) process.exitCode = processing ? 1 : 2
} catch (error) {
  emit({ ok: false, error: error.message || String(error) })
  process.exitCode = processing ? 1 : 2
}
