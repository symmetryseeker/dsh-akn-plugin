# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS workspace

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY LICENSE ./LICENSE
COPY scripts/deploy-hub.mjs ./scripts/deploy-hub.mjs
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @aen/protocol build \
 && pnpm --filter @aen/local-store build \
 && pnpm --filter @aen/promotion build \
 && pnpm --filter @aen/hub build \
 && pnpm --filter @aen/hub-app build
RUN node scripts/deploy-hub.mjs /opt/aen-hub

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=workspace --chown=node:node /opt/aen-hub ./

USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js", "serve", "--host", "0.0.0.0", "--port", "4173"]
