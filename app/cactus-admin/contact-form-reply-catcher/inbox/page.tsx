import Link from 'next/link'
import { headers } from 'next/headers'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { listSubmissionsWithCaughtReplies } from '@/modules/contact-form-reply-catcher/lib/db'
import { FetchLatestRepliesButton } from '@/modules/contact-form-reply-catcher/components/FetchLatestRepliesButton'

export const metadata = { title: 'Caught Replies — Reply Catcher' }

export default async function CaughtRepliesInboxPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'replycatcher.manage')) {
    return <div className="alert alert-danger">You do not have permission to view this page.</div>
  }

  const submissions = await listSubmissionsWithCaughtReplies()
  const adminPath = (await headers()).get('x-cactus-admin-path') ?? ''

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Caught Replies</h1>
        <FetchLatestRepliesButton />
      </div>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
        Conversations where Reply Catcher has picked up a reply from your real mailbox. Each one links
        to a merged view of the whole thread.
      </p>

      {submissions.length === 0 ? (
        <div className="card">Nothing caught yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {submissions.map((s) => (
            <Link
              key={s.submissionId}
              href={`/${adminPath}/m/contact-form-reply-catcher/inbox/${s.submissionId}`}
              className="card"
              style={{ display: 'flex', justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{s.subject ?? `Message from ${s.name}`}</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{s.name} · {s.email}</div>
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                {s.lastCaughtAt.toLocaleString('en-GB')}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
