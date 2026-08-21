# syntax=docker/dockerfile:1
FROM node:24.19.0-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN pnpm prisma:generate && pnpm build && pnpm prune --prod

FROM node:24.19.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S eggship && adduser -S eggship -G eggship
COPY --from=build --chown=eggship:eggship /app/package.json ./package.json
COPY --from=build --chown=eggship:eggship /app/node_modules ./node_modules
COPY --from=build --chown=eggship:eggship /app/dist ./dist
USER eggship
EXPOSE 3000
CMD ["node", "dist/main.js"]
