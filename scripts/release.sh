#!/usr/bin/env bash
set -euo pipefail

# Usage: bash scripts/release.sh v1.0.0
# Builds binaries for all targets, creates a GitHub release, and attaches them.

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: bash scripts/release.sh <version>"
  echo "Example: bash scripts/release.sh v1.0.0"
  exit 1
fi

# Validate version format
if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must match vX.Y.Z (e.g. v1.0.0)"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$REPO_ROOT/dist"

echo "Building git-guardrails $VERSION..."
echo ""

mkdir -p "$DIST"

# Build all targets
TARGETS=(
  "bun-darwin-arm64:git-guardrails-darwin-arm64"
  "bun-darwin-x64:git-guardrails-darwin-x64"
  "bun-linux-x64:git-guardrails-linux-x64"
  "bun-linux-arm64:git-guardrails-linux-arm64"
)

for entry in "${TARGETS[@]}"; do
  target="${entry%%:*}"
  name="${entry##*:}"
  echo "  Building $name ($target)..."
  bun build --compile --target="$target" --outfile "$DIST/$name" "$REPO_ROOT/src/index.ts" 2>&1 | tail -1
done

echo ""
echo "All binaries built:"
ls -lh "$DIST"/git-guardrails-*
echo ""

# Create git tag
echo "Creating tag $VERSION..."
git tag -a "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"

# Create GitHub release with all binaries
echo "Creating GitHub release $VERSION..."
gh release create "$VERSION" \
  --title "git-guardrails $VERSION" \
  --notes "$(cat <<EOF
## Installation

### One-liner (macOS)

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/josiahbryan/git-guardrails/$VERSION/scripts/install-remote.sh | bash
\`\`\`

### Manual download

Download the binary for your platform, make it executable, and place it in a directory that appears before \`/usr/bin\` in your \`\$PATH\`:

| Platform | Binary |
|----------|--------|
| macOS Apple Silicon (M1/M2/M3/M4) | \`git-guardrails-darwin-arm64\` |
| macOS Intel | \`git-guardrails-darwin-x64\` |
| Linux x86_64 | \`git-guardrails-linux-x64\` |
| Linux ARM64 | \`git-guardrails-linux-arm64\` |

\`\`\`bash
# Example: macOS Apple Silicon
curl -fsSL -o /opt/homebrew/bin/git https://github.com/josiahbryan/git-guardrails/releases/download/$VERSION/git-guardrails-darwin-arm64
chmod +x /opt/homebrew/bin/git
\`\`\`

See [README](https://github.com/josiahbryan/git-guardrails) for full documentation.
EOF
)" \
  "$DIST"/git-guardrails-darwin-arm64 \
  "$DIST"/git-guardrails-darwin-x64 \
  "$DIST"/git-guardrails-linux-x64 \
  "$DIST"/git-guardrails-linux-arm64

echo ""
echo "Done! Release $VERSION published."
echo "https://github.com/josiahbryan/git-guardrails/releases/tag/$VERSION"
