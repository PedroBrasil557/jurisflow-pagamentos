#!/bin/sh
set -e

echo "Running database migrations..."
bun run scripts/migrate.ts

echo "Starting application..."
exec bun run src/index.ts
