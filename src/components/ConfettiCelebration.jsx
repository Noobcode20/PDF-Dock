import React, { useEffect, useState } from 'react'

const COLORS = ['#82aaff', '#8dd9bd', '#f4c66a', '#f28b82', '#c6a6f7']
const PIECES = Array.from({ length: 54 }, (_, index) => {
  const direction = index % 2 === 0 ? 1 : -1
  const startY = 44 + ((index * 17) % 15)
  const rise = 24 + ((index * 19) % 29)
  const spray = 120 + ((index * 43) % 220)
  const fall = 360 + ((index * 31) % 300)
  return {
    '--confetti-left': direction === 1 ? '0px' : 'auto',
    '--confetti-right': direction === 1 ? 'auto' : '0px',
    '--confetti-start-y': `${startY}vh`,
    '--confetti-rise': `-${rise}vh`,
    '--confetti-mid-y': `${(120 - startY - rise) / 2}vh`,
    '--confetti-spray': `${direction * spray}px`,
    '--confetti-fall': `${direction * fall}px`,
    '--confetti-mid-x': `${direction * (spray + fall / 2)}px`,
    '--confetti-delay': `${(index % 9) * 42}ms`,
    '--confetti-duration': `${1850 + (index % 7) * 170}ms`,
    '--confetti-rotate': `${(index * 97) % 900}deg`,
    '--confetti-size': `${6 + (index % 4)}px`,
    '--confetti-color': COLORS[index % COLORS.length],
  }
})

/** A brief, screen-wide celebration for a completed document operation. */
export function ConfettiCelebration({ active }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!active) return undefined
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 2600)
    return () => window.clearTimeout(timer)
  }, [active])

  if (!visible) return null
  return <div className="success-confetti" aria-hidden="true">{PIECES.map((style, index) => <i key={index} style={style} />)}</div>
}
