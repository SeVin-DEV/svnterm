#!/usr/bin/env bash
# ── Terminal AI — Apply Update ────────────────────────────────
# Run this from your install directory (e.g. /opt/terminal-ai)
# Usage: bash APPLY.sh /opt/terminal-ai

set -euo pipefail

INSTALL_DIR="${1:-/opt/terminal-ai}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "→ Applying update to $INSTALL_DIR"

cp -v "$SCRIPT_DIR/artifacts/terminal-ai/src/pages/main.tsx" \
      "$INSTALL_DIR/artifacts/terminal-ai/src/pages/main.tsx"

cp -v "$SCRIPT_DIR/artifacts/api-server/src/routes/tts.ts" \
      "$INSTALL_DIR/artifacts/api-server/src/routes/tts.ts"

cp -v "$SCRIPT_DIR/artifacts/api-server/src/routes/index.ts" \
      "$INSTALL_DIR/artifacts/api-server/src/routes/index.ts"

cp -v "$SCRIPT_DIR/install.sh" \
      "$INSTALL_DIR/install.sh"

echo "→ Rebuilding frontend..."
cd "$INSTALL_DIR"
PORT=1 BASE_PATH=/ NODE_ENV=production \
  pnpm --filter @workspace/terminal-ai run build

echo "→ Rebuilding API server..."
pnpm --filter @workspace/api-server run build

echo "→ Reloading PM2..."
pm2 reload ecosystem.config.cjs --update-env

echo ""
echo "✓ Update applied. All fixes are live."
echo ""
echo "  Next: install Piper TTS if not done yet:"
echo "  bash $INSTALL_DIR/install.sh  (or follow PIPER_INSTALL.md)"
