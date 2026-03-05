#!/usr/bin/env bash
set -euo pipefail

REAL_GIT="/usr/bin/git-core-bin"
WRAPPER_DEST="/usr/bin/git"
DIST_BINARY="$(cd "$(dirname "$0")/.." && pwd)/dist/git"

# Safety checks
if [[ $EUID -ne 0 ]]; then
  echo "Error: This script must be run with sudo"
  exit 1
fi

if [[ ! -f "$DIST_BINARY" ]]; then
  echo "Error: Compiled binary not found at $DIST_BINARY"
  echo "Run 'bun run build' first."
  exit 1
fi

# If real git hasn't been moved yet, move it
if [[ ! -f "$REAL_GIT" ]]; then
  if [[ ! -f "$WRAPPER_DEST" ]]; then
    echo "Error: No git binary found at $WRAPPER_DEST"
    exit 1
  fi
  echo "Moving original git to $REAL_GIT..."
  mv "$WRAPPER_DEST" "$REAL_GIT"
  chmod 755 "$REAL_GIT"
else
  echo "Real git already at $REAL_GIT, skipping move."
fi

# Copy compiled wrapper into place
echo "Installing git-guardrails wrapper to $WRAPPER_DEST..."
cp "$DIST_BINARY" "$WRAPPER_DEST"
chmod 755 "$WRAPPER_DEST"

echo ""
echo "Done! git-guardrails installed."
echo "  Real git:    $REAL_GIT"
echo "  Wrapper:     $WRAPPER_DEST"
echo ""
echo "Test: git status       (should work)"
echo "Test: git stash        (should be blocked)"
