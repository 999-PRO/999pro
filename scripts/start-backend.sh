#!/bin/bash
# Backend service launcher (Express + Socket.IO on port 4000)
cd /home/z/my-project/999pro/999pro/mini-services/backend
exec /usr/local/bin/bunx tsx src/index.ts
