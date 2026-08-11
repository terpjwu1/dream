#!/usr/bin/env bash
# dream installer (macOS / Linux)
#   ./scripts/install.sh              build CLI + link + install the Claude Code plugin
#   ./scripts/install.sh --no-plugin  build CLI + link only
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NO_PLUGIN=0
[ "${1:-}" = "--no-plugin" ] && NO_PLUGIN=1

say()  { printf '\033[1m[dream]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[dream]\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "node is required (v20+): https://nodejs.org"
command -v npm  >/dev/null 2>&1 || fail "npm is required (ships with node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "node v20+ required (found v$(node -v))"

say "installing dependencies…"
npm install --prefix "$REPO_DIR" --silent

say "building…"
npm run --prefix "$REPO_DIR" --silent build

say "linking the dream CLI onto your PATH…"
(cd "$REPO_DIR" && npm link --silent)
command -v dream >/dev/null 2>&1 || fail "npm link finished but 'dream' is not on PATH — check your npm prefix bin dir"
say "CLI ready: $(command -v dream)"

if [ "$NO_PLUGIN" = "1" ]; then
  say "skipping plugin install (--no-plugin). Done."
  exit 0
fi

if command -v claude >/dev/null 2>&1; then
  say "registering the fiorastudio marketplace with Claude Code…"
  claude plugin marketplace add "$REPO_DIR" >/dev/null 2>&1 || claude plugin marketplace update fiorastudio >/dev/null
  say "installing the plugin…"
  claude plugin install dream@fiorastudio >/dev/null
  say "plugin installed."
else
  say "Claude Code CLI not found — install the plugin manually inside Claude Code:"
  say "  /plugin marketplace add $REPO_DIR"
  say "  /plugin install dream@fiorastudio"
fi

cat <<EOF

$(printf '\033[1mdream is installed.\033[0m') Next, in any project you want dreamed:
  1. open Claude Code there and run /dream:setup
     (initializes the project, asks what to pay attention to, and — only with
      your explicit consent — enables background dreaming and the status line)
  2. or from the terminal: dream init --project <path> && dream run --project <path> --dry-run

Uninstall any time: $REPO_DIR/scripts/uninstall.sh
EOF
