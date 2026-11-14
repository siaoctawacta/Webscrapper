# syntax=docker/dockerfile:1.7
# One image for both processes: `web` (Next.js) and `worker` (background jobs).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
RUN groupadd --system app && useradd --system --gid app --home /app app
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next
COPY --chown=app:app package.json pnpm-lock.yaml next.config.ts tsconfig.json drizzle.config.ts ./
COPY --chown=app:app public ./public
COPY --chown=app:app src ./src
COPY --chown=app:app drizzle ./drizzle
RUN mkdir -p /app/storage/exports && chown -R app:app /app/storage
USER app
EXPOSE 3000
CMD ["pnpm", "start"]
