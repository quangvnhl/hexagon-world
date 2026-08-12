# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

# Copy package manifests first so the dependency layer remains cacheable.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/server/package.json packages/server/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages


FROM dependencies AS client-build

# NEXT_PUBLIC_* is embedded into the browser bundle at build time.
ARG NEXT_PUBLIC_SERVER_URL=ws://localhost:8910
ENV NEXT_PUBLIC_SERVER_URL=$NEXT_PUBLIC_SERVER_URL

RUN pnpm --filter @hexagon/client build


FROM node:22-alpine AS client

ENV NODE_ENV=production
ENV PORT=3890
ENV HOSTNAME=0.0.0.0
WORKDIR /app/packages/client

# Includes the built shared package and workspace dependencies resolved by pnpm.
COPY --from=client-build /app /app

EXPOSE 3890
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "-p", "3890"]


FROM dependencies AS server-build

RUN pnpm --filter @hexagon/server build


FROM node:22-alpine AS server

ENV NODE_ENV=production
ENV PORT=8910
WORKDIR /app

# @hexagon/shared remains a workspace dependency at runtime, so keep its dist
# together with the server output and the installed workspace dependencies.
COPY --from=server-build /app /app

EXPOSE 8910
CMD ["node", "packages/server/dist/main.js"]
