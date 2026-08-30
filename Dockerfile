# ---------- build stage: install workspace deps, build the production server ----------
FROM node:24-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS build
WORKDIR /app
RUN corepack enable

# package manifests first for dependency-layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/protocol/package.json packages/protocol/
COPY packages/engine/package.json packages/engine/
COPY packages/cards/package.json packages/cards/
COPY packages/bot/package.json packages/bot/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @fyendal/server...

COPY packages packages
COPY apps/server apps/server
# Workspace packages export their TypeScript sources, so the server's tsc and
# esbuild steps already traverse the package graph it uses. Building every
# workspace here only recompiles that graph and unnecessarily builds the client.
RUN pnpm --filter @fyendal/server build

# ---------- deploy stage: standalone prod-only server (workspace deps inlined) ----------
FROM build AS deploy
# --legacy: workspace doesn't set inject-workspace-packages
RUN pnpm deploy --legacy --filter @fyendal/server --prod /prod/server

# ---------- runtime stage ----------
FROM node:24-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deploy --chown=node:node /prod/server ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT??8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
