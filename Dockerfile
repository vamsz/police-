# syntax=docker/dockerfile:1

# ---- Stage 1: install production dependencies ----
# bcryptjs is pure JS, so there is no native toolchain to install — the build
# stays small and fast, and the runtime image needs no compilers.
FROM node:20-alpine AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- Stage 2: runtime ----
FROM node:20-alpine AS runtime

# Run as an unprivileged user, never root.
RUN addgroup -S rally && adduser -S rally -G rally

ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app

# Dependencies first (rarely change → cached), then source.
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend ./backend
COPY web ./web

# Drop privileges; the app owns nothing it can rewrite.
RUN chown -R rally:rally /app
USER rally

WORKDIR /app/backend
EXPOSE 4000

# Container-native health probe hitting the app's own endpoint.
HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini-free: node handles SIGTERM/SIGINT itself (see server.js graceful shutdown).
CMD ["node", "src/server.js"]
