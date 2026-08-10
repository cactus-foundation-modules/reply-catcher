import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { markdownToHtml } from '@/lib/sanitize'
import { getSubmission } from '@/modules/contact-form/lib/db'
import { listCaughtRepliesBySubmission } from '@/modules/contact-form-reply-catcher/lib/db'

export const metadata = { title: 'Thread — Reply Catcher' }

type Props = { params: Promise<{ id: string }> }

type TimelineEntry = {
  id: string
  createdAt: Date
  label: string
  isCaught: boolean
  body: string
}

export default async function CaughtRepliesThreadPage({ params }: Props) {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'replycatcher.manage')) {
    return <div className="alert alert-danger">You do not have permission to view this page.</div>
  }

  const { id } = await params
  const [submission, caughtReplies] = await Promise.all([
    getSubmission(id),
    listCaughtRepliesBySubmission(id),
  ])
  if (!submission) notFound()

  const adminPath = (await headers()).get('x-cactus-admin-path') ?? ''

  const timeline: TimelineEntry[] = [
    ...submission.replies.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      label: r.sentByDisplayName ?? r.sentByEmail,
      isCaught: false,
      body: r.signatureSnapshot ? `${r.body}\n\n---\n\n${r.signatureSnapshot}` : r.body,
    })),
    ...caughtReplies.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      label: r.senderType === 'submitter' ? (r.externalEmail ?? submission.email) : 'You (caught from your mailbox)',
      isCaught: true,
      body: r.body,
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link href={`/${adminPath}/m/contact-form-reply-catcher/inbox`} className="btn btn-secondary btn-sm">
            ← Caught Replies
          </Link>
          <h1 className="page-title" style={{ margin: 0 }}>
            {submission.subject ?? `Message from ${submission.name}`}
          </h1>
        </div>
        <Link href={`/${adminPath}/m/contact-form/inbox/${id}`} className="btn btn-primary btn-sm">
          Open in Contact Form inbox
        </Link>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
          From
        </div>
        <div style={{ fontWeight: 500 }}>{submission.name}</div>
        <a href={`mailto:${submission.email}`} style={{ fontSize: '0.875rem', color: 'var(--color-primary)' }}>{submission.email}</a>
        <hr style={{ margin: '1rem 0', borderColor: 'var(--color-border)' }} />
        <div className="prose" dangerouslySetInnerHTML={{ __html: markdownToHtml(submission.message, { breaks: true }) }} />
      </div>

      {timeline.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {timeline.map((entry) => (
            <div
              key={entry.id}
              className="card"
              style={{
                borderLeft: `3px solid ${entry.isCaught ? 'var(--color-border-strong)' : 'var(--color-primary)'}`,
                background: entry.isCaught ? 'var(--color-bg-subtle)' : undefined,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {entry.label}
                  {entry.isCaught && (
                    <span style={{
                      fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                      padding: '0.0625rem 0.375rem', borderRadius: '999px',
                      background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)',
                    }}>
                      Caught
                    </span>
                  )}
                </span>
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                  {entry.createdAt.toLocaleString('en-GB')}
                </span>
              </div>
              <div className="prose" style={{ fontSize: '0.9375rem' }} dangerouslySetInnerHTML={{ __html: markdownToHtml(entry.body, { breaks: true }) }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
