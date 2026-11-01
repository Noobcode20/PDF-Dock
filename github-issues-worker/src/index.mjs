const MAX_TITLE = 160
const MAX_DESCRIPTION = 20000
const MAX_REQUEST_BYTES = 32 * 1024
const GITHUB_REPOSITORY = 'Noobcode20/PDF-Dock'
const IP_LIMIT = 5
const IP_WINDOW_SECONDS = 60 * 60
let cachedInstallationToken = null

function json(body, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // This endpoint is public and does not use cookies or other credentials.
      // A wildcard also handles Electron's opaque `file://` renderer origin.
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      'cache-control': 'no-store',
    },
  })
}

function der(tag, bytes) {
  const length = bytes.length
  const prefix = length < 128 ? [length] : length < 256 ? [0x81, length] : [0x82, length >> 8, length & 255]
  return Uint8Array.from([tag, ...prefix, ...bytes])
}

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

function pemBytes(pem) {
  const normalizedPem = String(pem || '').trim().replace(/\\n/g, '\n').replace(/\r\n?/g, '\n')
  const match = normalizedPem.match(/-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/)
  if (!match) throw new Error('GitHub App private key is missing or is not a complete PEM. Set the complete key, including its BEGIN and END lines, as the production Worker secret and deploy again.')
  if (match[1] === 'ENCRYPTED PRIVATE KEY') throw new Error('GitHub App private key is encrypted. Generate an unencrypted PEM key and replace the production Worker secret.')
  const content = match[2].replace(/\s/g, '')
  const binary = atob(content)
  const keyBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (match[1] !== 'RSA PRIVATE KEY') return keyBytes
  const rsaEncryption = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00])
  return der(0x30, concatBytes(Uint8Array.from([0x02, 0x01, 0x00]), rsaEncryption, der(0x04, keyBytes)))
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function makeAppJwt(env) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_INSTALLATION_ID) throw new Error('GitHub App is not fully configured. Set GITHUB_APP_ID and GITHUB_INSTALLATION_ID as Worker secrets.')
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = base64Url(new TextEncoder().encode(JSON.stringify({ iat: now - 30, exp: now + 540, iss: env.GITHUB_APP_ID })))
  const unsigned = `${header}.${claims}`
  let key
  try {
    key = await crypto.subtle.importKey('pkcs8', pemBytes(env.GITHUB_APP_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  } catch (error) {
    if (/private key|PEM|PKCS#8|PKCS8|key data|DER/i.test(error.message || '')) throw new Error('GitHub App private key could not be read. Replace the production GITHUB_APP_PRIVATE_KEY secret with the complete, unencrypted GitHub App PEM, then deploy a new Worker version.')
    throw error
  }
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)))
  return `${unsigned}.${base64Url(signature)}`
}

async function getInstallationToken(env) {
  if (cachedInstallationToken && cachedInstallationToken.expiresAt > Date.now() + 60_000) return cachedInstallationToken.value
  const jwt = await makeAppJwt(env)
  const response = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${jwt}`, 'x-github-api-version': '2022-11-28' },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.token) throw new Error(data.message || 'GitHub App installation token could not be created.')
  cachedInstallationToken = { value: data.token, expiresAt: Date.parse(data.expires_at) }
  return data.token
}

async function enforceIpLimit(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (!ip) throw new Error('Request IP is unavailable.')
  const window = Math.floor(Date.now() / (IP_WINDOW_SECONDS * 1000))
  const key = `${window}:${await hashIp(ip)}`
  const current = Number(await env.REPORT_LIMITS.get(key) || 0)
  if (current >= IP_LIMIT) return false
  await env.REPORT_LIMITS.put(key, String(current + 1), { expirationTtl: IP_WINDOW_SECONDS + 60 })
  return true
}

async function hashIp(ip) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)))
  return Array.from(bytes.slice(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json({}, 204)
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

    try {
      const rawBody = await request.text()
      if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) return json({ error: 'Report is too large.' }, 413)
      const payload = JSON.parse(rawBody)
      if (typeof payload.company === 'string' && payload.company.trim()) return json({ ok: true }, 200)
      const kind = payload.kind === 'feature' ? 'feature' : payload.kind === 'bug' ? 'bug' : null
      const title = typeof payload.title === 'string' ? payload.title.trim() : ''
      const description = typeof payload.description === 'string' ? payload.description.trim() : ''
      if (!kind || title.length < 4 || title.length > MAX_TITLE || description.length < 10 || description.length > MAX_DESCRIPTION) {
        return json({ error: 'Enter a valid report type, title, and description.' }, 400)
      }
      if (!await enforceIpLimit(request, env)) return json({ error: 'Too many reports from this network. Try again later.' }, 429)

      const token = await getInstallationToken(env)
      const issueTitle = `${kind === 'bug' ? 'Bug' : 'Feature request'}: ${title}`
      const issueBody = [
        `## ${kind === 'bug' ? 'Bug report' : 'Feature request'}`,
        '', description,
        '', '---',
        `Reported from PDF Dock ${String(payload.appVersion || 'unknown').slice(0, 40)} (${String(payload.platform || 'unknown').slice(0, 40)}).`,
        'Submitted without a GitHub account.',
      ].join('\n')
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues`, {
        method: 'POST',
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
        body: JSON.stringify({ title: issueTitle, body: issueBody }),
      })
      const issue = await response.json().catch(() => ({}))
      if (!response.ok || !issue.html_url) throw new Error(issue.message || 'GitHub issue creation failed.')
      return json({ ok: true, url: issue.html_url }, 201)
    } catch (error) {
      const status = error instanceof SyntaxError ? 400 : 502
      return json({ error: status === 400 ? 'Request body must be valid JSON.' : error.message || 'Report could not be submitted.' }, status)
    }
  },
}
