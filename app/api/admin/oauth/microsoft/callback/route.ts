import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookie } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { getSiteUrlOrNull } from '@/lib/config/env'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets'
import { getMailboxConfig, storeOAuthTokens } from '@/modules/contact-form-reply-catcher/lib/db'
import { exchangeMicrosoftCode } from '@/modules/contact-form-reply-catcher/lib/oauth-microsoft'

async function adminSettingsRedirect(request: NextRequest, query: string): Promise<NextResponse> {
  const config = await prisma.siteConfig.findUnique({ where: { id: 'singleton' }, select: { adminPath: true } })
  const adminPath = config?.adminPath ?? ''
  const res = NextResponse.redirect(
    new URL(`/${adminPath}/config?tab=contact-form-reply-catcher&${query}`, request.url)
  )
  res.cookies.delete('cactus_rc_oauth_state')
  return res
}

export async function GET(request: NextRequest) {
  const user = await getSessionFromCookie()
  if (!user) return NextResponse.redirect(new URL('/', request.url))

  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const storedState = request.cookies.get('cactus_rc_oauth_state')?.value

  if (!code || !state || !storedState || state !== storedState) {
    return adminSettingsRedirect(request, 'oauth=error&reason=state_mismatch')
  }

  const siteUrl = getSiteUrlOrNull()
  if (!siteUrl) return adminSettingsRedirect(request, 'oauth=error&reason=site_url_missing')

  const config = await getMailboxConfig()
  if (!config?.oauthClientIdEncrypted || !config.oauthClientSecretEncrypted) {
    return adminSettingsRedirect(request, 'oauth=error&reason=client_missing')
  }

  try {
    const clientId = decryptSecret(config.oauthClientIdEncrypted)
    const clientSecret = decryptSecret(config.oauthClientSecretEncrypted)
    const redirectUri = `${siteUrl.replace(/\/$/, '')}/api/m/contact-form-reply-catcher/admin/oauth/microsoft/callback`

    const tokens = await exchangeMicrosoftCode({ clientId, clientSecret, redirectUri, code })
    await storeOAuthTokens({
      accessTokenEncrypted: encryptSecret(tokens.accessToken),
      refreshTokenEncrypted: encryptSecret(tokens.refreshToken),
      expiresAt: tokens.expiresAt,
    })
  } catch (err) {
    // Message only. The thrown error can carry the provider's whole response
    // object, and a failed OAuth exchange is exactly the case where that body may
    // echo back the client secret or a partial token - straight into the log.
    console.error(
      '[contact-form-reply-catcher/oauth] token exchange failed:',
      err instanceof Error ? err.message : 'Unknown error'
    )
    return adminSettingsRedirect(request, 'oauth=error&reason=token_exchange')
  }

  return adminSettingsRedirect(request, 'oauth=connected')
}
