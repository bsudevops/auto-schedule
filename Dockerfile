# One image for the web app, the worker and migrations. Pick the role with the command.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` loads server modules, which check their settings. These placeholders exist only in this
# build stage: nothing connects to them, and the real values are passed to the running containers.
RUN DATABASE_URL=postgres://build@127.0.0.1:1/build \
    BETTER_AUTH_SECRET=build-stage-placeholder-not-used-at-runtime \
    BETTER_AUTH_URL=http://localhost:3000 APP_URL=http://localhost:3000 \
    npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN useradd --system --uid 1001 app
COPY --from=build --chown=app /app/package.json /app/package-lock.json ./
COPY --from=build --chown=app /app/node_modules ./node_modules
COPY --from=build --chown=app /app/.next ./.next
COPY --from=build --chown=app /app/src ./src
COPY --from=build --chown=app /app/drizzle ./drizzle
COPY --from=build --chown=app /app/tsconfig.json /app/next.config.ts ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start"]
