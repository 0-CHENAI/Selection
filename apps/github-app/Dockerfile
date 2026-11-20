FROM oven/bun:1.3.10-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js ./
USER bun
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "/app/server.js"]
