import React, { useState } from 'react'
import { Icon } from '../icons'
import { THEMES, isLightTheme } from '../themes'

const STEPS = ['Your name', 'Appearance', 'A few preferences']

export function Onboarding({ theme, onSelectTheme, onFinish }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [matchSystem, setMatchSystem] = useState(false)
  const [keepRecent, setKeepRecent] = useState(true)

  const finish = (skip = false) => onFinish({
    name: skip ? '' : name,
    theme,
    matchSystem: skip ? false : matchSystem,
    keepRecent: skip ? true : keepRecent,
  })

  return (
    <div className="onboarding-backdrop">
      <section
        className="onboarding-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
      >
        <aside className="onboarding-aside">
          <div className="onboarding-brand">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span>
            <strong>PDF <em>King</em></strong>
          </div>
          <div className="onboarding-aside-copy">
            <span className="onboarding-eyebrow">A LITTLE SETUP</span>
            <h1 id="onboarding-title">Make this space feel like yours.</h1>
            <p>Choose a name and a look. Anything else here is optional and easy to change later.</p>
          </div>
          <div className="onboarding-aside-note"><Icon name="lock" size={15} /> Your preferences stay on this device.</div>
        </aside>

        <div className="onboarding-main">
          <header className="onboarding-topline">
            <div className="onboarding-progress-label">GETTING STARTED <span>{step + 1} / {STEPS.length}</span></div>
            <button className="onboarding-skip" type="button" onClick={() => finish(true)}>Skip setup</button>
          </header>
          <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((label, index) => <span key={label} className={index <= step ? 'complete' : ''} />)}
          </div>

          <div className="onboarding-step-content" key={step}>
            {step === 0 && (
              <div className="onboarding-name-step">
                <span className="onboarding-step-icon"><Icon name="user" size={19} /></span>
                <div className="onboarding-step-heading">
                  <h2>What should we call you?</h2>
                  <p>Your name appears in your workspace and profile.</p>
                </div>
                <label className="onboarding-field-label" htmlFor="onboarding-name">Your name</label>
                <input
                  id="onboarding-name"
                  className="onboarding-name-input"
                  type="text"
                  autoComplete="given-name"
                  autoFocus
                  maxLength={48}
                  placeholder="Type your name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) setStep(1) }}
                />
                <p className="onboarding-field-hint">You can update this any time in Profile settings.</p>
              </div>
            )}

            {step === 1 && (
              <div className="onboarding-theme-step">
                <span className="onboarding-step-icon"><Icon name={isLightTheme(theme) ? 'sun' : 'moon'} size={19} /></span>
                <div className="onboarding-step-heading">
                  <h2>Pick a color mood</h2>
                  <p>Each palette comes in a light and dark version.</p>
                </div>
                <div className="onboarding-theme-grid">
                  {THEMES.map((option) => (
                    <section className="onboarding-theme-pair" key={option.id}>
                      <div><strong>{option.name}</strong><small>{option.description}</small></div>
                      <div className="onboarding-theme-options">
                        {[[option.light, 'Light'], [option.dark, 'Dark']].map(([id, mode]) => (
                          <button
                            key={id}
                            className={`onboarding-theme-option ${theme === id ? 'selected' : ''}`}
                            data-theme={id}
                            type="button"
                            aria-pressed={theme === id}
                            aria-label={`${option.name} ${mode}`}
                            onClick={() => onSelectTheme(id)}
                          >
                            <span className="onboarding-mini-preview"><i /><i /><b /></span>
                            <span>{mode}</span>
                            {theme === id && <Icon name="check" size={12} />}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="onboarding-preferences-step">
                <span className="onboarding-step-icon"><Icon name="sliders" size={19} /></span>
                <div className="onboarding-step-heading">
                  <h2>Make it work your way</h2>
                  <p>These are optional. You can change them later in Settings.</p>
                </div>
                <label className="onboarding-preference">
                  <span className="onboarding-preference-icon"><Icon name="sun" size={17} /></span>
                  <span className="onboarding-preference-copy"><strong>Follow my device appearance</strong><small>Switch between your chosen light and dark palettes with your system.</small></span>
                  <input type="checkbox" checked={matchSystem} onChange={(event) => setMatchSystem(event.target.checked)} />
                  <span className="onboarding-checkbox" />
                </label>
                <label className="onboarding-preference">
                  <span className="onboarding-preference-icon"><Icon name="clock" size={17} /></span>
                  <span className="onboarding-preference-copy"><strong>Keep a local recent files list</strong><small>Remember PDFs you open on this device for quick access.</small></span>
                  <input type="checkbox" checked={keepRecent} onChange={(event) => setKeepRecent(event.target.checked)} />
                  <span className="onboarding-checkbox" />
                </label>
              </div>
            )}
          </div>

          <footer className="onboarding-footer">
            {step > 0 ? <button type="button" className="onboarding-back" onClick={() => setStep(step - 1)}><Icon name="arrowLeft" size={15} /> Back</button> : <span className="onboarding-footer-note">No work profile or account needed.</span>}
            {step < STEPS.length - 1 ? (
              <button type="button" className="onboarding-continue" disabled={step === 0 && !name.trim()} onClick={() => setStep(step + 1)}>
                Continue <Icon name="arrow" size={15} />
              </button>
            ) : (
              <button type="button" className="onboarding-continue" onClick={() => finish()}>
                Finish setup <Icon name="check" size={15} />
              </button>
            )}
          </footer>
        </div>
      </section>
    </div>
  )
}
