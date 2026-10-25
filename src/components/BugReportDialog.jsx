import React, { useEffect, useState } from 'react'
import { Presence } from './Presence'
import { Icon } from '../icons'
import { getBugReportPreferredMethod, submitFeedbackReport } from '../feedbackReporting'

export function BugReportDialog({ context, onClose }) {
  const [method, setMethod] = useState('account')
  const [methodReady, setMethodReady] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [expected, setExpected] = useState('')
  const [steps, setSteps] = useState('')
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issueUrl, setIssueUrl] = useState('')
  const [moreContext, setMoreContext] = useState(false)

  useEffect(() => {
    let active = true
    // A context-menu report should use the connected account whenever one is
    // available, regardless of the feedback method previously saved in Settings.
    getBugReportPreferredMethod()
      .then((preferred) => { if (active) { setMethod(preferred); setMethodReady(true); setError('') } })
      .catch(() => {
        if (active) {
          setMethod('anonymous')
          setMethodReady(true)
          setError('Could not verify your GitHub connection. Check Settings → Bugs & Requests, then try again.')
        }
      })
    return () => { active = false }
  }, [])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await submitFeedbackReport({ method, kind: 'bug', title, description, expected, steps, context, company })
      setIssueUrl(result.url)
    } catch (cause) { setError(cause.message || 'Could not submit your bug report.') }
    finally { setBusy(false) }
  }

  const confettiPieces = Array.from({ length: 28 }, (_, index) => ({
    '--confetti-x': `${((index * 37) % 96) + 2}%`,
    '--confetti-delay': `${(index % 7) * 45}ms`,
    '--confetti-duration': `${1050 + (index % 5) * 140}ms`,
    '--confetti-rotate': `${(index * 67) % 360}deg`,
    '--confetti-color': ['#82aaff', '#8dd9bd', '#f4c66a', '#f28b82', '#c6a6f7'][index % 5],
  }))

  return <Presence present exitDuration={160}><div className="bug-report-backdrop" onClick={onClose}>
    <section className="bug-report-dialog" role="dialog" aria-modal="true" aria-labelledby="bug-report-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
      <header className="bug-report-header">
        <div className="bug-report-brand"><span className="bug-report-brand-icon"><Icon name="bug" size={20} /></span><span>PDF Dock · Feedback</span></div>
        <button type="button" className="palette-close-btn" aria-label="Close bug report" onClick={onClose}>×</button>
      </header>
      {issueUrl ? <div className="bug-report-success" role="status" aria-live="polite">
        <div className="bug-report-confetti" aria-hidden="true">{confettiPieces.map((style, index) => <i key={index} style={style} />)}</div>
        <span className="bug-report-success-icon"><Icon name="check" size={24} /></span>
        <div className="bug-report-success-copy">
          <h2>Report submitted</h2>
          <p>Thank you for helping us improve PDF Dock.</p>
        </div>
        <div className="bug-report-success-actions">
          <button className="ghost-button" type="button" onClick={() => window.pdfKing?.openExternal ? window.pdfKing.openExternal(issueUrl) : window.open(issueUrl, '_blank', 'noopener,noreferrer')}>Open GitHub issue</button>
          <button className="ghost-button" type="button" onClick={onClose}>Done</button>
        </div>
      </div> : <form className="bug-report-form" onSubmit={submit}>
        <div className="bug-report-intro"><h2 id="bug-report-title">Something not working?</h2><p>Tell us what happened. We’ll take it from here.</p></div>
        <nav className="bug-report-location" aria-label="Click location"><span className="bug-report-location-label">Reported from</span><span className="bug-report-location-icon" aria-hidden="true">➤</span>{String(context || 'PDF Dock').split(/\s*[·/>›]\s*/).filter(Boolean).map((part, index, parts) => <React.Fragment key={`${part}-${index}`}>{index > 0 && <span className="bug-report-location-separator" aria-hidden="true">›</span>}<span className={index === parts.length - 1 ? 'current' : ''}>{part}</span></React.Fragment>)}</nav>
        <label className="bug-report-field">Issue title<input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. PDF doesn't open from recent files" /></label>
        <label className="bug-report-field">What happened?<textarea required rows={5} maxLength={10000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="I was trying to open a document, but…" /></label>
        <div className="bug-report-context-row"><button className="bug-report-context-toggle" type="button" aria-expanded={moreContext} onClick={() => setMoreContext((value) => !value)}><Icon className={moreContext ? 'is-expanded' : ''} name="chevron" size={15} />{moreContext ? 'Hide extra context' : 'Add more context'} <small>Optional</small></button></div>
        {moreContext && <div className="bug-report-extra-context"><label className="bug-report-field">What did you expect to happen?<textarea rows={2} maxLength={3000} value={expected} onChange={(event) => setExpected(event.target.value)} placeholder="Optional" /></label><label className="bug-report-field">Steps to reproduce<textarea rows={3} maxLength={5000} value={steps} onChange={(event) => setSteps(event.target.value)} placeholder="Optional. List the steps that led to the problem." /></label></div>}
        <label className="feedback-honeypot" aria-hidden="true">Company<input tabIndex={-1} autoComplete="off" value={company} onChange={(event) => setCompany(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="bug-report-footer"><p className="bug-report-privacy"><Icon name="shield" size={15} />Your documents stay private. We only include what you write and basic app details.</p><div className="bug-report-actions"><button type="submit" className="ghost-button" disabled={!methodReady || busy || title.trim().length < 4 || description.trim().length < 10}><Icon name="arrow" size={15} />{!methodReady ? 'Checking GitHub…' : busy ? 'Submitting…' : 'Submit report'}</button></div></footer>
      </form>}
    </section>
  </div></Presence>
}
