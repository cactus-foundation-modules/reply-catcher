import type { ThreadMessageContribution } from '@/modules/contact-form/lib/types'
import { listCaughtRepliesBySubmission } from './db'

// Contributes to the "contact-form.thread-messages" extension point so caught
// replies render inline in the core inbox's chronological thread rather than
// a separate, always-below block.
export async function getCaughtReplyThreadMessages(submissionId: string): Promise<ThreadMessageContribution[]> {
  const replies = await listCaughtRepliesBySubmission(submissionId)
  return replies.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    senderLabel: r.senderType === 'admin' ? 'You (caught from your mailbox)' : (r.externalEmail ?? 'Submitter'),
    body: r.body,
    badge: 'Caught',
  }))
}
