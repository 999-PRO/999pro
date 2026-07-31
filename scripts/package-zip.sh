#!/bin/bash
# Package the 999 PRO project (with AI Assistant v18.5) into a zip file.
# Excludes node_modules, .next, dev.db, .env (secrets!) and other build artefacts.

set -e

PROJECT_DIR="/home/z/my-project"
OUTPUT_ZIP="/home/z/my-project/download/999pro-v18.5-ai-assistant.zip"
STAGING_DIR="/tmp/999pro-staging"

echo "=== Packaging 999 PRO v18.5 (AI Assistant) ==="
echo ""

# Clean staging
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/999pro-v18.5-ai-assistant"

# Copy project files, excluding heavy/generated/secret artefacts
cd "$PROJECT_DIR"
echo "Copying project files to staging..."

# Use rsync to exclude patterns (more reliable than zip --exclude)
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
  --exclude='*.db-wal' \
  --exclude='.env' \
  --exclude='.env.d/' \
  --exclude='**/.env' \
  --exclude='**/.env.d/' \
  --exclude='uploads/' \
  --exclude='**/uploads/' \
  --exclude='.turbo/' \
  --exclude='.cache/' \
  --exclude='coverage/' \
  --exclude='.nyc_output/' \
  --exclude='.vscode/' \
  --exclude='.idea/' \
  --exclude='.DS_Store' \
  --exclude='Thumbs.db' \
  --exclude='tsconfig.tsbuildinfo' \
  --exclude='.zscripts/' \
  --exclude='workspace/' \
  --exclude='upload/' \
  --exclude='skills/' \
  --exclude='download/' \
  --exclude='.git/' \
  --exclude='*.zip' \
  --exclude='ai-after-click.png' \
  --exclude='ai-overlay-open.png' \
  --exclude='ai-banner-response.png' \
  --exclude='aikb-studio.png' \
  --exclude='ai-button-left.png' \
  ./ "$STAGING_DIR/999pro-v18.5-ai-assistant/"

echo "Staging complete. Contents:"
du -sh "$STAGING_DIR/999pro-v18.5-ai-assistant"
echo ""

# Verify .env files are NOT included
echo "=== Verifying .env files are NOT included ==="
FOUND_ENV=$(find "$STAGING_DIR" -name ".env" -o -name ".env.d" | head -5)
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
find "$STAGING_DIR" -name ".env.example" | head -5
echo ""

# Create the zip
echo "=== Creating zip archive ==="
cd "$STAGING_DIR"
zip -r "$OUTPUT_ZIP" "999pro-v18.5-ai-assistant/" -q
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
