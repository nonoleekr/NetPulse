#!/bin/sh
set -eu

./node_modules/.bin/prisma migrate deploy --config /app/apps/api/prisma.config.ts
exec node /app/apps/api/dist/server.js
