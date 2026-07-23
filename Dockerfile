ARG NODE_VERSION=24.18.0

FROM node:${NODE_VERSION}-bookworm AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

FROM toolchain AS workspace-manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json

FROM workspace-manifests AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.base.json ./
COPY apps apps
COPY packages packages
RUN pnpm build

FROM workspace-manifests AS api-dependencies
RUN pnpm install --filter @opspulse/api... --prod --frozen-lockfile

FROM workspace-manifests AS worker-dependencies
RUN pnpm install --filter @opspulse/worker... --prod --frozen-lockfile

FROM node:${NODE_VERSION}-bookworm AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-dependencies --chown=node:node /app/ ./
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/packages/contracts/dist packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/database/dist packages/database/dist
COPY --from=build --chown=node:node /app/packages/domain/dist packages/domain/dist
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]

FROM node:${NODE_VERSION}-bookworm AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=worker-dependencies --chown=node:node /app/ ./
COPY --from=build --chown=node:node /app/apps/worker/dist apps/worker/dist
COPY --from=build --chown=node:node /app/packages/contracts/dist packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/database/dist packages/database/dist
COPY --from=build --chown=node:node /app/packages/domain/dist packages/domain/dist
USER node
CMD ["node", "apps/worker/dist/main.js"]

FROM node:${NODE_VERSION}-bookworm AS smoke
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node scripts/smoke-vertical-slice.mjs scripts/smoke-vertical-slice.mjs
USER node
CMD ["node", "scripts/smoke-vertical-slice.mjs"]
