#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SERVER_PID=""
CLIENT_PID=""

kill_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return
  # tsx watch spawns its own node child; kill descendants too or :3000 leaks.
  pkill -TERM -P "$pid" 2>/dev/null || true
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

force_kill_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return
  pkill -KILL -P "$pid" 2>/dev/null || true
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  trap - INT TERM EXIT
  kill_tree "$SERVER_PID"
  kill_tree "$CLIENT_PID"
  sleep 0.3
  force_kill_tree "$SERVER_PID"
  force_kill_tree "$CLIENT_PID"
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Bypass `npm run dev` — npm doesn't forward SIGTERM to its tsx/vite child,
# which leaves them orphaned on :3000 / :5173 after Ctrl+C. Exec'ing the
# binaries directly makes SERVER_PID/CLIENT_PID point at the real process.
(cd "$SCRIPT_DIR/server" && exec ./node_modules/.bin/tsx watch src/server/index.ts) &
SERVER_PID=$!

(cd "$SCRIPT_DIR/client" && exec ./node_modules/.bin/vite) &
CLIENT_PID=$!

# Portable replacement for `wait -n` — macOS ships bash 3.2 which lacks it.
# Polls once per second; exits cleanly as soon as either child dies.
while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$CLIENT_PID" 2>/dev/null; do
  sleep 1
done
