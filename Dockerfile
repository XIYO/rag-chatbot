FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --production --frozen-lockfile

COPY build ./build

USER bun

EXPOSE 3000

ENV PORT=3000

CMD ["bun", "run", "build/index.js"]
