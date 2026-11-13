FROM node:22.23.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY patches patches
COPY apps/pipeline-image-worker/package.json apps/pipeline-image-worker/package.json
COPY apps/pipeline-image-worker/tsconfig.json apps/pipeline-image-worker/tsconfig.json
COPY apps/pipeline-image-worker/src apps/pipeline-image-worker/src
RUN pnpm install --frozen-lockfile --filter pipeline-image-worker...
RUN pnpm --filter pipeline-image-worker build

FROM node:22.23.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8790
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/pipeline-image-worker /app/apps/pipeline-image-worker
EXPOSE 8790
CMD ["node", "apps/pipeline-image-worker/dist/server.js"]
