import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { errorResponse } from '@/lib/utils'
import { encryptSecret, isEncryptionKeyUsable } from '@/lib/crypto/secrets'
import { getMailboxConfig, upsertMailboxConfig } from '@/modules/contact-form-reply-catcher/lib/db'

export async function GET() {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'replycatcher.manage')) return errorResponse('Forbidden', 403)

  const config = await getMailboxConfig()

  // Never return decrypted secrets to the client - just whether they're set.
  return NextResponse.json({
    provider: config?.provider ?? null,
    imapHost: config?.imapHost ?? null,
    imapPort: config?.imapPort ?? 993,
    imapUsername: config?.imapUsername ?? null,
    hasImapPassword: !!config?.imapPasswordEncrypted,
    hasOAuthClient: !!(config?.oauthClientIdEncrypted && config?.oauthClientSecretEncrypted),
    hasOAuthConnected: !!config?.oauthRefreshTokenEncrypted,
    inboxFolder: config?.inboxFolder ?? null,
    sentFolder: config?.sentFolder ?? null,
    lastPollAt: config?.lastPollAt ?? null,
    lastPollStatus: config?.lastPollStatus ?? null,
    lastPollError: config?.lastPollError ?? null,
  })
}

const Body = z.object({
  provider: z.enum(['imap', 'outlook_oauth']),
  imapHost: z.string().min(1).optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapUsername: z.string().min(1).optional(),
  imapPassword: z.string().min(1).optional(),
  oauthClientId: z.string().min(1).optional(),
  oauthClientSecret: z.string().min(1).optional(),
  // Empty string clears the override back to auto-detect.
  inboxFolder: z.string().optional(),
  sentFolder: z.string().optional(),
})

export async function PATCH(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return errorResponse('Not authenticated', 401)
  if (!await hasPermission(user, 'replycatcher.manage')) return errorResponse('Forbidden', 403)

  if (!isEncryptionKeyUsable()) {
    return errorResponse('ENCRYPTION_KEY is not set. Add it to your environment before configuring a mailbox.', 503)
  }

  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message ?? 'Invalid input')
  const data = parsed.data

  const existing = await getMailboxConfig()
  if (data.provider === 'imap') {
    if (!data.imapHost && !existing?.imapHost) return errorResponse('IMAP host is required')
    if (!data.imapUsername && !existing?.imapUsername) return errorResponse('IMAP username is required')
  }
  if (data.provider === 'outlook_oauth' && !data.imapUsername && !existing?.imapUsername) {
    return errorResponse('The Outlook mailbox address is required')
  }

  await upsertMailboxConfig({
    provider: data.provider,
    imapHost: data.imapHost,
    imapPort: data.imapPort,
    imapUsername: data.imapUsername,
    imapPasswordEncrypted: data.imapPassword ? encryptSecret(data.imapPassword) : undefined,
    oauthClientIdEncrypted: data.oauthClientId ? encryptSecret(data.oauthClientId) : undefined,
    oauthClientSecretEncrypted: data.oauthClientSecret ? encryptSecret(data.oauthClientSecret) : undefined,
    inboxFolder: data.inboxFolder,
    sentFolder: data.sentFolder,
  })

  return NextResponse.json({ ok: true })
}
