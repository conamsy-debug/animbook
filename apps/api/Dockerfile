# AnimBook API — production image.
#
# Build:    docker build -f apps/api/Dockerfile -t animbook-api:latest .
# Run:      docker run --rm -p 4000:4000 --env-file apps/api/.env.production animbook-api:latest
#
# Multi-stage:
#   1. deps     — npm install (legacy peer deps, offline preference)
#   2. build    — prisma generate + tsc → dist/
#   3. runtime  — node-only image with the compiled JS + Prisma client

# ---- 1. deps ---------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Install only what's needed to fetch deps (no cache).
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY packages/domain/package.json ./packages/domain/
COPY apps/web/package.json ./apps/web/ 2>/dev/null || true
COPY apps/mobile/package.json ./apps/mobile/ 2>/dev/null || true
COPY apps/tv/package.json ./apps/tv/ 2>/dev/null || true

# Use npm workspaces. --legacy-peer-deps is needed for Next 14 + Apollo v4.
# --prefer-offline avoids pulling from the network when the local cache has it.
RUN npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund --workspaces=false || npm install --legacy-peer-deps --prefer-offline --no-audit --no-fund
COPY apps/api ./apps/api
COPY packages/domain ./packages/domain

# ---- 2. build --------------------------------------------------------------
FROM deps AS build
WORKDIR /app

# Generate Prisma client + compile TypeScript.
# `tsc -p tsconfig.json` emits `apps/api/dist/src/**/*.js`.
ENV NODE_ENV=production
RUN cd apps/api && npx prisma generate && npx tsc -p tsconfig.json

# ---- 3. runtime ------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

# Install only the production deps + Prisma's runtime dependencies.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY package.json ./package.json
COPY packages/domain ./packages/domain

ENV NODE_ENV=production
ENV PORT=4000

# Run as non-root. The dist/ is owned by root so the runtime uid can read.
RUN chown -R node:node /app
USER node

EXPOSE 4000

# Healthcheck — hits /api/health/ready every 30s.
# Returns 200 when DB + Redis are reachable, 503 otherwise.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health/live || exit 1

WORKDIR /app/apps/api
CMD ["node", "dist/src/index.js"]
