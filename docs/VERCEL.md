# Hosting on Vercel

The whole product can run on Vercel. There is no always-on worker: scheduled jobs (Vercel Cron) do the background work, and uploads go straight from the browser to the storage bucket.

| Part | Where it runs |
|---|---|
| Website, API, MCP endpoint | Vercel |
| Publishing, inbox sync, token refresh, analytics sync, cleanup | Vercel Cron, calling `/api/cron/*` |
| Database | Supabase (or any PostgreSQL) |
| Redis (rate limits) | Upstash |
| Photos and videos | Cloudflare R2 (or any S3-compatible bucket) |
| Email | Resend, Brevo or any SMTP provider |

**Vercel Pro is needed.** The publishing job runs every minute, and the free (Hobby) plan only allows one run a day, so a deploy with `vercel.json` as it is will be refused there. Posts are also sent right after you press Publish now, but scheduled times only work with the every-minute job.

## 1. Accounts and services

**Supabase** (database). Create a project. Under *Connect* copy two addresses and put your database password in them:

- *Transaction pooler* (port 6543) becomes `DATABASE_URL`. This is what the running app uses.
- *Session pooler* (port 5432) becomes `DATABASE_URL_MIGRATE`. Only used to create and update tables.

Add `?sslmode=require` to both. Prepared statements are turned off automatically for port 6543. Use the Pro plan for a real launch: the free plan pauses projects that are idle for a week.

**Upstash** (Redis). Create a database in the same region as Vercel's functions and copy the `rediss://…` address into `REDIS_URL`. It's only used for rate limits here, so the free tier is enough to start.

**Cloudflare R2** (media). Create a bucket and turn on public access for it (a custom domain is best) and copy that address to `MEDIA_PUBLIC_URL`. Create an API token with read and write on the bucket, then set:

```
STORAGE_BACKEND=s3
S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET_NAME=<bucket>
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```

Two bucket settings are required:

1. **CORS**, so browsers may upload to it. Replace the address with your own:

   ```json
   [{ "AllowedOrigins": ["https://app.example.com"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3600 }]
   ```
2. **A lifecycle rule** that deletes objects under the prefix `incoming/` after 1 day. Uploads wait there until they're checked; this clears any that were never finished.

Supabase Storage also speaks the S3 protocol and may work in place of R2, but browser uploads to it haven't been tested.

**Email.** Any SMTP provider (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`). Without it nobody receives sign-up or invitation emails.

## 2. Vercel project

1. *Add New → Project*, pick the GitHub repository. Framework: Next.js.
2. **Build Command:** `npm run db:migrate && npm run build`. This updates the database tables before each deploy; if that fails, the deploy stops and the live version stays as it was.
3. Add the environment variables below, then deploy.

| Variable | Value |
|---|---|
| `APP_URL`, `BETTER_AUTH_URL` | Your `https://` address, the same for both |
| `BETTER_AUTH_SECRET` | 32+ random characters |
| `TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64. Keep a safe copy: without it every channel must be reconnected |
| `DATABASE_URL`, `DATABASE_URL_MIGRATE` | From Supabase, above |
| `REDIS_URL` | From Upstash |
| `CRON_SECRET` | Any long random string. Vercel sends it with each scheduled job |
| `STORAGE_BACKEND`, `S3_*`, `MEDIA_PUBLIC_URL` | From R2, above |
| `SMTP_*`, `EMAIL_FROM` | Your email provider |
| Platform keys (`META_APP_ID`, …) | See [PLATFORM-SETUP.md](PLATFORM-SETUP.md). Callback addresses use your `APP_URL` |

Leave `PUBLISH_DRY_RUN` unset (or `false`) so posts really go out. `JOBS_MODE` isn't needed: on Vercel the scheduled jobs are used automatically.

## 3. Check it works

- *Settings → Cron Jobs* in Vercel lists five jobs. After a minute, the function logs for `/api/cron/tick` show runs.
- Upload a photo and a video in the media library, then schedule a post two minutes ahead on a connected channel.
- If a job answers `401` or `503`, `CRON_SECRET` is missing or doesn't match.

## How it differs from the worker

The jobs do what the worker did (`tick` every minute, inbox every 10 minutes, token refresh hourly, analytics every 6 hours, cleanup daily at 03:17). Retries and waits are kept in the database instead of a queue: a failed publish is tried again after 1, 2 and 4 minutes (4 attempts in all), and webhook deliveries after 30 s doubling (6 attempts). Each run stops starting new work after about 3 minutes, so none runs into Vercel's time limit.

Running the Docker setup with the worker still works as before. To use the worker on a host that sets `VERCEL`, set `JOBS_MODE=queue`.

Any other scheduler can call the same jobs with `POST https://<your-address>/api/cron/<tick|inbox|tokens|insights|purge>` and `Authorization: Bearer <CRON_SECRET>`.
