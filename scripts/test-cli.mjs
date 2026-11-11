import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const dir = await mkdtemp(path.join(tmpdir(), 'pdfdock-cli-test-'))
try {
  const mock = path.join(dir, 'engine')
  await writeFile(mock, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ok:true,command:"test",data:JSON.parse(process.env.PDF_DOCK_CLI_REQUEST)}))', { mode: 0o755 })
  const run = (args, input = '') => {
    const result = spawnSync(process.execPath, ['bin/pdf-dock.mjs', ...args], { input, encoding: 'utf8', env: { ...process.env, PDF_DOCK_ELECTRON: mock } })
    return { ...result, json: () => JSON.parse(result.stdout) }
  }
  assert.match(run(['--help']).stdout, /inspect FILE/)
  assert.equal(run(['--version']).status, 0)
  for (const args of [['wat'], ['inspect', 'a.pdf', '--wat'], ['create', '-o'], ['create', '--options', '[]'], ['edit', 'a.pdf'], ['inspect', 'a.pdf', 'extra'], ['tools', '--human', '--json']]) {
    const r = run(args); assert.equal(r.status, 2, args.join(' ')); assert.equal(r.json().ok, false)
  }
  assert.equal(run(['inspect', 'a b.pdf']).json().data.file, 'a b.pdf')
  assert.equal(run(['search', 'a.pdf', 'two words']).json().data.query, 'two words')
  assert.deepEqual(run(['run', 'merge-pdf', 'a.pdf', 'b.pdf', '-o', 'out.pdf', '--force']).json().data.files, ['a.pdf', 'b.pdf'])
  assert.equal(run(['create', '--options', '{"pageCount":2}']).json().data.options.pageCount, 2)
  assert.equal(run(['run'], '{"command":"inspect","file":"old.pdf"}').json().data.file, 'old.pdf')
  assert.equal(run(['run', '--request', '-'], '{"command":"create"}').json().data.command, 'create')
  assert.equal(run(['inspect', '--', '-file.pdf']).json().data.file, '-file.pdf')
  assert.match(run(['tools', '--human']).stdout, /PDF Dock/)
  console.log('CLI tests passed: help, validation, direct commands, JSON stdin, output modes, literal paths.')
} finally { await rm(dir, { recursive: true, force: true }) }

// Exercise rendering without launching Electron or consuming a user's terminal.
const source = readFileSync('bin/pdf-dock.mjs', 'utf8')
const design = source.slice(source.indexOf('const ANSI ='), source.indexOf('async function interactive'))
for (const width of [40, 60, 80, 100]) {
  const context = vm.createContext({ path, process: { stdout: { isTTY: true, columns: width }, env: {} } })
  const output = vm.runInContext(design + '\nrenderHome(["/tmp/" + "a".repeat(140) + ".pdf"], 0)', context)
  for (const line of output.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) assert.ok(line.length <= width)
  assert.ok(output.includes('\x1b['))
  assert.equal(vm.runInContext('cleanDisplay("file\\u001b[31m\\u0007.pdf")', context), 'file.pdf')
  for (const env of [{ NO_COLOR: '' }, { TERM: 'dumb' }]) {
    context.process.env = env
    assert.ok(!vm.runInContext('renderHome([], 0)', context).includes('\x1b'))
  }
}
console.log('Terminal design checks passed: responsive width, long paths, control characters, color opt-outs.')
