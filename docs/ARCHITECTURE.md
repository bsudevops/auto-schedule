# Architecture

| Part | Choice | Why |
|---|---|---|
| Web app and API | Next.js 15 (App Router, server actions), React 19 | One TypeScript codebase for pages and server logic |
| Styling | Tailwind CSS 4 plus the design tokens in `src/app/globals.css` | Matches the approved prototype |
| Database | PostgreSQL 16 with Drizzle ORM | Typed queries; migrations in `drizzle/` |
| Background jobs | BullMQ on Redis (`src/worker`) | Scheduled publishing, retries and per-channel rate limits |
| Sign-in | Better Auth (email with verification, Google) | Sessions in the database, built-in rate limits |
| Media storage | S3-compatible bucket on its own domain | Uploaded files never run on the app's origin |
| Fonts | Bundled with the app | No third-party requests |

## Layout

```
src/
  app/                 pages, layouts and server actions
    (auth)/            sign in, sign up, password reset
    w/[workspaceId]/   everything inside a workspace
    actions/           server actions (each one checks permissions first)
  components/          shared UI
  db/                  schema, migrations runner, demo seed
  lib/
    permissions.ts     the only place roles and permissions are defined
    session.ts         requireUser / requireWorkspace, used by every page and action
    crypto.ts          token encryption and API key hashing
    client-ip.ts       real client IP behind trusted proxies
    queue-slots.ts     next open queue slot in the workspace time zone
    publishing/        one adapter per platform (OAuth + publish), the job runner, token refresh, rate limits
    jobs.ts            the publish queue (job ID = post target ID, so a target is never queued twice)
    notify.ts          in-app and email notifications, respecting each user's preferences
    analytics*.ts      analytics loading and the pure maths behind it (totals, sorting, CSV)
    inbox.ts           replies, assignment and thread state for the unified inbox
    webhooks.ts        outgoing webhook events, signed with HMAC-SHA256
    safe-http.ts       the only way the server calls user-supplied URLs (public https only, no redirects)
    api-auth.ts        REST API keys: hashed, scoped, rate limited, acting with the creator's current role
    org-deletion.ts    14-day grace period, then the organisation and its data are purged
  app/api/v1/          public REST API (see docs/API.md)
  worker/              background worker: publishing, inbox and insights sync, token refresh, webhooks and cleanup
e2e/                   Playwright browser tests against the demo data
```

## Rules every change follows

1. Every page and server action inside a workspace starts with `requireWorkspace(id, permission)`. Non-members get a 404.
2. Post edits always go through `canEditPost`. There is no separate, looser rule for the API.
3. Every query on workspace data filters by `workspaceId`.
4. Secrets are encrypted (`encryptSecret`) or hashed (`sha256`) before they reach the database.
5. Uploaded files go through the single upload pipeline and are served from the media domain.
6. Platform API calls only happen in `src/lib/publishing`. Each adapter classifies failures as auth, rate, temporary or permanent, which decides retries.
7. OAuth state lives in an encrypted httpOnly cookie bound to the user, workspace and provider. Tokens never reach the browser: the account picker reads them from an encrypted, 15-minute pending row.
8. Any request to a URL a user typed (webhooks) goes through `safePost`, which refuses private and internal addresses.
9. API keys never act with more rights than the person who created them has today.
