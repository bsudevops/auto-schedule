# Deploying

The product is two processes from one codebase, the **web app** (`next start`) and the **worker** (`src/worker`), plus PostgreSQL 16, Redis 7 and an S3-compatible bucket for media.

## Option A: one server with Docker Compose

Good for a first launch. Needs a Linux server with Docker, a domain pointing at it, and ports 80 and 443 open.

```bash
git clone https://github.com/bsudevops/auto-schedule.git && cd auto-schedule
cp .env.example .env     # fill it in (see the checklist below), and add DOMAIN=app.example.com
docker compose -f docker-compose.prod.yml up -d --build
```

Caddy gets the HTTPS certificate automatically. Migrations run before the app and worker start. Set `TRUSTED_PROXIES=172.16.0.0/12` so client IPs are read from Caddy's headers. To update later: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

## Option C: Vercel

The whole product runs on Vercel with scheduled jobs in place of the worker. See [VERCEL.md](VERCEL.md).

## Option B: managed services

Any host that runs a Docker image works (Render, Railway, Fly.io, AWS ECS, Google Cloud Run for the web app). Use the same image twice:

- web: the default command, behind HTTPS, health check `GET /api/health`
- worker: `node --import tsx src/worker/index.ts`, always on, no public port
- before each release: `node --import tsx src/db/migrate.ts`

Use managed PostgreSQL and Redis, and Cloudflare R2 or AWS S3 for media.

## Checklist before going live

- **Who can sign up:** set `SIGNUP_MODE=invite-only` to close the public sign-up page. People then join only through an invitation sent from inside the app (the invitation must be for the email they sign up with), and addresses in `ADMIN_EMAILS` can always sign up. Create the first admin without any email by running `npm run admin:create -- --email you@company.com --name "Your Name"` on the server (with Docker: `docker compose -f docker-compose.prod.yml exec web npm run admin:create -- --email … --name …`): it asks for a password (hidden), confirms the account, and signing in leads to the company setup screen. The same command resets a lost password.

- `APP_URL` and `BETTER_AUTH_URL`: your `https://` address
- `BETTER_AUTH_SECRET`: 32+ random characters. `TOKEN_ENCRYPTION_KEY`: 32 random bytes, base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Keep a copy of the encryption key somewhere safe: without it, stored channel tokens can't be read and every channel must be reconnected.
- `SMTP_*` and `EMAIL_FROM`: sign-up confirmation, invitations and password resets need real email
- `STORAGE_BACKEND=s3`, the `S3_*` values, and `MEDIA_PUBLIC_URL` on a different domain from the app (for example `https://media.example.com`)
- `TRUSTED_PROXIES`: the address range of your load balancer or proxy
- Platform keys: see [PLATFORM-SETUP.md](PLATFORM-SETUP.md). Leave `PUBLISH_DRY_RUN` unset.
- Never run `npm run db:seed` against production (it refuses to)
- Backups: daily PostgreSQL backups, and versioning on the media bucket

## Optional composer extras

Both are off until their key is set, and the composer hides their buttons until then.

- **Writing help** (draft, improve, shorten, three versions, hashtag ideas): set `ANTHROPIC_API_KEY` from console.anthropic.com. It uses `claude-opus-5-5` unless `ANTHROPIC_MODEL` names another model. Each person can ask 30 times an hour. Suggestions are shown to the person and nothing changes until they pick one. Requests opt into Anthropic's server-side fallback, so a request the main model declines can be answered by another model instead of failing.
- **Write from media** (Gemini): set `GEMINI_API_KEY` from aistudio.google.com/apikey. In the composer's AI panel, Gemini looks at the post's image, carousel (up to 10 images) or video and suggests three captions, three YouTube titles when a YouTube channel is picked, and hashtags. Videos go through Gemini's Files API; the upload is reused for later tries on the same file, and Gemini deletes it by itself after 48 hours. Videos are read at low resolution, which is plenty for a caption and much faster. It uses `gemini-3.8-flash` unless `GEMINI_MODEL` names another model. When that model is overloaded it moves straight on to a backup model (`GEMINI_FALLBACK_MODELS`, or other Flash models the key can use), and a request gives up after about 90 seconds of waiting on Gemini. Each person can ask 20 times an hour. With only `GEMINI_API_KEY` set, writing help uses Gemini too.
- **Free stock photos**: set `PEXELS_API_KEY` from pexels.com/api. Picked photos are copied into the workspace's media library with Pexels' alt text, so they publish like any upload.

Saved hashtag sets need no setup.

## Scaling

- Run more web containers behind the load balancer; they share nothing but the database and Redis.
- Run more workers to publish faster. Due posts are claimed atomically and each channel's job ID is unique, so nothing publishes twice. `WORKER_CONCURRENCY` sets parallel jobs per worker (default 5).
- Redis must keep its data (`appendonly yes`) so queued retries survive restarts.

## What runs on a schedule

| Job | How often |
|---|---|
| Publish due posts | every 15 seconds |
| Inbox sync | every 10 minutes |
| Token refresh and expiry warnings | hourly |
| Analytics sync | every 6 hours |
| Cleanup (publish log 90 days, webhook log 30 days, organizations deleted 14+ days ago) | daily, 03:17 UTC |
