#!/usr/bin/env bash
set -euo pipefail

WRAPPER_DEST="/opt/homebrew/bin/git"
DIST_BINARY="$(cd "$(dirname "$0")/.." && pwd)/dist/git"

if [[ ! -f "$DIST_BINARY" ]]; then
  echo "Error: Compiled binary not found at $DIST_BINARY"
  echo "Run 'bun run build' first."
  exit 1
fi

# Install the wrapper into /opt/homebrew/bin (shadows /usr/bin/git in PATH).
#
# Atomic replace, NOT an in-place `cp`: overwriting a Mach-O at an existing path
# reuses the same inode, and macOS keeps validating the new bytes against the
# PREVIOUS binary's cached code-signature (cdhash). The mismatch makes AMFI kill
# every exec with "killed: 9" (exit 137). Writing a fresh temp file in the same
# directory and renaming it into place gives a NEW inode, so the new signature
# is validated cleanly and the wrapper runs immediately. (mv within one dir is a
# rename, so it's atomic and never leaves a partially-written git on PATH.)
echo "Installing git-guardrails wrapper to $WRAPPER_DEST..."
TMP_DEST="$(dirname "$WRAPPER_DEST")/.git-guardrails.install.$$"
trap 'rm -f "$TMP_DEST"' EXIT
cp "$DIST_BINARY" "$TMP_DEST"
chmod 755 "$TMP_DEST"
mv -f "$TMP_DEST" "$WRAPPER_DEST"
trap - EXIT

echo ""
echo "Done! git-guardrails installed."
echo "  Real git:    /usr/bin/git (untouched)"
echo "  Wrapper:     $WRAPPER_DEST (shadows real git in PATH)"
echo ""
echo "Test: git status       (should work)"
echo "Test: git stash        (should be blocked)"
