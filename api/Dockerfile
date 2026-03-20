FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

FROM oven/bun:1-alpine AS runner

RUN apk add --no-cache \
  libreoffice-writer \
  font-noto \
  ttf-dejavu \
  ttf-liberation \
  font-carlito \
  fontconfig \
  && fc-cache -f

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 80

ENV PORT=80

CMD ["sh", "-c", "bun run db:migrate && bun run src/index.ts"]
