#!/usr/bin/env bash
set -euo pipefail

REAL_GIT="/usr/bin/git-core-bin"
WRAPPER_DEST="/usr/bin/git"

if [[ $EUID -ne 0 ]]; then
  echo "Error: This script must be run with sudo"
  exit 1
fi

if [[ ! -f "$REAL_GIT" ]]; then
  echo "Error: Real git not found at $REAL_GIT — nothing to uninstall"
  exit 1
fi

echo "Restoring original git..."
mv "$REAL_GIT" "$WRAPPER_DEST"
chmod 755 "$WRAPPER_DEST"

echo "Done! Original git restored at $WRAPPER_DEST"
