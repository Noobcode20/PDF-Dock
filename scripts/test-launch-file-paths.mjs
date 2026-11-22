import assert from 'node:assert/strict'
import path from 'node:path'
import { isPdfLaunchPath } from '../electron/launchFilePaths.cjs'

assert.ok(isPdfLaunchPath(String.raw`C:\Users\Example\absolute.PDF`, path.win32))
assert.ok(isPdfLaunchPath(String.raw`\\server\share\shared.pdf`, path.win32))
assert.ok(isPdfLaunchPath('/tmp/absolute.pdf', path.posix))
assert.equal(isPdfLaunchPath('relative.pdf', path.win32), false)
assert.equal(isPdfLaunchPath(String.raw`C:\Users\Example\notes.txt`, path.win32), false)
assert.equal(isPdfLaunchPath('--flag=document.pdf', path.posix), false)
assert.equal(isPdfLaunchPath(undefined, path.posix), false)
console.log('PDF launch paths accept absolute Windows and POSIX PDFs and ignore other arguments.')
