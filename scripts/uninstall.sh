#!/usr/bin/env bash
# dream uninstaller (macOS / Linux)
#   ./scripts/uninstall.sh          remove the plugin + unlink the CLI
#   ./scripts/uninstall.sh --purge  also delete ~/.dream (watermarks, run reports, badges)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1

say() { printf '\033[1m[dream]\033[0m %s\n' "$*"; }

if command -v claude >/dev/null 2>&1; then
  say "removing the Claude Code plugin…"
  claude plugin uninstall dream@fiorastudio >/dev/null 2>&1 || true
  claude plugin marketplace remove fiorastudio >/dev/null 2>&1 || true
else
  say "Claude Code CLI not found — if installed, remove manually: /plugin uninstall dream@fiorastudio"
fi

say "unlinking the dream CLI…"
npm rm --global --silent dream 2>/dev/null || true

if [ "$PURGE" = "1" ]; then
  say "purging ~/.dream (state, run reports, badges)…"
  rm -rf "$HOME/.dream"
else
  say "kept ~/.dream (watermarks/run history). Purge with: $0 --purge"
fi

say "note: per-project .dream/config.json files and memory stores are never touched."
say "note: if you wired 'dream statusline' into ~/.claude/settings.json, remove that entry yourself."
say "done."
