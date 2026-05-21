# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Digital implementation of **Compile**, a 2-player card game. Two-package layout (no workspace tooling — each side runs its own npm install):

- `client/` — React + Vite + socket.io-client (port 5173 in dev)
- `server/` — Node TypeScript game engine + Socket.IO transport (port 3000)
- `cards/<protocol>/<value>.md` — canonical text for each of 90 cards (15 protocols × 6 values, 0..5). These markdown files are the rules-of-record; the TS implementations in `server/src/cards/` must match them.
- `rules.md` — canonical game rules. When implementing or reviewing a card/engine change, treat `rules.md` and the matching `cards/<protocol>/<value>.md` as authoritative over inferred behavior.
- `design_handoff_match_board_rails/` — static design reference (JSX/CSS mockups, not built).

## Commands

Local dev (two browsers on same machine):

```
(cd server && npm install)
(cd client && npm install)
./run.sh               # starts server (:3000) and client (:5173) together
```

`run.sh` execs `tsx` and `vite` directly rather than `npm run dev` because npm doesn't forward SIGTERM to its children, leaving orphaned processes on the ports after Ctrl+C. Keep that direct-exec pattern when changing the script.

Public sharing (single ngrok tunnel, same-origin client+server):

```
./run-public.sh        # builds client, starts server with STATIC_CLIENT_DIR, opens ngrok
```

Per-package scripts (run from `client/` or `server/`):

```
npm run dev            # tsx watch (server) or vite (client)
npm run build          # tsc (server: → dist/) or tsc -b && vite build (client)
npm run typecheck      # tsc --noEmit
npm test               # server only — vitest run
npm run test:watch     # server only
npm start              # server only — node dist/server/index.js (after build)
```

Run a single server test: `(cd server && npx vitest run path/to/file.test.ts -t "test name")`.

Server env vars (defaults applied if unset): `PORT=3000`, `CORS_ORIGIN=*`, `DISCONNECT_GRACE_MS=120000`, `STATIC_CLIENT_DIR` (when set, server hosts the built client at same origin). Client env: `VITE_SERVER_URL` — unset → `http://localhost:3000`, empty → same-origin (used by `run-public.sh`).

## Architecture

### Engine = phase machine + Op pump

`server/src/engine/game.ts` (`Game.run`) alternates between two layers until external input is required:

1. **Phase machine** (`engine/phases/`) advances Phase enum (`draft → start → check-control → check-compile → action → check-cache → end`). On entering certain phases it fires Start/End triggers and Check Compile.
2. **Effect runtime** (`engine/runtime.ts`) pumps generator-based card effects. Each card-effect generator yields `Op` values (`draw`, `discard`, `delete`, `flip`, `shift`, `play`, `return`, `reveal`, `transfer-ownership`, `prompt`); the runtime applies the Op, fires any replacement/reactive triggers it causes, and resumes the generator with the result.

`Game.run()` returns an `EngineBlocked` discriminant (`awaiting-action`, `awaiting-prompt`, `awaiting-compile-choice`, `awaiting-control-rearrange`, `game-over`). Callers (the socket layer or tests) feed input back in via `applyAction`, `respondToPrompt`, `chooseCompileLine`, etc.

The Op pump and a LIFO effect stack give the "active text interrupts other text, last-in-first-out" semantics from `rules.md` for free: nested triggers push new generator frames onto the runtime stack.

### Cards = self-registering modules with a 4-piece shape

Each card lives at `server/src/cards/<protocol>.ts` (one file per protocol, exporting six `CardDef`s — protocol×value), self-registers via `registerCard()` (`cards/registry.ts`), and is bootstrapped by the side-effect import chain in `cards/index.ts` (loaded once from `server/index.ts`).

A `CardDef` has four slots (`cards/api.ts`):

- `top: Passive | null` — visible whenever the card is face-up (even when covered).
- `middle: CardEffect | null` — resolved on play / flip / uncover. Generator that yields Ops.
- `bottom: Passive | null` — visible only when face-up **and** uncovered.
- `protocol`, `value` — addressed by `cardId(protocol, value)`.

`Passive` discriminants: `trigger-phase` (start/end of turn), `trigger-reactive` (after a named action — `after-draw`, `after-delete`, …), `trigger-replacement` (intercepts a lifecycle event — `covered`, `flipped`, `deleted-by-compile`, …; resolves *before* the transition), `static-rule` (returns a `RuleOverride` consulted by value/play/phase logic — `value-modifier`, `play-restriction`, `skip-phase`, `play-anywhere`, …).

Reactive/replacement attach automatically when the passive is visible and detach when it stops being visible (`engine/reactive/`).

### Transport: redacted state + reconnect

`server/src/server/lobby.ts` owns `Match` objects (one per game), `socketHandlers.ts` translates client events into engine calls, `redact.ts` filters `GameState` per viewer before emit:

- Own hand visible to self; opponent sees only count.
- Deck is always count-only (even your own deck top).
- Face-down cards on the field reveal `cardId` only to their owner.

Reconnect: client persists `playerId` in `localStorage` (`compile.playerId`) and last `{gameId, playerIdx}` (`compile.lastGame`). On disconnect, the lobby holds the seat for `DISCONNECT_GRACE_MS` before releasing it. Auto-rejoin on page refresh.

### Tests

`server/test/` uses Vitest with a harness (`test/helpers/harness.ts`) that constructs a deterministic, draft-complete `GameState` and a `placeCard` helper that bypasses play validation. Synthetic mock cards live in `test/helpers/mockCards.ts` — most engine tests `clearRegistry()` and register only the mocks they need, so they don't depend on the real 90-card set.

## Conventions worth knowing

- TypeScript imports use `.js` extensions even for `.ts` source (NodeNext module resolution). Keep this when adding imports.
- Top of `PlayerState.deck` is the **end of the array** (push/pop = O(1) draw). Don't reverse it.
- `stacks[playerIdx][lineIdx].cards`: top of stack = last index = the uncovered card. "Most recent card" = `cards.at(-1)`.
- When adding a real card, mirror the exact wording from `cards/<protocol>/<value>.md` in the implementation; that markdown is the spec.
