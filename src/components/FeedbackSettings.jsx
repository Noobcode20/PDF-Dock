import React, { useEffect, useRef, useState } from 'react'
import { GITHUB_CLIENT_ID, getConnectedFeedbackMethod, setFeedbackMethod, submitFeedbackReport } from '../feedbackReporting'
import { Icon } from '../icons'
import { ThemedSelect } from './ThemedSelect'

export function FeedbackSettings() {
  const [method, setMethod] = useState('anonymous')
  const [kind, setKind] = useState('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [expected, setExpected] = useState('')
  const [steps, setSteps] = useState('')
  const [moreContext, setMoreContext] = useState(true)
  const [company, setCompany] = useState('')
  const [account, setAccount] = useState(null)
  const [deviceCode, setDeviceCode] = useState(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const pollTimer = useRef(null)

  useEffect(() => {
    let active = true
    Promise.all([
      Promise.resolve(window.pdfKing?.githubGetAccount?.()),
      getConnectedFeedbackMethod(),
    ]).then(([result, preferredMethod]) => {
      if (!active) return
      setAccount(result || null)
      setMethod(result && preferredMethod === 'account' ? 'account' : 'anonymous')
    }).catch(() => { if (active) { setAccount(null); setMethod('anonymous') } })
    return () => { active = false; clearTimeout(pollTimer.current) }
  }, [])

  const connectGitHub = async () => {
    setError(''); setMessage('')
    if (!GITHUB_CLIENT_ID) { setError('GitHub connection is not configured yet. Add VITE_GITHUB_CLIENT_ID and rebuild the app.'); return }
    if (!window.pdfKing?.githubStartDeviceAuth) { setError('GitHub account connection requires the desktop app.'); return }
    setBusy(true)
    try {
      const payload = await window.pdfKing.githubStartDeviceAuth(GITHUB_CLIENT_ID)
      setDeviceCode({ ...payload, expiresAt: Date.now() + payload.expiresIn * 1000 })
      setCodeCopied(false)
      setMessage('Copy the code below, then open GitHub and enter it to finish connecting.')
    } catch (cause) { setError(cause.message || 'Could not connect to GitHub.') }
    finally { setBusy(false) }
  }

  const copyDeviceCode = async () => {
    if (!deviceCode) return
    try {
      try {
        await navigator.clipboard.writeText(deviceCode.userCode)
      } catch {
        const input = document.createElement('textarea')
        input.value = deviceCode.userCode
        input.setAttribute('readonly', '')
        input.style.position = 'fixed'
        input.style.opacity = '0'
        document.body.appendChild(input)
        input.select()
        const copied = document.execCommand('copy')
        input.remove()
        if (!copied) throw new Error('Clipboard access is unavailable. Select and copy the code manually.')
      }
      setCodeCopied(true)
      setError('')
      setMessage('Code copied. Open GitHub and paste it to approve PDF Dock.')
    } catch (cause) { setError(cause.message || 'Could not copy the GitHub code.') }
  }

  const openGitHubAuthorization = async () => {
    if (!deviceCode || !codeCopied) return
    try {
      const opened = await window.pdfKing.openExternal(deviceCode.verificationUri)
      if (opened === false) throw new Error('Could not open GitHub. Copy the code and open the authorization link manually.')
    } catch (cause) { setError(cause.message || 'Could not open GitHub authorization.') }
  }

  useEffect(() => {
    if (!deviceCode) return undefined
    let stopped = false
    const poll = async () => {
      if (stopped) return
      if (Date.now() >= deviceCode.expiresAt) { setDeviceCode(null); setError('GitHub authorization expired. Start again to get a new code.'); return }
      try {
        const result = await window.pdfKing.githubPollDeviceAuth(deviceCode.sessionId)
        if (result.status === 'connected') { setAccount(result.account); setMethod('account'); setFeedbackMethod('account'); setDeviceCode(null); setMessage(`Connected as @${result.account.login}.`); return }
        pollTimer.current = window.setTimeout(poll, result.interval * 1000)
      } catch (cause) { setDeviceCode(null); setError(cause.message || 'GitHub authorization failed.') }
    }
    pollTimer.current = window.setTimeout(poll, deviceCode.interval * 1000)
    return () => { stopped = true; clearTimeout(pollTimer.current) }
  }, [deviceCode])

  const disconnectGitHub = async () => {
    try { await window.pdfKing?.githubClearToken?.(); setAccount(null); setMethod('anonymous'); setFeedbackMethod('anonymous'); setMessage('GitHub account disconnected.') }
    catch (cause) { setError(cause.message || 'Could not disconnect GitHub.') }
  }

  const submit = async (event) => {
    event.preventDefault()
    setError(''); setMessage('')
    const cleanTitle = title.trim()
    const cleanDescription = description.trim()
    if (cleanTitle.length < 4) { setError('Add a title with at least 4 characters.'); return }
    if (cleanDescription.length < 10) { setError('Add a description with at least 10 characters.'); return }
    setBusy(true)
    try {
      const result = await submitFeedbackReport({ method, kind, title: cleanTitle, description: cleanDescription, expected, steps, company })
      setMessage(`Thanks. Your report was submitted: ${result.url}`)
      setTitle(''); setDescription(''); setExpected(''); setSteps('')
    } catch (cause) { setError(cause.message || 'Could not submit your report.') }
    finally { setBusy(false) }
  }

  return <>
    <div className="settings-card feedback-report-card">
      <div className="bug-report-header feedback-report-header"><div className="bug-report-brand"><span className="bug-report-brand-icon"><Icon name="bug" size={20} /></span><span>PDF Dock · Feedback</span></div></div>
      <form className="settings-card-body feedback-form feedback-report-form" onSubmit={submit}>
        <div className="feedback-form-intro"><h2 id="feedback-form-heading">{kind === 'bug' ? 'Something not working?' : 'Have an idea?'}</h2><p>{kind === 'bug' ? 'Tell us what happened. We’ll take it from here.' : 'Tell us what would make PDF Dock more useful.'}</p></div>
        <nav className="bug-report-location feedback-reported-from" aria-label="Reported from"><span className="bug-report-location-label">Reported from</span><span className="bug-report-location-icon" aria-hidden="true">➤</span><span>Settings</span><span className="bug-report-location-separator" aria-hidden="true">›</span><span className="current">Bugs &amp; Requests</span></nav>
        <label className="feedback-field">Type<ThemedSelect value={kind} onChange={(event) => setKind(event.target.value)} options={[{ value: 'bug', label: 'Bug report' }, { value: 'feature', label: 'Feature request' }]} /></label>
        <label className="feedback-honeypot" aria-hidden="true">Company<input tabIndex={-1} autoComplete="off" value={company} onChange={(event) => setCompany(event.target.value)} /></label>
        <label className="bug-report-field">Issue title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder={kind === 'bug' ? "e.g. PDF doesn't open from recent files" : 'What would you like to do?'} required /></label>
        <label className="bug-report-field">{kind === 'bug' ? 'What happened?' : 'What would you like to see?'}<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={10000} rows={5} placeholder={kind === 'bug' ? 'I was trying to open a document, but…' : 'Describe how this would help your workflow.'} required /></label>
        <div className="bug-report-context-row"><button className="bug-report-context-toggle" type="button" aria-expanded={moreContext} onClick={() => setMoreContext((value) => !value)}><Icon className={moreContext ? 'is-expanded' : ''} name="chevron" size={15} />{moreContext ? 'Hide extra context' : 'Add more context'} <small>Optional</small></button></div>
        {moreContext && <div className="bug-report-extra-context"><label className="bug-report-field">What did you expect to happen?<textarea rows={2} maxLength={3000} value={expected} onChange={(event) => setExpected(event.target.value)} placeholder="Optional" /></label><label className="bug-report-field">Steps to reproduce<textarea rows={3} maxLength={5000} value={steps} onChange={(event) => setSteps(event.target.value)} placeholder="Optional. List the steps that led to the problem." /></label></div>}
        {message && <p className="feedback-status" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
        <footer className="bug-report-footer feedback-report-footer"><p className="bug-report-privacy"><Icon name="shield" size={15} />Your documents stay private. We only include what you write and basic app details.</p><div className="bug-report-actions"><button type="submit" className="ghost-button feedback-submit-button" disabled={busy}>{busy ? 'Submitting…' : <><Icon name="arrow" size={15} />Submit report</>}</button></div></footer>
      </form>
    </div>
    <section className="settings-card feedback-github-card" aria-labelledby="feedback-github-heading">
      <div className="settings-card-body">
        <div className="feedback-github-header">
          <h2 className="feedback-section-heading" id="feedback-github-heading"><svg className="feedback-github-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.08c-3.1.68-3.76-1.31-3.76-1.31-.51-1.3-1.24-1.65-1.24-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .1.83 2.02 3.47 1.44.1-.73.39-1.22.7-1.5-2.48-.28-5.09-1.24-5.09-5.51 0-1.22.44-2.22 1.16-3-.12-.28-.5-1.42.11-2.96 0 0 .95-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.11-1.45 3.05-1.15 3.05-1.15.61 1.54.23 2.68.11 2.96.72.78 1.16 1.78 1.16 3 0 4.28-2.61 5.23-5.1 5.5.4.35.75 1.03.75 2.08v3.08c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z" /></svg>Connect GitHub account</h2>
          {account ? <span className="feedback-github-connected-light" role="img" aria-label="GitHub connected" title="GitHub connected" /> : <span className="feedback-optional-label">Optional</span>}
        </div>
        {account ? <div className="feedback-account"><span>Connected as <strong>@{account.login}</strong>. {method === 'account' ? 'Reports use this account.' : 'Reports are sent by PDF Dock.'}</span><button className="ghost-button" type="button" onClick={disconnectGitHub}>Disconnect</button></div> : <div className="feedback-account"><span>Reports are sent by PDF Dock.</span><button className="feedback-connect-button" type="button" disabled={busy || !GITHUB_CLIENT_ID || !window.pdfKing?.githubStartDeviceAuth} onClick={connectGitHub}>{busy ? 'Connecting…' : 'Connect GitHub'}</button></div>}
        {deviceCode && <div className="feedback-device-code"><span>GitHub code</span><strong>{deviceCode.userCode}</strong><button className="ghost-button" type="button" onClick={copyDeviceCode}>{codeCopied ? 'Code copied' : 'Copy code'}</button><button className="ghost-button" type="button" disabled={!codeCopied} onClick={openGitHubAuthorization}>Open GitHub</button></div>}
        {method === 'account' && <p className="feedback-config-note">Submitting reports from your GitHub account adds to your activity in the app.</p>}
      </div>
    </section>
  </>
}
