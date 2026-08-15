FROM node:24-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Production stage
FROM node:24-alpine

WORKDIR /app

# Install proc tools for process-level healthchecks
RUN apk add --no-cache procps

# Copy built artifacts from builder
COPY --from=builder /app /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001

# Set ownership
RUN chown -R botuser:nodejs /app
USER botuser

# Expose dashboard port
EXPOSE 8080

# Healthcheck
# Discord-only bot has no local HTTP endpoint by default, so we validate that
# the main bot process is alive inside the container.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s \
  CMD pgrep -f "node bot.js" >/dev/null || exit 1

# Start the bot
CMD ["node", "bot.js"]
