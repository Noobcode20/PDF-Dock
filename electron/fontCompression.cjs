const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const run = promisify(execFile)

// Optional native font converter. Only its CFF font programs are consumed by
// the renderer, never the rewritten PDF pages or annotations.
async function convertType1Fonts(data) {
  if (!(data instanceof Uint8Array) || data.byteLength > 150 * 1024 * 1024 || data.byteLength < 5) throw new Error('Invalid font conversion input.')
  if (Buffer.from(data.subarray(0, 5)).toString('ascii') !== '%PDF-') throw new Error('Expected a PDF document.')
  const candidates = process.platform === 'win32' ? ['gswin64c.exe', 'gswin32c.exe'] : ['/opt/homebrew/bin/gs', '/usr/local/bin/gs', '/usr/bin/gs', 'gs']
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfking-fonts-'))
  try {
    const input = path.join(directory, 'input.pdf')
    const output = path.join(directory, 'fonts.pdf')
    await fs.writeFile(input, data, { mode: 0o600 })
    for (const binary of candidates) {
      try {
        await run(binary, ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite', '-dPDFSETTINGS=/prepress', '-dSubsetFonts=true', '-dEmbedAllFonts=true', '-dDownsampleColorImages=false', '-dDownsampleGrayImages=false', '-dDownsampleMonoImages=false', `-sOutputFile=${output}`, input], { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true })
        return new Uint8Array(await fs.readFile(output))
      } catch (error) {
        if (error.code !== 'ENOENT') return null
      }
    }
    return null
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
module.exports = { convertType1Fonts }
