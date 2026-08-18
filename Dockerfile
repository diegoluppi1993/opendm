# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development

ENV NODE_ENV=development
COPY . .
RUN npm run db:generate

FROM dependencies AS builder

COPY . .
RUN npm run build

FROM base AS production-dependencies

ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS runtime

ENV NODE_ENV=production

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/app/generated ./app/generated
COPY --chown=node:node package.json package-lock.json next.config.ts tsconfig.json prisma.config.ts ./
COPY --chown=node:node public ./public
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node lib ./lib
COPY --chown=node:node worker ./worker

USER node

EXPOSE 3000

CMD ["npm", "start", "--", "--hostname", "0.0.0.0"]
