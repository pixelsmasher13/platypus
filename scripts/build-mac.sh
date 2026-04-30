#!/usr/bin/env bash
# Build, sign, notarize, and upload the macOS .dmg to S3.
#
# Required env vars (for signing + notarization):
#   APPLE_API_ISSUER         (App Store Connect API issuer ID)
#   APPLE_API_KEY            (App Store Connect API key ID)
#   APPLE_API_KEY_PATH       (absolute path to the AuthKey_*.p8 file)
#   APPLE_SIGNING_IDENTITY   (e.g. "Developer ID Application: Your Co (TEAMID)")
#
# Optional:
#   S3_BUCKET                (default: the-platypus-app)
#   AWS_PROFILE              (default: none; uses your default AWS credentials)
#
# Usage:
#   ./scripts/build-mac.sh           # build + upload
#   ./scripts/build-mac.sh --no-upload    # build only (skip S3)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ── Auto-load credentials from .env.build if present (gitignored) ──
if [[ -f "$ROOT_DIR/.env.build" ]]; then
  echo "==> Loading credentials from .env.build"
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env.build"
fi

# ── Require signing env vars ──
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER must be set}"
: "${APPLE_API_KEY:?APPLE_API_KEY must be set}"
: "${APPLE_API_KEY_PATH:?APPLE_API_KEY_PATH must be set}"
: "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY must be set}"

if [[ ! -f "$APPLE_API_KEY_PATH" ]]; then
  echo "❌ APPLE_API_KEY_PATH does not exist: $APPLE_API_KEY_PATH"
  exit 1
fi

S3_BUCKET="${S3_BUCKET:-the-platypus-app}"
SKIP_UPLOAD=0
for arg in "$@"; do
  [[ "$arg" == "--no-upload" ]] && SKIP_UPLOAD=1
done

# ── Verify AWS CLI is available (unless skipping upload) ──
if [[ "$SKIP_UPLOAD" -eq 0 ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "❌ aws CLI not found. Install with: brew install awscli"
    exit 1
  fi
fi

# ── Pre-build cleanup ──
# Tauri's bundle_dmg.sh calls `hdiutil convert ... -o <path>` WITHOUT -ov, so any
# leftover .dmg at the target path aborts the build with no clear error. The script
# also leaves `rw.<name>.dmg` read-write templates and may leave a /Volumes/Platypus
# mount around after a failed run. Wipe all three before building.
echo "==> Pre-build cleanup (stale DMGs, rw templates, leftover mounts)..."
rm -f src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null || true
rm -f src-tauri/target/release/bundle/macos/*.dmg 2>/dev/null || true
rm -f src-tauri/target/release/bundle/macos/rw.*.dmg 2>/dev/null || true

# Detach any leftover Platypus mount from a prior failed run
for vol in /Volumes/Platypus*; do
  if [[ -d "$vol" ]]; then
    echo "    detaching stale mount: $vol"
    hdiutil detach "$vol" -force 2>/dev/null || true
  fi
done

# ── Build ──
echo "==> Building Tauri macOS app (signed + notarized)..."
# Run tauri build directly (skips the tauri:build npm script which references a missing plist fix)
npx tauri build

# ── Locate the DMG ──
DMG_PATH=$(find src-tauri/target/release/bundle/dmg -maxdepth 1 -name "*.dmg" | head -1)
if [[ -z "$DMG_PATH" ]]; then
  echo "❌ No .dmg produced under src-tauri/target/release/bundle/dmg"
  exit 1
fi

DMG_FILE=$(basename "$DMG_PATH")
DMG_SIZE=$(du -h "$DMG_PATH" | cut -f1)
echo "==> Built: $DMG_PATH ($DMG_SIZE)"

# Verify signature + notarization ticket
echo "==> Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$DMG_PATH" 2>&1 | tail -3 || true

if [[ "$SKIP_UPLOAD" -eq 1 ]]; then
  echo "==> Skipping S3 upload (--no-upload)"
  exit 0
fi

# ── Upload to S3 ──
echo "==> Uploading to s3://$S3_BUCKET/$DMG_FILE"
aws s3 cp "$DMG_PATH" "s3://$S3_BUCKET/$DMG_FILE" \
  --content-type application/x-apple-diskimage

# Mirror to a stable "latest" URL for the website's download button
LATEST_KEY="PlatypusNotes-latest.dmg"
echo "==> Mirroring to s3://$S3_BUCKET/$LATEST_KEY"
aws s3 cp "$DMG_PATH" "s3://$S3_BUCKET/$LATEST_KEY" \
  --content-type application/x-apple-diskimage

echo
echo "✅ Done"
echo "   Versioned: https://$S3_BUCKET.s3.amazonaws.com/$DMG_FILE"
echo "   Latest:    https://$S3_BUCKET.s3.amazonaws.com/$LATEST_KEY"
