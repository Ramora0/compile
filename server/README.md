# Compile — Server

Node.js TypeScript game engine and Socket.IO server for the Compile card game. Exposes a card-agnostic engine over WebSocket; the future React frontend lives separately as a sibling project.

## Layout

```
src/
├── engine/        # game state, turn loop, effects, triggers, overrides
├── cards/         # plug-in card modules (registry; empty in v1)
├── server/        # Socket.IO transport, lobby, redaction
└── shared/        # constants used across layers (protocols, etc.)

test/              # vitest unit tests using synthetic mock cards
```

## Scripts

```
npm install
npm run dev        # tsx watch — Socket.IO server on :3000
npm run build      # tsc → dist/
npm start          # node dist/server/index.js (production entrypoint)
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

## Environment

All knobs are env vars; defaults are listed.

| Variable               | Default  | Purpose                                                                |
| ---------------------- | -------- | ---------------------------------------------------------------------- |
| `PORT`                 | `3000`   | Port the HTTP/Socket.IO server binds to.                               |
| `CORS_ORIGIN`          | `*`      | Allowed CORS origin for the Socket.IO handshake. Set to your client's URL in production (e.g. `https://compile.example.com`). |
| `DISCONNECT_GRACE_MS`  | `120000` | How long a disconnected player's seat is held before the match treats them as gone. Lower while testing reconnect logic. |

A `GET /health` endpoint returns `{"ok":true}` for liveness checks.

See `.env.example` for a starter file.

## Running two browsers locally

From the repo root:

```
./run.sh
```

Starts the server on `:3000` and the Vite client on `:5173`. Open two browser tabs at `http://localhost:5173`:

1. **Tab A** — click `CREATE NEW GAME`, copy the game code shown on the "Waiting for opponent" screen.
2. **Tab B** — paste the code into `JOIN GAME`. The draft starts as soon as both seats are filled.
3. During play, the non-active tab shows a "Player N is taking their turn…" indicator and click handlers are inert. Refreshing a tab will auto-rejoin into the same seat using the `playerId` stored in `localStorage`.

To exercise the disconnect grace window, set `DISCONNECT_GRACE_MS=5000` and kill one tab mid-game; the opposite tab will show an "OPPONENT DISCONNECTED" banner that clears on rejoin.

## Cross-machine (LAN) test, no deploy

Bind the server to all interfaces, then point the client at the host's LAN IP:

```
# host machine
HOST=0.0.0.0 PORT=3000 CORS_ORIGIN='*' npm run dev          # server
VITE_SERVER_URL='http://<host-lan-ip>:3000' npm run dev     # client (in client/)
```

A phone or second laptop on the same Wi-Fi can then load `http://<host-lan-ip>:5173`.

## Status

In progress. See the implementation plan for phased build order.
