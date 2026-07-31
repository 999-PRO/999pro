#!/bin/bash
set -e
PROJECT_DIR="/home/z/my-project/999pro"
OUTPUT_ZIP="/home/z/my-project/download/999pro-v22.5.zip"
STAGING_DIR="/tmp/999pro-v225-staging"

echo "=== Packaging 999 PRO v22.5 (AI Agent + Tool Calling) ==="
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

# Verify .env NOT included (secrets protection)
FOUND_ENV=$(find "$STAGING_DIR" -name ".env" -type f | head -5)
if [ -n "$FOUND_ENV" ]; then echo "ERROR: .env found in staging! Aborting."; exit 1; fi
echo "OK: No .env files (secrets protected)"

# Verify v22.2 key files are present
echo ""
echo "=== Verifying v22.2 key files ==="
for f in \
  "mini-services/backend/src/lib/ai-tools.ts" \
  "mini-services/backend/src/lib/ai-provider.ts" \
  "mini-services/backend/src/lib/ai-deepseek.ts" \
  "mini-services/backend/src/routes/ai.ts" \
  "mini-services/backend/src/routes/users.ts" \
  "mini-services/backend/src/lib/auth.ts" \
  "src/components/analytics-view.tsx" \
  "src/modules/ai-assistant/index.tsx" \
  "src/app/page.tsx" \
  "mini-services/studio/src/components/managers-manager.tsx" \
  "mini-services/studio/src/app/page.tsx" \
  "mini-services/studio/src/components/sidebar.tsx" \
  "public/sw.js" \
  "public/manifest.webmanifest" \
  "package.json" \
  "next.config.ts"; do
  if [ -f "$STAGING_DIR/999pro/$f" ]; then
    echo "  OK: $f"
  else
    echo "  MISSING: $f"
    exit 1
  fi
done

# Verify sw.js has new CACHE_VERSION
SW_VERSION=$(grep "CACHE_VERSION = " "$STAGING_DIR/999pro/public/sw.js" | head -1)
echo ""
echo "SW version: $SW_VERSION"

# Verify manifest has new version
MANIFEST_VERSION=$(grep '"version":' "$STAGING_DIR/999pro/public/manifest.webmanifest" | head -1)
echo "Manifest: $MANIFEST_VERSION"

# Verify package.json version
PKG_VERSION=$(grep '"version":' "$STAGING_DIR/999pro/package.json" | head -1)
echo "package.json: $PKG_VERSION"

# Verify ai-tools.ts is the new file (not empty + has tool registry)
AI_TOOLS_LINES=$(wc -l < "$STAGING_DIR/999pro/mini-services/backend/src/lib/ai-tools.ts")
echo "ai-tools.ts: $AI_TOOLS_LINES lines"
if [ "$AI_TOOLS_LINES" -lt 400 ]; then echo "ERROR: ai-tools.ts too small — incomplete!"; exit 1; fi

# Verify managers-manager.tsx is the new file
MANAGERS_LINES=$(wc -l < "$STAGING_DIR/999pro/mini-services/studio/src/components/managers-manager.tsx")
echo "managers-manager.tsx: $MANAGERS_LINES lines"

cd "$STAGING_DIR"
zip -r "$OUTPUT_ZIP" "999pro/" -q
echo ""
echo "=== Package created ==="
ls -lh "$OUTPUT_ZIP"
echo ""
echo "=== File count ==="
unzip -l "$OUTPUT_ZIP" | tail -1
echo ""
echo "=== Top-level structure ==="
unzip -l "$OUTPUT_ZIP" | awk '{print $4}' | grep -E "^999pro/[^/]+/?$" | head -20
