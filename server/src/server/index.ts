/**
 * Server bootstrap. Creates the Socket.IO server and a single Lobby instance.
 * Run with `npm run dev` (tsx watch) or `npm start` after `npm run build`.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { Server } from "socket.io";
import { Lobby } from "./lobby.js";
import { attachHandlers } from "./socketHandlers.js";
// Side-effect import: registers all 90 cards into the global registry.
import "../cards/index.js";

const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS ?? 120_000);
// When set, serve the prebuilt client from this directory at the same origin
// so a single public URL (e.g. an ngrok tunnel) exposes both client and server.
const STATIC_CLIENT_DIR = process.env.STATIC_CLIENT_DIR
  ? resolve(process.env.STATIC_CLIENT_DIR)
  : null;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function serveStatic(
  rootDir: string,
  urlPath: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  // Resolve safely inside rootDir — guard against path traversal.
  const cleaned = normalize(decodeURIComponent(urlPath.split("?")[0] ?? "/"));
  if (cleaned.includes("..")) return null;
  const candidate = cleaned === "/" || cleaned === "" ? "index.html" : cleaned.replace(/^\/+/, "");
  const filePath = join(rootDir, candidate);
  if (!filePath.startsWith(rootDir)) return null;
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) return serveStatic(rootDir, join(urlPath, "index.html"));
    const body = await readFile(filePath);
    return { body, contentType: MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

function main(): void {
  const httpServer = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (STATIC_CLIENT_DIR && req.method === "GET" && req.url) {
      const hit = await serveStatic(STATIC_CLIENT_DIR, req.url);
      if (hit) {
        res.writeHead(200, { "Content-Type": hit.contentType });
        res.end(hit.body);
        return;
      }
      // SPA fallback: unknown paths return index.html so client-side routing works.
      const fallback = await serveStatic(STATIC_CLIENT_DIR, "/");
      if (fallback) {
        res.writeHead(200, { "Content-Type": fallback.contentType });
        res.end(fallback.body);
        return;
      }
    }
    res.writeHead(404);
    res.end();
  });

  const io = new Server(httpServer, {
    cors: { origin: CORS_ORIGIN },
  });

  const lobby = new Lobby();
  attachHandlers(io, lobby, { disconnectGraceMs: DISCONNECT_GRACE_MS });

  httpServer.listen(PORT, () => {
    console.log(`compile-server: socket.io listening on :${PORT}`);
    if (STATIC_CLIENT_DIR) console.log(`compile-server: serving client from ${STATIC_CLIENT_DIR}`);
  });
}

main();
