FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --only=production=false

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Only production deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Change ownership
RUN chown -R appuser:appgroup /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/app.js"]
