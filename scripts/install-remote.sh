#!/usr/bin/env bash
set -euo pipefail

# Curl-able installer for git-guardrails
# Usage: curl -fsSL https://raw.githubusercontent.com/josiahbryan/git-guardrails/main/scripts/install-remote.sh | bash

REPO="josiahbryan/git-guardrails"

# Detect platform and architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) PLATFORM="darwin" ;;
  linux)  PLATFORM="linux" ;;
  *)
    echo "Error: Unsupported OS: $OS"
    echo "git-guardrails supports macOS and Linux."
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH_SUFFIX="arm64" ;;
  x86_64|amd64)  ARCH_SUFFIX="x64" ;;
  *)
    echo "Error: Unsupported architecture: $ARCH"
    echo "git-guardrails supports arm64 and x86_64."
    exit 1
    ;;
esac

BINARY_NAME="git-guardrails-${PLATFORM}-${ARCH_SUFFIX}"

# Determine install directory
if [[ "$PLATFORM" == "darwin" ]]; then
  if [[ -d "/opt/homebrew/bin" ]]; then
    INSTALL_DIR="/opt/homebrew/bin"
  elif [[ -d "/usr/local/bin" ]]; then
    INSTALL_DIR="/usr/local/bin"
  else
    echo "Error: Neither /opt/homebrew/bin nor /usr/local/bin found."
    echo "Install Homebrew first: https://brew.sh"
    exit 1
  fi
else
  # Linux: use /usr/local/bin (may need sudo)
  INSTALL_DIR="/usr/local/bin"
fi

# Check that install dir is in PATH before /usr/bin
REAL_GIT="$(which -a git 2>/dev/null | grep '/usr/bin/git' || true)"
if [[ -n "$REAL_GIT" ]]; then
  # Verify our install dir comes first
  FIRST_GIT_DIR="$(which git | xargs dirname)"
  if [[ "$FIRST_GIT_DIR" == "/usr/bin" ]]; then
    echo "Warning: $INSTALL_DIR does not appear before /usr/bin in your PATH."
    echo "The wrapper may not intercept git calls."
    echo "Add this to your shell profile:  export PATH=\"$INSTALL_DIR:\$PATH\""
    echo ""
  fi
fi

# Get latest release tag
echo "Fetching latest release..."
LATEST_TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"

if [[ -z "$LATEST_TAG" ]]; then
  echo "Error: Could not determine latest release."
  exit 1
fi

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST_TAG/$BINARY_NAME"

echo "Installing git-guardrails $LATEST_TAG ($PLATFORM/$ARCH_SUFFIX)..."
echo "  From:  $DOWNLOAD_URL"
echo "  To:    $INSTALL_DIR/git"
echo ""

# Download
TMPFILE="$(mktemp)"
HTTP_CODE="$(curl -fsSL -w '%{http_code}' -o "$TMPFILE" "$DOWNLOAD_URL" || true)"

if [[ "$HTTP_CODE" != "200" ]]; then
  rm -f "$TMPFILE"
  echo "Error: Download failed (HTTP $HTTP_CODE)."
  echo "URL: $DOWNLOAD_URL"
  echo ""
  echo "Check available releases at: https://github.com/$REPO/releases"
  exit 1
fi

# Install atomically (may need sudo on Linux). Stage a temp file INSIDE the
# install dir and rename it onto `git`, rather than moving the download (which
# lives on a different filesystem) directly over it. On macOS, replacing a
# Mach-O in place reuses the inode and the kernel keeps validating the new bytes
# against the old binary's cached code-signature (cdhash), killing every exec
# with "killed: 9". A same-directory rename gives a new inode and a clean
# signature check — and it's atomic, so a half-written `git` never lands on PATH.
INSTALLED_TMP="$INSTALL_DIR/.git-guardrails.install.$$"
if [[ -w "$INSTALL_DIR" ]]; then
  cp "$TMPFILE" "$INSTALLED_TMP"
  chmod 755 "$INSTALLED_TMP"
  mv -f "$INSTALLED_TMP" "$INSTALL_DIR/git"
else
  echo "Need sudo to write to $INSTALL_DIR..."
  sudo cp "$TMPFILE" "$INSTALLED_TMP"
  sudo chmod 755 "$INSTALLED_TMP"
  sudo mv -f "$INSTALLED_TMP" "$INSTALL_DIR/git"
fi
rm -f "$TMPFILE"

echo "Done! git-guardrails installed."
echo ""
echo "  Wrapper:  $INSTALL_DIR/git"
echo "  Real git: /usr/bin/git (untouched)"
echo ""
echo "Verify:"
echo "  git status        # should work normally"
echo "  git stash         # should be BLOCKED"
echo ""
echo "Uninstall:  rm $INSTALL_DIR/git"
