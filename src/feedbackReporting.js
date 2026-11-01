import packageJson from '../package.json'

export const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID || ''
export const GITHUB_ISSUE_PROXY_URL = (import.meta.env.VITE_GITHUB_ISSUE_PROXY_URL || '').replace(/\/$/, '')
export const GITHUB_REPOSITORY = 'Noobcode20/PDF-Dock'
export const APP_VERSION = packageJson.version

const FEEDBACK_METHOD_KEY = 'pdfdock-feedback-method'

function proxyErrorMessage(message) {
  if (/invalid\s+pkcs8/i.test(String(message || ''))) {
    return 'The reporting service cannot read its GitHub App key yet. Update GITHUB_APP_PRIVATE_KEY on the Cloudflare Worker and deploy the change, then try again.'
  }
  return message || 'GitHub could not create the issue.'
}

export async function getConnectedFeedbackMethod() {
  let savedMethod = ''
  try { savedMethod = window.localStorage.getItem(FEEDBACK_METHOD_KEY) || '' } catch {}
  try {
    const account = await window.pdfKing?.githubGetAccount?.()
    return account && savedMethod !== 'anonymous' ? 'account' : 'anonymous'
  } catch { return 'anonymous' }
}

export function setFeedbackMethod(method) {
  if (!['account', 'anonymous'].includes(method)) return
  try { window.localStorage.setItem(FEEDBACK_METHOD_KEY, method) } catch {}
}

export async function getBugReportPreferredMethod() {
  if (!window.pdfKing?.githubGetAccount) return 'anonymous'
  return await window.pdfKing.githubGetAccount() ? 'account' : 'anonymous'
}

export async function resolveFeedbackMethod(method) {
  if (method === 'anonymous') return 'anonymous'
  if (!window.pdfKing?.githubGetAccount || !window.pdfKing?.githubCreateIssue) throw new Error('GitHub account reporting is available in the PDF Dock desktop app. Choose no-account reporting to submit without connecting GitHub.')
  const account = await window.pdfKing.githubGetAccount()
  if (account) return 'account'
  throw new Error('Connect your GitHub account in Settings → Bugs & Requests, or choose no-account reporting.')
}

export async function submitFeedbackReport({ method, kind = 'bug', title, description, context = '', expected = '', steps = '', company = '' }) {
  const cleanTitle = String(title || '').trim()
  const cleanDescription = String(description || '').trim()
  if (cleanTitle.length < 4 || cleanTitle.length > 160) throw new Error('Title must be between 4 and 160 characters.')
  if (cleanDescription.length < 10 || cleanDescription.length > 10000) throw new Error('Details must be between 10 and 10,000 characters.')

  const body = [
    `## ${kind === 'feature' ? 'Feature request' : 'Bug report'}`,
    '', cleanDescription,
    ...(expected.trim() ? ['', '### Expected behavior', '', expected.trim()] : []),
    ...(steps.trim() ? ['', '### Steps to reproduce', '', steps.trim()] : []),
    ...(context.trim() ? ['', '### App context', '', context.trim()] : []),
    '', '---', `Reported from PDF Dock ${APP_VERSION} (${window.pdfKing?.platform || 'web'}).`,
  ].join('\n')

  const deliveryMethod = await resolveFeedbackMethod(method)

  if (deliveryMethod === 'account') {
    if (!window.pdfKing?.githubGetAccount || !window.pdfKing?.githubCreateIssue) throw new Error('GitHub account reporting requires the desktop app.')
    const account = await window.pdfKing.githubGetAccount()
    if (!account) throw new Error('Connect your GitHub account in Settings → Bugs & Requests before submitting.')
    const result = await window.pdfKing.githubCreateIssue({
      repository: GITHUB_REPOSITORY,
      title: `${kind === 'feature' ? 'Feature request' : 'Bug report'}: ${cleanTitle}`,
      body,
    })
    if (!result?.ok) throw new Error(result?.error || 'GitHub could not create the issue.')
    return { url: result.url }
  }

  if (!GITHUB_ISSUE_PROXY_URL) throw new Error('No-account reporting is not configured yet. The GitHub issue Worker must be deployed before submitting reports this way.')
  const proxyPayload = { kind, title: cleanTitle, description: body, appVersion: APP_VERSION, platform: window.pdfKing?.platform || 'web', company }
  const serializedPayload = JSON.stringify(proxyPayload)
  if (body.length > 20000 || new TextEncoder().encode(serializedPayload).byteLength > 32 * 1024) {
    throw new Error('This report is too long for no-account submission. Shorten the details or remove some optional context and try again.')
  }
  if (window.pdfKing?.githubCreateProxyIssue) {
    let result
    try { result = await window.pdfKing.githubCreateProxyIssue(GITHUB_ISSUE_PROXY_URL, proxyPayload) }
    catch (error) { throw new Error(proxyErrorMessage(error?.message)) }
    if (!result?.url) throw new Error(proxyErrorMessage(result?.error))
    return { url: result.url }
  }
  const response = await fetch(GITHUB_ISSUE_PROXY_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: serializedPayload,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || !result.url) throw new Error(proxyErrorMessage(result.error || `GitHub could not create the issue (HTTP ${response.status}).`))
  return { url: result.url }
}
