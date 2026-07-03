import type { ImapFlow, MessageEnvelopeObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import EmailReplyParser from 'email-reply-parser'
import { connectMailbox, resolveFolders } from './imap'
import {
  getMailboxConfig,
  getMaxProcessedUid,
  markMessageProcessed,
  findRecentSubmissionsByEmail,
  insertCaughtReply,
  markSubmissionUnread,
  recordPollResult,
} from './db'
import type { PollResult } from './types'

// How far back to look on a folder's very first poll (no prior UID marker yet).
// Keeps the first run from trying to ingest a mailbox's entire history.
const FIRST_RUN_LOOKBACK_DAYS = 30

function stripReplyPrefixes(subject: string): string {
  return subject.replace(/^(re|fwd?)\s*:\s*/gi, '').trim()
}

// Matching is a best-effort heuristic, not strict header threading - this
// module never touches contact-form's schema, so there's no Message-ID of
// contact-form's own outbound replies for it to thread against. Among a
// sender's recent submissions, prefer one whose subject line overlaps the
// reply's subject; otherwise fall back to the most recent submission from
// that address. A brand-new email that isn't a genuine "reply" (no shared
// subject text) from someone with no recent submission won't match at all.
async function findBestSubmissionMatch(email: string, replySubject: string): Promise<string | null> {
  const candidates = await findRecentSubmissionsByEmail(email)
  if (candidates.length === 0) return null

  const cleanedReplySubject = stripReplyPrefixes(replySubject).toLowerCase()
  if (cleanedReplySubject) {
    const bySubject = candidates.find(
      (c) => c.subject && cleanedReplySubject.includes(c.subject.toLowerCase())
    )
    if (bySubject) return bySubject.id
  }
  return candidates[0]!.id
}

async function resolveUidRange(client: ImapFlow, folder: string): Promise<number[] | { range: string } | null> {
  const maxUid = await getMaxProcessedUid(folder)
  if (maxUid !== null) {
    return { range: `${maxUid + 1}:*` }
  }
  const since = new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
  const uids = await client.search({ since }, { uid: true })
  if (!uids || uids.length === 0) return null
  return uids
}

async function processFolder(
  client: ImapFlow,
  folder: string,
  senderTypeForFolder: 'submitter' | 'admin',
  mailboxUsername: string,
  counts: { scanned: number; matched: number; unmatched: number }
): Promise<void> {
  const lock = await client.getMailboxLock(folder)
  try {
    const range = await resolveUidRange(client, folder)
    if (range === null) return

    const fetchRange = Array.isArray(range) ? range : range.range

    // ImapFlow can't run a second command (e.g. fetchOne below) while this
    // fetch()'s response stream is still open on the same connection - doing
    // so deadlocks silently with no error and no timeout. So drain the
    // envelope-only listing fully into an array first, then issue any
    // follow-up per-message commands afterwards, once this loop has closed.
    const messages: { uid: number; envelope: MessageEnvelopeObject | undefined }[] = []
    for await (const message of client.fetch(fetchRange, { uid: true, envelope: true }, { uid: true })) {
      messages.push({ uid: message.uid, envelope: message.envelope })
    }

    for (const { uid, envelope } of messages) {
      counts.scanned++

      const subject = envelope?.subject ?? ''

      // For an Inbox message, the person we're matching against is whoever sent
      // it (the submitter). For a Sent-folder message, it's whoever it was sent
      // to - and it only counts if it really came from the configured mailbox
      // (otherwise it's someone else's sent mail - a shared inbox, a delegate -
      // and shouldn't be attributed as ours).
      let counterpartEmail: string | undefined
      if (senderTypeForFolder === 'submitter') {
        counterpartEmail = envelope?.from?.[0]?.address
      } else {
        const fromAddress = envelope?.from?.[0]?.address?.toLowerCase()
        if (fromAddress === mailboxUsername.toLowerCase()) {
          counterpartEmail = envelope?.to?.[0]?.address
        }
      }

      if (!counterpartEmail) {
        await markMessageProcessed({ uid, folder, messageIdHeader: envelope?.messageId ?? null, matchedSubmissionId: null })
        continue
      }

      const submissionId = await findBestSubmissionMatch(counterpartEmail, subject)
      if (!submissionId) {
        counts.unmatched++
        await markMessageProcessed({ uid, folder, messageIdHeader: envelope?.messageId ?? null, matchedSubmissionId: null })
        continue
      }

      // Only fetch and parse the full message body for genuine matches - keeps
      // routine scanning of a large mailbox cheap.
      const full = await client.fetchOne(String(uid), { source: true }, { uid: true })
      const rawText = full && full.source ? (await simpleParser(full.source)).text ?? '' : ''
      const strippedBody = rawText ? new EmailReplyParser().parseReply(rawText) : ''
      const body = strippedBody.trim() || rawText.trim() || '(no text content)'

      await insertCaughtReply({
        submissionId,
        body,
        senderType: senderTypeForFolder,
        externalEmail: senderTypeForFolder === 'submitter' ? counterpartEmail : null,
      })
      if (senderTypeForFolder === 'submitter') {
        await markSubmissionUnread(submissionId)
      }

      counts.matched++
      await markMessageProcessed({ uid, folder, messageIdHeader: envelope?.messageId ?? null, matchedSubmissionId: submissionId })
    }
  } finally {
    lock.release()
  }
}

// ImapFlow throws a generic "Command failed" Error for any NO/BAD IMAP
// response and puts the server's actual reason on non-standard `responseText`
// / `executedCommand` properties instead of the message. Without this, every
// IMAP-side failure (bad folder name, disabled capability, throttling, etc.)
// surfaces to the admin as the same useless "Command failed" string.
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error'
  const responseText = (err as { responseText?: string }).responseText
  const executedCommand = (err as { executedCommand?: string }).executedCommand
  if (!responseText) return err.message
  const command = executedCommand?.trim().split(/\s+/)[1]
  return command ? `${err.message} (${command}): ${responseText}` : `${err.message}: ${responseText}`
}

export async function pollMailbox(): Promise<PollResult> {
  const counts = { scanned: 0, matched: 0, unmatched: 0 }

  let client: ImapFlow | null = null
  try {
    const config = await getMailboxConfig()
    if (!config || !config.provider || !config.imapUsername) {
      throw new Error('No mailbox is configured yet.')
    }

    client = await connectMailbox()
    const folders = await resolveFolders(client, { inboxFolder: config.inboxFolder, sentFolder: config.sentFolder })

    await processFolder(client, folders.inbox, 'submitter', config.imapUsername, counts)
    if (folders.sent) {
      await processFolder(client, folders.sent, 'admin', config.imapUsername, counts)
    }

    await client.logout()
    await recordPollResult({ status: 'ok' })
    return { ok: true, ...counts }
  } catch (err) {
    const message = describeError(err)
    try {
      if (client) await client.logout()
    } catch { /* ignore */ }
    await recordPollResult({ status: 'error', error: message })
    return { ok: false, ...counts, error: message }
  }
}
