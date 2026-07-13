# Build context is the REPO ROOT (pnpm workspace), not apps/api — Render's
# "Docker Build Context Directory" must be set to "." with "Dockerfile Path"
# set to "apps/api/Dockerfile". This is required because the workspace
# package @neev/shared has to be present alongside apps/api for pnpm to
# resolve it (see pnpm-workspace.yaml at the repo root).
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Install ONLY what apps/api needs (api + its workspace deps, via pnpm's
# "api..." filter) — apps/web and its much heavier toolchain (vite, playwright,
# tailwind) never enter this image.
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter api...

# @neev/shared ships raw .ts source with no build step (a deliberate
# project decision — see CLAUDE.md) rather than compiled JS, so the runtime
# entrypoint is `tsx src/index.ts`, not `node dist/index.js` — plain node
# cannot resolve/execute extensionless TypeScript imports. tsx is a real
# ("dependencies", not "devDependencies") dependency of apps/api for exactly
# this reason. This also means `tsc` isn't needed at all inside this image;
# CI (.github/workflows/ci.yml) is what gates on typecheck.
FROM deps AS runtime
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /app/apps/api

ENV NODE_ENV=production
EXPOSE 4000
CMD ["pnpm", "start"]
