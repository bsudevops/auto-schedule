# Feature spec

This spec describes what the product does, written from studying the features of open-source social media schedulers (Brightbean Studio in particular) and the approved UI prototype. **No code, templates, styles or assets were copied from any other project.** Every line in this repository is written from this spec.

Product name: **BSU Scheduler**.

## Who it is for

Agencies, freelancers and small businesses that run social media for several brands or clients. One person may manage many brands, and a team may share the work.

## Concepts

| Concept | Meaning |
|---|---|
| Organization | The agency or company account. Owns workspaces and billing. |
| Workspace | One brand or client. Has its own channels, posts, media, queues and settings. |
| Member | A user in a workspace with one role. |
| Channel | A connected social account (an Instagram profile, a Facebook Page, a LinkedIn page, a TikTok account). |
| Post | Content written once and published to one or more channels. Each channel can override the caption. |
| Queue | A named set of weekly time slots. Adding a post to a queue gives it the next open slot. |
| Idea | A card on the idea board that can later become a post. |

## Roles and permissions

One permission check is used by every entry point (pages, server actions, API, background jobs). There is no second, looser path.

| Permission | Owner | Manager | Editor | Contributor | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| View posts, calendar, analytics | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create posts and ideas | ✓ | ✓ | ✓ | ✓ | |
| Edit or delete other people's posts | ✓ | ✓ | ✓ | | |
| Schedule and publish | ✓ | ✓ | ✓ | | |
| Reply in the inbox | ✓ | ✓ | ✓ | ✓ | |
| Upload and edit media | ✓ | ✓ | ✓ | ✓ | |
| Delete media | ✓ | ✓ | ✓ | | |
| Connect and disconnect channels | ✓ | ✓ | | | |
| Manage members and invitations | ✓ | ✓ | | | |
| Workspace settings and branding | ✓ | ✓ | | | |
| API keys and webhooks | ✓ | ✓ | | | |

Contributors can edit and delete only their own drafts. Nobody can remove or demote a member whose role is higher than their own.

## Screens (from the approved prototype)

1. **Sign in / sign up.** Email and password with email verification, and Google sign-in. Password reset.
2. **Onboarding.** Create the organization and the first workspace, then connect a channel.
3. **Overview.** Upcoming posts, things that need attention (failed posts, expiring connections, unread inbox), recently published posts with reach, channel health, team activity, four headline numbers.
4. **Create post.** Pick channels; write the main caption; switch to a channel tab to override its caption; character counter per channel; media strip; emoji, hashtag sets, AI writing help; category and tags; first comment; live preview per channel; publish now, schedule, or add to queue; save draft.
5. **Calendar.** Month, week and list views; drag a post to another day or hour to reschedule; open queue slots shown as dashed placeholders; queue management (named queues, weekly slots, linked channels, shuffle).
6. **Ideas.** Kanban board with four columns (Ideas, Researching, Writing, Ready to schedule); drag cards between columns; turn a ready idea into a post.
7. **Inbox.** Comments, mentions, direct messages and reviews from every channel; filters (all, unread, assigned to me, negative); sentiment label; assign to a teammate; quick replies; reply; mark done.
8. **Analytics.** Range of 7, 30 or 90 days; filter by one channel or all; KPI cards; daily impressions chart; per-channel table sortable by every column, clicking a row filters by that channel; top posts; CSV export.
9. **Media library.** Folders; grid; upload images and videos; per-channel resized versions made automatically; alt text; stock photo search; use in a post; delete.
10. **Channels.** Connected channels with status (connected, expiring soon, reconnect needed), follower and post counts, rate-limit usage, best posting times, reconnect, disconnect; connect a new channel.
11. **Settings.** Workspace and branding (product name, logo, brand colour, workspace name, time zone, default hashtags and first comment); members and roles (invite, change role, remove, role table); notification preferences (in app, email, webhook per event); API keys and webhooks; organization (workspaces list, Google sign-in, delete organization with a 14-day grace period).
12. **Notifications.** Bell with a drawer; mark all read.

## Left out for now (decided by the product owner)

- **Approval workflows** (internal or client review stages). The data model leaves room to add them later.
- **Client portal** (passwordless review links for clients) and the Client role.

## Publishing

- Platforms in the first release: **Instagram, Facebook, LinkedIn, TikTok**. Later: YouTube, Pinterest, Threads, Bluesky, Google Business Profile, Mastodon, DEV.to.
- Each platform is an adapter with the same interface: connect (OAuth), refresh token, validate post (caption length, media type and count, aspect ratio), publish, fetch metrics, fetch inbox items, reply.
- Publishing runs in a background worker. Each post target (one post on one channel) is its own job, so one channel failing does not block the others.
- Automatic retries with backoff for temporary errors; no retry for permanent errors (bad token, rejected media). A failed target shows the platform's reason in plain words and a Retry button.
- Per-channel rate-limit tracking so jobs wait instead of failing.
- A publish log kept for 90 days.

## Security requirements

These come from the security audit of a comparable app, so we avoid the same mistakes from day one.

1. **Uploads.** Every upload goes through one pipeline: check the real file type from its bytes (not the browser's claim), allow only images and videos, re-encode images, store under a server-chosen name and extension, enforce a size quota. Uploaded files are served from a separate storage domain, never from the app's own origin.
2. **Permissions.** One `can(member, permission)` helper and one `canEditPost(member, post)` helper, used by every page, action, API route and job. Every query is scoped by workspace ID.
3. **Sign-in.** Email verification is required before an email account can sign in, so a Google sign-in can never be linked to an unverified account.
4. **Secrets.** Social tokens are encrypted at rest (AES-256-GCM). API keys are stored as hashes. No default passwords in any config; databases are never exposed to the internet.
5. **Rate limits.** Login, sign-up and API limits keyed on the real client IP, using a trusted-proxy setting rather than whatever `X-Forwarded-For` says.
6. **Outgoing requests.** Any server-side fetch of a user-supplied URL (webhooks, RSS) accepts only public IP addresses and connects to the IP it checked.
7. **Deactivated users** lose API keys and sessions immediately.
8. **Headers.** Strict Content-Security-Policy, HSTS, `X-Content-Type-Options`, `frame-ancestors 'none'`.

## Milestones

1. **Foundation:** project setup, design system, database schema, sign-in, organizations, workspaces, members and roles, app shell, overview with real data, CI.
2. **Posts:** composer, media library with the upload pipeline, calendar, queues, ideas.
3. **Publishing:** worker, the four platform adapters, channel connection, retries, failures, publish log.
4. **Inbox and analytics.**
5. **Settings, notifications, API keys, webhooks, hardening, end-to-end tests, deployment.**
