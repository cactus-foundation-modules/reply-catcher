'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function FetchLatestRepliesButton() {
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function checkNow() {
    setChecking(true)
    setMessage(null)
    const res = await fetch('/api/m/contact-form-reply-catcher/admin/check-now', { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setChecking(false)
    if (res.ok) {
      setMessage(`Checked: ${body.scanned} message(s) scanned, ${body.matched} matched.`)
      router.refresh()
    } else {
      setMessage(body.error ?? 'Check failed.')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.375rem' }}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={checkNow} disabled={checking}>
        {checking ? 'Checking…' : 'Fetch latest replies'}
      </button>
      {message && (
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{message}</div>
      )}
    </div>
  )
}
