# BSU Scheduler

Social media planning and publishing for agencies and brands: write once, tailor each channel, schedule, publish, reply and measure.

The product is **BSU Scheduler**. The name lives in `src/lib/brand.ts` (or `NEXT_PUBLIC_BRAND_NAME`), and the logo files are in `docs/brand/`.

- What the product does: [docs/FEATURE-SPEC.md](docs/FEATURE-SPEC.md)
- How the code is organised: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Connecting Instagram, Facebook, LinkedIn and TikTok: [docs/PLATFORM-SETUP.md](docs/PLATFORM-SETUP.md)
- REST API and webhooks: [docs/API.md](docs/API.md)
- Going live: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Run it locally

You need Node 22, PostgreSQL 16 and Redis 7. Docker Compose can run the last two for you.

```bash
cp .env.example .env          # then fill in the secrets it lists
docker compose up -d          # Postgres and Redis on 127.0.0.1 only
npm install
npm run db:migrate
npm run dev                   # http://localhost:3000
npm run worker                # publishing and other background jobs, in a second terminal
npm run media                 # serves uploaded files on :3001 in development
```

A new install starts empty: open the app, create your account on the sign-up page, and the setup screen walks you through your company and first workspace. The first person to sign up owns it.

For development and the end-to-end tests only, `npm run db:seed` fills a local database with a sample workspace (sign in as demo@example.com / demo-password-123). It refuses to run in production.

Without `SMTP_HOST`, emails (sign-up confirmation, invitations, password resets) are printed in the terminal running `npm run dev`.

To try publishing before the platform apps exist, set `PUBLISH_DRY_RUN=true` in `.env`.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

End-to-end browser tests run against a production build with the demo data and dry-run publishing:

```bash
npm run db:seed && npm run build && npm run e2e   # reseed before running again
```

CI runs all of these, plus a Docker image build, on every pull request.
