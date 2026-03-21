#!/bin/sh
set -e

echo "Running database migrations..."
bun run scripts/migrate.ts

echo "Running seed..."
bun run scripts/seed.ts

echo "Starting application..."
exec bun run src/index.ts
