# --- Stage 1: Install dependencies ---
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# --- Stage 2: Runtime image ---
FROM oven/bun:1-alpine
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src/ ./src/

# Create the .myteam directory structure for scheduler data
RUN mkdir -p .myteam/scheduler/logs .myteam/logs

# Run in daemon mode — the in-process scheduler replaces systemd/launchd
ENV MYTEAM_DAEMON=1

CMD ["bun", "run", "src/index.ts", "daemon"]
