#!/bin/bash
# Start backend without re-running migrations
cd "$(dirname "$0")"
export NODE_ENV=development
export PORT=4000
exec bunx tsx src/index.ts
