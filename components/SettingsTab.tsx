'use client'

import { useEffect, useState } from 'react'
import { SettingsHeaderActions, SettingsHeaderStatus } from '@/components/admin/SettingsHeaderActions'
import { InfoTip } from '@/components/admin/InfoTip'

type Settings = {
  provider: 'imap' | 'outlook_oauth' | null
  imapHost: string | null
  imapPort: number
  imapUsername: string | null
  hasImapPassword: boolean
  hasOAuthClient: boolean
  hasOAuthConnected: boolean
  inboxFolder: string | null
  sentFolder: string | null
  lastPollAt: string | null
  lastPollStatus: 'ok' | 'error' | null
  lastPollError: string | null
}

const EMPTY: Settings = {
  provider: 'imap',
  imapHost: '',
  imapPort: 993,
  imapUsername: '',
  hasImapPassword: false,
  hasOAuthClient: false,
  hasOAuthConnected: false,
  inboxFolder: '',
  sentFolder: '',
  lastPollAt: null,
  lastPollStatus: null,
  lastPollError: null,
}

export function ReplyCatcherSettingsTab() {
  const [settings, setSettings] = useState<Settings>(EMPTY)
  const [imapPassword, setImapPassword] = useState('')
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    if (params.get('oauth') === 'connected') return 'Outlook mailbox connected.'
    if (params.get('oauth') === 'error') return `Outlook connection failed (${params.get('reason') ?? 'unknown error'}).`
    return null
  })

  useEffect(() => {
    fetch('/api/m/contact-form-reply-catcher/admin/settings')
      .then((r) => r.json())
      .then((data: Settings) => {
        setSettings({ ...EMPTY, ...data, provider: data.provider ?? 'imap' })
        setLoading(false)
      })
  }, [])

  async function save(e?: React.FormEvent) {
    e?.preventDefault()
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/m/contact-form-reply-catcher/admin/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: settings.provider,
        imapHost: settings.imapHost || undefined,
        imapPort: settings.imapPort || undefined,
        imapUsername: settings.imapUsername || undefined,
        imapPassword: imapPassword || undefined,
        oauthClientId: oauthClientId || undefined,
        oauthClientSecret: oauthClientSecret || undefined,
        inboxFolder: settings.inboxFolder ?? '',
        sentFolder: settings.sentFolder ?? '',
      }),
    })
    setSaving(false)
    if (res.ok) {
      setImapPassword('')
      setOauthClientId('')
      setOauthClientSecret('')
      setMessage('Saved.')
      const refreshed = await fetch('/api/m/contact-form-reply-catcher/admin/settings').then((r) => r.json())
      setSettings({ ...EMPTY, ...refreshed })
    } else {
      const body = await res.json().catch(() => ({}))
      setMessage(body.error ?? 'Save failed.')
    }
  }

  async function connectOutlook() {
    const res = await fetch('/api/m/contact-form-reply-catcher/admin/oauth/microsoft/start')
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setMessage(body.error ?? 'Could not start the Outlook connection.')
      return
    }
    const { authorizeUrl } = await res.json()
    window.location.href = authorizeUrl
  }

  async function checkNow() {
    setChecking(true)
    setMessage(null)
    const res = await fetch('/api/m/contact-form-reply-catcher/admin/check-now', { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setChecking(false)
    if (res.ok) {
      setMessage(`Checked: ${body.scanned} message(s) scanned, ${body.matched} matched.`)
      const refreshed = await fetch('/api/m/contact-form-reply-catcher/admin/settings').then((r) => r.json())
      setSettings({ ...EMPTY, ...refreshed })
    } else {
      setMessage(body.error ?? 'Check failed.')
    }
  }

  if (loading) return null

  return (
    <div>

      {message && (
        <div className={`alert ${/fail|error|could not/i.test(message) ? 'alert-danger' : 'alert-info'}`}>{message}</div>
      )}

      <div className="settings-cols">
      <div className="card">
        <div className="card-title">
          Status
          <InfoTip>
            Once a day this reads your real mailbox and threads any replies your visitors (or you, replying by hand) sent
            there back into the contact-form inbox. The mailbox itself is never changed - nothing is marked read, moved
            or deleted.
          </InfoTip>
        </div>
        <div style={{ fontSize: 'var(--text-sm)' }}>
          {settings.lastPollAt
            ? `Last checked ${new Date(settings.lastPollAt).toLocaleString('en-GB')} - ${settings.lastPollStatus === 'ok' ? 'OK' : `error: ${settings.lastPollError}`}`
            : 'Never checked yet.'}
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={checkNow} disabled={checking} style={{ marginTop: '0.75rem' }}>
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>

      <form onSubmit={save} className="card">
        <div className="card-title">Mailbox</div>
        <div className="field field--wide">
          <label>Mailbox type</label>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <label className="settings-check">
              <input
                type="radio"
                checked={settings.provider === 'imap'}
                onChange={() => setSettings((s) => ({ ...s, provider: 'imap' }))}
              />
              IMAP + app password
            </label>
            <label className="settings-check">
              <input
                type="radio"
                checked={settings.provider === 'outlook_oauth'}
                onChange={() => setSettings((s) => ({ ...s, provider: 'outlook_oauth' }))}
              />
              Outlook (OAuth)
            </label>
          </div>
        </div>

        {settings.provider === 'imap' && (
          <>
            <div className="field">
              <label>IMAP host</label>
              <input
                value={settings.imapHost ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, imapHost: e.target.value }))}
                placeholder="imap.mail.me.com"
              />
            </div>
            <div className="field">
              <label>IMAP port</label>
              <input
                type="number"
                value={settings.imapPort}
                onChange={(e) => setSettings((s) => ({ ...s, imapPort: parseInt(e.target.value, 10) || 993 }))}
              />
            </div>
            <div className="field">
              <label>Username / email address</label>
              <input
                value={settings.imapUsername ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, imapUsername: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>
                App password {settings.hasImapPassword && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(already set - leave blank to keep it)</span>}
              </label>
              <input
                type="password"
                value={imapPassword}
                onChange={(e) => setImapPassword(e.target.value)}
                placeholder={settings.hasImapPassword ? '••••••••' : ''}
              />
            </div>
          </>
        )}

        {settings.provider === 'outlook_oauth' && (
          <>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
              Register your own app in the{' '}
              <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>
                Azure Portal
              </a>{' '}
              with the <code>IMAP.AccessAsUser.All</code> and <code>offline_access</code> delegated permissions, then paste its
              client ID and secret below.
            </p>
            <div className="field">
              <label>Mailbox address</label>
              <input
                value={settings.imapUsername ?? ''}
                onChange={(e) => setSettings((s) => ({ ...s, imapUsername: e.target.value }))}
                placeholder="you@yourcompany.com"
              />
            </div>
            <div className="field">
              <label>
                Client ID {settings.hasOAuthClient && <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(already set - leave blank to keep it)</span>}
              </label>
              <input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} />
            </div>
            <div className="field">
              <label>Client secret</label>
              <input type="password" value={oauthClientSecret} onChange={(e) => setOauthClientSecret(e.target.value)} />
            </div>
          </>
        )}

        <div className="field">
          <label>Inbox folder <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional - leave blank to auto-detect)</span></label>
          <input
            value={settings.inboxFolder ?? ''}
            onChange={(e) => setSettings((s) => ({ ...s, inboxFolder: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>Sent folder <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>(optional - leave blank to auto-detect)</span></label>
          <input
            value={settings.sentFolder ?? ''}
            onChange={(e) => setSettings((s) => ({ ...s, sentFolder: e.target.value }))}
          />
        </div>

        <SettingsHeaderActions>
          <SettingsHeaderStatus message={message === 'Saved.' ? message : null} error={message && /fail/i.test(message) ? message : null} />
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </SettingsHeaderActions>
        {settings.provider === 'outlook_oauth' && settings.hasOAuthClient && (
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" onClick={connectOutlook}>
              {settings.hasOAuthConnected ? 'Reconnect Outlook' : 'Connect Outlook'}
            </button>
          </div>
        )}
      </form>
      </div>
    </div>
  )
}
