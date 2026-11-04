# Architecture

| Part | Choice | Why |
|---|---|---|
| Web app and API | Next.js 15 (App Router, server actions), React 19 | One TypeScript codebase for pages and server logic |
| Styling | Tailwind CSS 4 plus the design tokens in `src/app/globals.css` | Matches the approved prototype |
| Database | PostgreSQL 16 with Drizzle ORM | Typed queries; migrations in `drizzle/` |
| Background jobs | BullMQ on Redis (`src/worker`) | Scheduled publishing, retries and per-channel rate limits |
| Sign-in | Better Auth (email with verification, Google) | Sessions in the database, built-in rate limits |
| Media storage | S3-compatible bucket on its own domain (milestone 2) | Uploaded files never run on the app's origin |
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
  worker/              background job runner
```

## Rules every change follows

1. Every page and server action inside a workspace starts with `requireWorkspace(id, permission)`. Non-members get a 404.
2. Post edits always go through `canEditPost`. There is no separate, looser rule for the API.
3. Every query on workspace data filters by `workspaceId`.
4. Secrets are encrypted (`encryptSecret`) or hashed (`sha256`) before they reach the database.
5. Uploaded files go through the single upload pipeline and are served from the media domain.
