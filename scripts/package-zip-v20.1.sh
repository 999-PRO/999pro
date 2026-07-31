#!/bin/bash
set -e
PROJECT_DIR="/home/z/my-project/app/999pro"
OUTPUT_ZIP="/home/z/my-project/download/999pro-v20.1.zip"
STAGING_DIR="/tmp/999pro-v201-staging"
echo "=== Packaging 999 PRO v20.1 ==="
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/999pro"
mkdir -p "$(dirname "$OUTPUT_ZIP")"
cd "$PROJECT_DIR"
rsync -a \
  --exclude='node_modules/' --exclude='.next/' --exclude='.next-standalone/' \
  --exclude='dist/' --exclude='build/' --exclude='out/' --exclude='logs/' \
  --exclude='*.log' --exclude='dev.log' --exclude='backend.log' \
  --exclude='frontend.log' --exclude='studio.log' --exclude='services.log' \
  --exclude='dev-startup.log' --exclude='*.db' --exclude='*.db-journal' \
  --exclude='*.db-shm' --exclude='.env' --exclude='.env.local' \
  --exclude='.env.production' --exclude='.env.development' \
  --exclude='mini-services/backend/.env' --exclude='mini-services/studio/.env' \
  --exclude='mini-services/backend/uploads/' --exclude='uploads/' \
  --exclude='.vscode/' --exclude='.idea/' --exclude='.DS_Store' \
  --exclude='Thumbs.db' --exclude='coverage/' --exclude='.nyc_output/' \
  --exclude='.turbo/' --exclude='.cache/' --exclude='tsconfig.tsbuildinfo' \
  --exclude='*.tsbuildinfo' --exclude='.git/' --exclude='*.zip' \
  --exclude='bunfig.toml' \
  ./ "$STAGING_DIR/999pro/"
# Verify .env NOT included
FOUND_ENV=$(find "$STAGING_DIR" -name ".env" -type f | head -5)
if [ -n "$FOUND_ENV" ]; then echo "WARNING: .env found!"; exit 1; fi
echo "OK: No .env files (secrets protected)"
# Verify v20.1 key files
for f in \
  "mini-services/studio/src/components/splash-screen-manager.tsx" \
  "mini-services/studio/src/components/registration-settings-manager.tsx" \
  "mini-services/studio/src/components/communication-manager.tsx" \
  "src/components/email-verification-modal.tsx" \
  "src/lib/use-communication-settings.ts"; do
  [ -f "$STAGING_DIR/999pro/$f" ] && echo "  OK: $f" || echo "  MISSING: $f"
done
cd "$STAGING_DIR"
zip -r "$OUTPUT_ZIP" "999pro/" -q
echo "OK: $OUTPUT_ZIP"
ls -lh "$OUTPUT_ZIP"
unzip -l "$OUTPUT_ZIP" | tail -1
