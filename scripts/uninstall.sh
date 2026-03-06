#!/usr/bin/env bash
set -euo pipefail

WRAPPER_DEST="/opt/homebrew/bin/git"

if [[ ! -f "$WRAPPER_DEST" ]]; then
  echo "Error: Wrapper not found at $WRAPPER_DEST — nothing to uninstall"
  exit 1
fi

echo "Removing git-guardrails wrapper..."
rm "$WRAPPER_DEST"

echo "Done! Original git at /usr/bin/git is now the only git in PATH."
