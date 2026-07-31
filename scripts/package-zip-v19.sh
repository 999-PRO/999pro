#!/bin/bash
# Package the 999 PRO project v19.0 into a zip file.
# Excludes node_modules, .next, dev.db, .env (secrets!) and other build artefacts.

set -e

PROJECT_DIR="/home/z/my-project/app/999pro"
OUTPUT_ZIP="/home/z/my-project/download/999pro-v19.0.zip"
STAGING_DIR="/tmp/999pro-v19-staging"

echo "=== Packaging 999 PRO v19.0 ==="
echo ""

# Clean staging + ensure output dir exists
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/999pro"
mkdir -p "$(dirname "$OUTPUT_ZIP")"

# Copy project files, excluding heavy/generated/secret artefacts
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
  echo "✓ No .env files in staging (secrets protected)"
fi
echo ""

# Verify .env.example IS included
echo "=== Verifying .env.example files ARE included ==="
find "$STAGING_DIR" -name ".env.example"
echo ""

# Create the zip
echo "=== Creating zip archive ==="
cd "$STAGING_DIR"
zip -r "$OUTPUT_ZIP" "999pro/" -q
echo "✓ Zip created: $OUTPUT_ZIP"
echo ""

# Show final size
ls -lh "$OUTPUT_ZIP"
echo ""

# Show top-level structure of the zip
echo "=== Zip structure (top-level) ==="
unzip -l "$OUTPUT_ZIP" | head -40
echo "..."
echo ""
echo "=== Total entries ==="
unzip -l "$OUTPUT_ZIP" | tail -1
