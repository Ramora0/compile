#!/usr/bin/env bash
# Build the client for same-origin use, start the server with static hosting
# enabled, and open an ngrok tunnel. Public URL is printed on stdout.
#
# First-time setup:
#   1. brew install ngrok               (already done if you used the helper)
#   2. https://dashboard.ngrok.com/get-started/your-authtoken — copy your token
#   3. ngrok config add-authtoken <token>
#
# Usage:
#   ./run-public.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SERVER_PID=""
NGROK_PID=""

kill_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return
  pkill -TERM -P "$pid" 2>/dev/null || true
  if kill -0 "$pid" 2>/dev/null; then kill -TERM "$pid" 2>/dev/null || true; fi
}

force_kill_tree() {
  local pid="$1"
  [[ -z "$pid" ]] && return
  pkill -KILL -P "$pid" 2>/dev/null || true
  if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
}

cleanup() {
  trap - INT TERM EXIT
  kill_tree "$NGROK_PID"
  kill_tree "$SERVER_PID"
  sleep 0.3
  force_kill_tree "$NGROK_PID"
  force_kill_tree "$SERVER_PID"
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok not installed. Run: brew install ngrok" >&2
  exit 1
fi

PORT="${PORT:-3000}"

echo "[1/3] Building client for same-origin hosting..."
(cd "$SCRIPT_DIR/client" && VITE_SERVER_URL='' ./node_modules/.bin/vite build) >/dev/null

CLIENT_DIST="$SCRIPT_DIR/client/dist"
if [[ ! -f "$CLIENT_DIST/index.html" ]]; then
  echo "✗ client build missing $CLIENT_DIST/index.html" >&2
  exit 1
fi

echo "[2/3] Starting server on :${PORT} (serving client from ${CLIENT_DIST})"
(
  cd "$SCRIPT_DIR/server"
  STATIC_CLIENT_DIR="$CLIENT_DIST" \
    PORT="$PORT" \
    CORS_ORIGIN="*" \
    exec ./node_modules/.bin/tsx src/server/index.ts
) &
SERVER_PID=$!

# Wait for the health endpoint to respond before opening the tunnel.
for _ in $(seq 1 20); do
  if curl -fs "http://localhost:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

echo "[3/3] Starting ngrok tunnel on :${PORT}..."
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
  echo "✗ ngrok didn't produce a public URL. Check /tmp/compile-ngrok.log" >&2
  echo "  Common causes: missing authtoken (ngrok config add-authtoken <token>)" >&2
  tail -n 20 /tmp/compile-ngrok.log >&2 || true
  exit 1
fi

cat <<EOF

────────────────────────────────────────────────────────────
  Public URL:  $PUBLIC_URL
  Share that link with your opponent. Ctrl+C to stop.
────────────────────────────────────────────────────────────

EOF

# Stay alive until either child dies.
while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$NGROK_PID" 2>/dev/null; do
  sleep 1
done
