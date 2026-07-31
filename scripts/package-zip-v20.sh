#!/bin/bash
# Package the 999 PRO project v20.0 into a zip file.
set -e

PROJECT_DIR="/home/z/my-project/app/999pro"
OUTPUT_ZIP="/home/z/my-project/download/999pro-v20.0.zip"
STAGING_DIR="/tmp/999pro-v20-staging"

echo "=== Packaging 999 PRO v20.0 (Final UX Polish) ==="
echo ""

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/999pro"
mkdir -p "$(dirname "$OUTPUT_ZIP")"

cd "$PROJECT_DIR"
echo "Copying project files to staging..."

rsync -a \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='.next-standalone/' \
  --exclude='dist/' \
  --exclude='build/' \
  --exclude='out/' \
  --exclude='logs/' \
  --exclude='*.log' \
  --exclude='dev.log' \
  --exclude='backend.log' \
  --exclude='frontend.log' \
  --exclude='studio.log' \
  --exclude='services.log' \
  --exclude='dev-startup.log' \
  --exclude='*.db' \
  --exclude='*.db-journal' \
  --exclude='*.db-shm' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.production' \
  --exclude='.env.development' \
  --exclude='mini-services/backend/.env' \
  --exclude='mini-services/studio/.env' \
  --exclude='mini-services/backend/uploads/' \
  --exclude='uploads/' \
  --exclude='.vscode/' \
  --exclude='.idea/' \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db' \
  --exclude='coverage/' \
  --exclude='.nyc_output/' \
  --exclude='.turbo/' \
  --exclude='.cache/' \
  --exclude='tsconfig.tsbuildinfo' \
  --exclude='*.tsbuildinfo' \
  --exclude='.git/' \
  --exclude='*.zip' \
  --exclude='bunfig.toml' \
  ./ "$STAGING_DIR/999pro/"

echo "Staging complete. Contents:"
du -sh "$STAGING_DIR/999pro"
echo ""

# Verify .env files are NOT included
echo "=== Verifying .env files are NOT included ==="
FOUND_ENV=$(find "$STAGING_DIR" -name ".env" -type f | head -5)
if [ -n "$FOUND_ENV" ]; then
  echo "WARNING: Found .env files in staging (should be empty):"
  echo "$FOUND_ENV"
  exit 1
else
  echo "OK: No .env files in staging (secrets protected)"
fi
echo ""

# Verify v20 key files are included
echo "=== Verifying v20.0 files are included ==="
for f in \
  "src/components/email-verification-modal.tsx" \
  "src/lib/use-communication-settings.ts" \
  "mini-services/studio/src/components/registration-settings-manager.tsx" \
  "mini-services/studio/src/components/communication-manager.tsx" \
  "RELEASE-NOTES-v20.0.md"; do
  if [ -f "$STAGING_DIR/999pro/$f" ]; then
    echo "  OK: $f"
  else
    echo "  MISSING: $f"
  fi
done
echo ""

# Verify email-verification-banner.tsx is NOT included (removed)
echo "=== Verifying removed files are NOT included ==="
if [ -f "$STAGING_DIR/999pro/src/components/email-verification-banner.tsx" ]; then
  echo "  WARNING: email-verification-banner.tsx still present!"
  exit 1
else
  echo "  OK: email-verification-banner.tsx removed"
fi
echo ""

# Create the zip
echo "=== Creating zip archive ==="
cd "$STAGING_DIR"
zip -r "$OUTPUT_ZIP" "999pro/" -q
echo "OK: Zip created: $OUTPUT_ZIP"
echo ""

ls -lh "$OUTPUT_ZIP"
echo ""

echo "=== Zip structure (top-level) ==="
unzip -l "$OUTPUT_ZIP" | head -30
echo "..."
echo ""
echo "=== Total entries ==="
unzip -l "$OUTPUT_ZIP" | tail -1
