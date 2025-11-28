# Sniff Server Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/core/package.json ./packages/core/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/config ./packages/config
COPY packages/core ./packages/core
COPY tsconfig.json ./

# Build packages
RUN pnpm --filter @sniff-dev/config build && \
    pnpm --filter @sniff-dev/core build

# Create non-root user with home directory
RUN addgroup -g 1001 -S sniff && \
    adduser -S sniff -u 1001 -G sniff -h /home/sniff && \
    mkdir -p /home/sniff/.sniff && \
    chown -R sniff:sniff /app /home/sniff

USER sniff

# Default port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the server
CMD ["node", "packages/core/dist/bin.js"]
