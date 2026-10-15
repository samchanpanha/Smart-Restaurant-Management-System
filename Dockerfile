# ─── Build stage: compile the Vite frontend + native deps ──────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain for better-sqlite3 when a prebuilt binary isn't available.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Fetch native deps for the linux build platform (not the host macOS).
ENV npm_config_platform=linux
ENV npm_config_arch=x64

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop devDependencies (vite, jsdom, oxlint) but keep the compiled
# better-sqlite3 binding for the runtime image.
RUN npm prune --omit=dev

# ─── Runtime stage: lean image, one Express process ────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    RESTORA_DATA=/data
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
# server/ imports helpers from src/lib, so the source tree ships too.
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src

RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
