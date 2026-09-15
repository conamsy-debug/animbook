# AnimBook Web — production image (Next.js standalone).
#
# Build:    docker build -f apps/web/Dockerfile -t animbook-web:latest .
# Run:      docker run --rm -p 3000:3000 \
#             -e NEXT_PUBLIC_API_URL=https://api.animbook.com \
#             animbook-web:latest
#
# Multi-stage:
#   1. deps    — npm install
#   2. build   — `next build` with `output: "standalone"` → .next/standalone
#   3. runtime — minimal node:20-alpine + the standalone bundle

# ---- 1. deps ---------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/domain/package.json ./packages/domain/
COPY apps/mobile/package.json ./apps/mobile/ 2>/dev/null || true
COPY apps/tv/package.json ./apps/tv/ 2>/dev/null || true

RUN npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund
COPY apps/web ./apps/web
COPY packages/domain ./packages/domain

# ---- 2. build --------------------------------------------------------------
FROM deps AS build
WORKDIR /app
ENV NODE_ENV=production

# Build-time public env vars baked into the JS bundle.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
ARG NEXT_PUBLIC_RELEASE

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=$NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
ENV NEXT_PUBLIC_RELEASE=$NEXT_PUBLIC_RELEASE

# Build with the public env in scope.
RUN cd apps/web && npx next build

# ---- 3. runtime ------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone bundle + static assets + public/ folder.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || \
      wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
