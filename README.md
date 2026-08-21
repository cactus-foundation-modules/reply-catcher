<p align="center">
  <img src="module-art.webp" alt="Cactus Reply Catcher" width="640" />
</p>

# Cactus Reply Catcher

A [Cactus](https://github.com/usersaynoso/cactus-foundation) module that closes the loop on the
[contact form module](https://github.com/cactus-foundation-modules/contact-form). When a site admin
replies to a submission from the Cactus admin inbox, the visitor's reply-to lands in the admin's own
real mailbox (Gmail, Outlook, iCloud, whatever they use day to day) - not in Cactus. Reply Catcher
polls that mailbox and matches incoming (and personally-sent) mail back to the right submission, so
the conversation stays visible from the admin side.

It never mutates the mailbox it polls - no mark-read, no move, no delete. It only reads.

## How it fits together

This module is a **companion**, not an extension, of `contact-form`. It hard-depends on it
(`requiresModules` in `cactus.module.json`, enforced by Cactus's install/uninstall routes) but never
alters `contact-form`'s schema, code, or admin pages. All matched replies live in this module's own
`rc_caught_replies` table, and are shown on this module's own **Caught Replies** admin page - which
links out to the original conversation in the Contact Form inbox. A site running plain `contact-form`
without this module installed carries zero trace of it.

Because of that separation, matching is a **best-effort heuristic** (sender email address + subject-line
overlap against the submitter's recent submissions), not strict email-threading-header matching - this
module has no way to read `contact-form`'s internal reply IDs, by design. See "Matching limitations"
below.

## Requirements

- `contact-form` module installed and active (any version)
- `ENCRYPTION_KEY` environment variable set on the Cactus install (used to encrypt mailbox credentials
  at rest - same mechanism the GitHub App connection uses)
- Optionally, `CRON_SECRET` set, to enable the daily automatic poll (see "Polling" below)

## Installation

Install like any other Cactus module: **Admin → Modules → Install**, paste
`https://github.com/cactus-foundation-modules/contact-form-reply-catcher`. Cactus checks out the code,
runs `migrations/001_initial.sql`, and registers the `replycatcher.manage` permission. Installation is
rejected if `contact-form` isn't already installed and active.

## Setup

Go to **Reply Catcher → Settings** in the admin and choose how to connect:

- **IMAP + app password** - works with most providers (iCloud, Fastmail, most business hosting).
  Generate an app-specific password from your provider, then supply host, port, username, and
  password.
- **Outlook (OAuth)** - Gmail requires a paid, lengthy CASA security assessment for this kind of
  access, so it isn't supported. Outlook has no equivalent gate: register your own app in the
  [Azure Portal](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
  with the `IMAP.AccessAsUser.All` and `offline_access` delegated permissions, paste the client ID and
  secret into the settings page, then click **Connect Outlook**.

Inbox and Sent folder names are auto-detected via `SPECIAL-USE` IMAP flags where the server supports
it, falling back to a common-name list (`Sent`, `Sent Items`, `Sent Mail`). Both can be overridden
manually in settings if auto-detection picks the wrong folder.

## Polling

- **Daily cron** - declared in `cactus.module.json` (`cronJobs`), collected into the generated
  `vercel.json` at build time, runs at `06:00` UTC. Vercel's Hobby plan caps cron invocations to once
  per day regardless of the declared schedule.
- **Check now** - a manual trigger on the settings page for an on-demand poll, rate-limited to once per
  60 seconds.
- The cron route authenticates via the `CRON_SECRET` environment variable: when set, Vercel
  automatically attaches it as a bearer token to its own cron requests, and the route checks that
  header. No separate secret scheme.

On a folder's first-ever poll there's no prior UID marker to resume from, so it looks back 30 days
rather than ingesting the mailbox's entire history.

## How matching works

For each new message in the Inbox, the sender's address is looked up against `contact-form`'s recent
submissions from that address; if the reply's subject line overlaps a candidate's original subject, that
one wins, otherwise the most recent submission from that address is used. Sent-folder messages are
matched the same way against the recipient address, and only count if the message really came from the
configured mailbox (so a shared mailbox's other traffic isn't misattributed).

Every scanned message - matched or not - is recorded in `rc_processed_messages` so it's never
reprocessed, regardless of whether a match was found.

### Matching limitations

- A visitor who submits the form more than once in a short window, or who changes the subject line
  substantially before replying, may get matched to the wrong (or no) conversation.
- A brand-new email with no relation to any submission won't match anything, by design.
- This is intentionally a lighter-weight trade-off than strict Message-ID/In-Reply-To threading, in
  exchange for never touching `contact-form`'s own schema. See "How it fits together" above.

## Database schema

Table prefix: `rc_`.

| Table | Purpose |
|-------|---------|
| `rc_mailbox_config` | Singleton row: provider, IMAP/OAuth credentials (encrypted), folder overrides, last-poll status |
| `rc_processed_messages` | Dedupe ledger - one row per scanned message (UID + folder), matched or not |
| `rc_caught_replies` | Matched replies, each pointing at a `contact-form` submission via `submission_id` |

All secrets (`imap_password`, OAuth client secret/access/refresh tokens) are encrypted at rest with
AES-256-GCM via Cactus's `ENCRYPTION_KEY`, the same mechanism used for GitHub App credentials.

## Permissions

- `replycatcher.manage` - required for both admin pages (Settings, Caught Replies) and every API route
  in this module.

## Uninstalling

Choose "Remove code and data" to drop all three `rc_` tables (declared in `teardown`). "Remove code
only" preserves them in case the module is reinstalled later.

## License

MIT
