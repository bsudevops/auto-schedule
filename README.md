# auto-schedule

Social media planning and publishing for agencies and brands: write once, tailor each channel, schedule, publish, reply and measure.

The product name **YourBrand** is a placeholder. Change it in `src/lib/brand.ts` (or set `NEXT_PUBLIC_BRAND_NAME`).

- What the product does: [docs/FEATURE-SPEC.md](docs/FEATURE-SPEC.md)
- How the code is organised: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Run it locally

You need Node 22, PostgreSQL 16 and Redis 7. Docker Compose can run the last two for you.

```bash
cp .env.example .env          # then fill in the secrets it lists
docker compose up -d          # Postgres and Redis on 127.0.0.1 only
npm install
npm run db:migrate
npm run db:seed               # optional demo data: demo@example.com / demo-password-123
npm run dev                   # http://localhost:3000
npm run worker                # background jobs, in a second terminal
```

Without `SMTP_HOST`, emails (sign-up confirmation, invitations, password resets) are printed in the terminal running `npm run dev`.

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

CI runs the same checks on every pull request.
