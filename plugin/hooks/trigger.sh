#!/bin/bash
# dream SessionStart hook: hand off to `dream trigger`, which decides whether
# to start a background dreaming run (opt-in per project via `dream init`).
# Silent no-op when the dream CLI isn't installed.
command -v dream >/dev/null 2>&1 || exit 0
# Never re-trigger from inside a dream-spawned process tree.
[ "${DREAM_BACKGROUND:-}" = "1" ] && exit 0

# The hook payload arrives as JSON on stdin; `dream trigger` parses it itself
# (node is more robust than sed for JSON), so just forward stdin.
exec dream trigger --stdin
