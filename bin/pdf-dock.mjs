#!/usr/bin/env node
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const progress = args.includes('--progress')
const pretty = args.includes('--pretty')
const command = args.find((arg) => !arg.startsWith('-')) || 'run'
const requestFile = args.slice(args.indexOf(command) + 1).find((arg) => !arg.startsWith('-'))

function usage() {
  return `PDF Dock CLI — local PDF tools for scripts and agents

Usage:
  pdf-dock run [request.json] [--progress] [--pretty]
  cat request.json | pdf-dock run [--progress]
  pdf-dock tools

Request JSON:
  { "command": "run", "tool": "compress-pdf", "files": ["input.pdf"],
    "options": { "level": "lossless" }, "output": "optimized.pdf" }

Commands:
  run      Run any PDF Dock processing tool with structured options.
  tools    List tool IDs and descriptions as JSON.
  inspect  { "command": "inspect", "file": "input.pdf" }
  search   { "command": "search", "file": "input.pdf", "query": "text" }
  edit     { "command": "edit", "files": ["input.pdf"], "operations": [...] }
  create   { "command": "create", "output": "blank.pdf",
             "options": { "pageSize": "a4", "orientation": "portrait", "pageCount": 1 } }

Results are JSON on stdout. Diagnostics go to stderr. Outputs default to the current
directory; use --force in the request to replace existing files. Run pdf-dock tools
for all supported tool IDs and their descriptions.`
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`)
}

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(usage())
  process.exit(0)
}

let raw
try {
  raw = command === 'tools'
    ? JSON.stringify({ command: 'tools' })
    : requestFile
    ? await readFile(path.resolve(requestFile), 'utf8')
    : await new Promise((resolve, reject) => {
        let value = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', (chunk) => { value += chunk })
        process.stdin.on('end', () => resolve(value))
        process.stdin.on('error', reject)
      })
  if (!raw.trim()) throw new Error('Provide a JSON request on stdin or as a file path.')
  const request = JSON.parse(raw)
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('The request must be a JSON object.')
  if (!request.command) request.command = command
  request.progress = progress || request.progress === true
  const electron = require('electron')
  const childEnv = { ...process.env, PDF_DOCK_CLI_REQUEST: JSON.stringify(request), PDFKING_USE_BUILD: '1' }
  delete childEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [root, '--pdf-dock-cli'], {
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
    child.once('error', reject)
    child.once('exit', (code) => { clearTimeout(timeout); resolve(code ?? 1) })
  })
  const resultLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!resultLine) throw new Error(stderr.trim() || 'PDF Dock did not return a result.')
  let result
  try { result = JSON.parse(resultLine) } catch { throw new Error(`PDF Dock returned invalid JSON: ${resultLine.slice(0, 500)}`) }
  emit(result)
  if (exitCode !== 0 || result.ok === false) process.exitCode = 1
} catch (error) {
  emit({ ok: false, error: error.message || String(error) })
  process.exitCode = 1
}
