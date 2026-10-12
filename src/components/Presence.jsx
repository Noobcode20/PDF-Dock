import React, { useEffect, useState } from 'react'

/** Keep an entering element mounted briefly so its CSS exit animation can finish. */
export function Presence({ present, exitDuration = 180, children }) {
  const [mounted, setMounted] = useState(present)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    if (present) {
      setMounted(true)
      setExiting(false)
      return undefined
    }
    if (!mounted) return undefined
    setExiting(true)
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : exitDuration
    const timer = window.setTimeout(() => {
      setMounted(false)
      setExiting(false)
    }, duration)
    return () => window.clearTimeout(timer)
  }, [present, mounted, exitDuration])

  if (!mounted || !React.isValidElement(children)) return null
  return React.cloneElement(children, {
    'data-presence': exiting ? 'exiting' : 'present',
    'aria-hidden': exiting ? 'true' : undefined,
    inert: exiting,
  })
}
