#!/usr/bin/env bash
set -euo pipefail

WRAPPER_DEST="/opt/homebrew/bin/git"
DIST_BINARY="$(cd "$(dirname "$0")/.." && pwd)/dist/git"

if [[ ! -f "$DIST_BINARY" ]]; then
  echo "Error: Compiled binary not found at $DIST_BINARY"
  echo "Run 'bun run build' first."
  exit 1
fi

# Copy compiled wrapper into /opt/homebrew/bin (shadows /usr/bin/git in PATH)
echo "Installing git-guardrails wrapper to $WRAPPER_DEST..."
cp "$DIST_BINARY" "$WRAPPER_DEST"
chmod 755 "$WRAPPER_DEST"

echo ""
echo "Done! git-guardrails installed."
echo "  Real git:    /usr/bin/git (untouched)"
echo "  Wrapper:     $WRAPPER_DEST (shadows real git in PATH)"
echo ""
echo "Test: git status       (should work)"
echo "Test: git stash        (should be blocked)"
