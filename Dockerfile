# syntax=docker/dockerfile:1

FROM node:22.14-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

FROM node:22.14-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    TRACEBACK_METRICS_HOST=0.0.0.0 \
    TRACEBACK_METRICS_PORT=5566 \
    TRACEBACK_METRICS_DB=/data/metrics-collector.db

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 5566
VOLUME ["/data"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.TRACEBACK_METRICS_PORT||5566)+'/api/public/stats',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/cli/metrics-collector.js"]
