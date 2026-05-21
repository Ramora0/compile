#!/usr/bin/env bash
# Build the client for same-origin use, start the server with static hosting
# enabled, and open an ngrok tunnel. Public URL is printed on stdout.
#
# First-time setup:
#   1. brew install ngrok
#   2. https://dashboard.ngrok.com/get-started/your-authtoken - copy your token
#   3. ngrok config add-authtoken <token>
#
# Usage:
#   ./run-public.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SERVER_PID=""
NGROK_PID=""
PORT="${PORT:-3000}"

# ── helpers ─────────────────────────────────────────────────

# Kill anything currently bound to a TCP port. Used both pre-flight (to clean
# up orphans from a prior crashed/Ctrl-C run) and during cleanup as a last
# line of defence. Safe to call when nothing is listening.
free_port() {
  local port="$1"
  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0
  echo "  → port ${port} held by PID(s): ${pids} - terminating"
  echo "$pids" | xargs -r kill -TERM 2>/dev/null || true
  sleep 0.4
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0
  echo "  → still holding; SIGKILL"
  echo "$pids" | xargs -r kill -KILL 2>/dev/null || true
  sleep 0.2
}

cleanup() {
  trap - INT TERM EXIT
  # Direct PID kills first.
  for pid in "$NGROK_PID" "$SERVER_PID"; do
    [[ -z "$pid" ]] && continue
    if kill -0 "$pid" 2>/dev/null; then kill -TERM "$pid" 2>/dev/null || true; fi
  done
  sleep 0.3
  for pid in "$NGROK_PID" "$SERVER_PID"; do
    [[ -z "$pid" ]] && continue
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  done
  # Belt-and-suspenders: anything still squatting on the port goes too. This
  # catches node children that orphan-reparented away from our subshell.
  free_port "$PORT" >/dev/null 2>&1 || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# ── pre-flight ──────────────────────────────────────────────

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok not installed. Run: brew install ngrok" >&2
  exit 1
fi

echo "[pre] Checking port ${PORT} is free"
free_port "$PORT"

# ── build ───────────────────────────────────────────────────

echo "[1/3] Building client for same-origin hosting"
(cd "$SCRIPT_DIR/client" && VITE_SERVER_URL='' ./node_modules/.bin/vite build) >/dev/null

CLIENT_DIST="$SCRIPT_DIR/client/dist"
if [[ ! -f "$CLIENT_DIST/index.html" ]]; then
  echo "client build missing ${CLIENT_DIST}/index.html" >&2
  exit 1
fi

echo "[1/3] Building server (tsc)"
(cd "$SCRIPT_DIR/server" && ./node_modules/.bin/tsc -p tsconfig.json) >/dev/null

SERVER_ENTRY="$SCRIPT_DIR/server/dist/server/index.js"
if [[ ! -f "$SERVER_ENTRY" ]]; then
  echo "server build missing ${SERVER_ENTRY}" >&2
  exit 1
fi

# ── start server (plain node, no tsx fork - clean kill on signal) ──

echo "[2/3] Starting server on :${PORT} (serving client from ${CLIENT_DIST})"
(
  cd "$SCRIPT_DIR/server"
  STATIC_CLIENT_DIR="$CLIENT_DIST" \
    PORT="$PORT" \
    CORS_ORIGIN="*" \
    exec node "$SERVER_ENTRY"
) &
SERVER_PID=$!

# Wait for the health endpoint to respond before opening the tunnel.
for _ in $(seq 1 40); do
  if curl -fs "http://localhost:${PORT}/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

if ! curl -fs "http://localhost:${PORT}/health" >/dev/null 2>&1; then
  echo "server failed to come up on :${PORT}" >&2
  exit 1
fi

# ── start ngrok ─────────────────────────────────────────────

echo "[3/3] Starting ngrok tunnel on :${PORT}"
ngrok http "$PORT" --log=stdout --log-format=json >/tmp/compile-ngrok.log 2>&1 &
NGROK_PID=$!

# Poll the local ngrok API to extract the public https URL.
PUBLIC_URL=""
for _ in $(seq 1 40); do
  if PUBLIC_URL="$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
      | python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  ts=[t for t in d.get("tunnels",[]) if t.get("proto")=="https"]
  print(ts[0]["public_url"] if ts else "")
except Exception:
  pass' 2>/dev/null)" && [[ -n "$PUBLIC_URL" ]]; then
    break
  fi
  sleep 0.25
done

if [[ -z "$PUBLIC_URL" ]]; then
  echo "ngrok did not produce a public URL. Check /tmp/compile-ngrok.log" >&2
  echo "Common cause: missing authtoken. Fix:" >&2
  echo "  ngrok config add-authtoken <token-from-https://dashboard.ngrok.com>" >&2
  tail -n 20 /tmp/compile-ngrok.log >&2 || true
  exit 1
fi

cat <<EOF

============================================================
  Public URL:  ${PUBLIC_URL}
  Share that link with your opponent. Ctrl+C to stop.
============================================================

EOF

# Stay alive until either child dies. macOS bash 3.2 lacks "wait -n".
while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$NGROK_PID" 2>/dev/null; do
  sleep 1
done
