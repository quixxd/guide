import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.ts";
import { LENSES, resolveLenses } from "./lenses.ts";
import { createSession, endSession, getSession } from "./session.ts";
import { geocode } from "./sources/nominatim.ts";
import { route, type SimMode } from "./sources/routing.ts";
import { answerListener, nextSegment, parsePosition, type Emit } from "./tour.ts";

const PUBLIC_DIR = resolve(fileURLToPath(new URL("../public", import.meta.url)));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/** Starts an NDJSON stream; returns an emitter and an AbortSignal that fires if the client goes away. */
function startStream(res: ServerResponse): { emit: Emit; signal: AbortSignal } {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  const emit: Emit = (event) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  return { emit, signal: controller.signal };
}

function authorized(req: IncomingMessage, url: URL): boolean {
  if (!config.accessToken) return true;
  return req.headers["x-access-token"] === config.accessToken || url.searchParams.get("key") === config.accessToken;
}

function parseLatLon(v: string | null): { lat: number; lon: number } | null {
  if (!v) return null;
  const [lat, lon] = v.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function localTimeOf(body: Record<string, unknown>): string | null {
  return typeof body.localTime === "string" && /^\d{1,2}:\d{2}$/.test(body.localTime) ? body.localTime : null;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (!authorized(req, url)) return sendJson(res, 401, { error: "Missing or wrong access key" });
  const route_ = `${req.method} ${url.pathname}`;

  switch (route_) {
    case "GET /api/lenses":
      return sendJson(res, 200, LENSES.map(({ id, label, covers }) => ({ id, label, covers })));

    case "POST /api/session": {
      const body = await readJson(req);
      const session = createSession(resolveLenses(body.lenses));
      console.log(`[session] ${session.id} lenses: ${session.lenses.map((l) => l.label).join(", ")}`);
      return sendJson(res, 200, { sessionId: session.id, lenses: session.lenses.map((l) => l.id) });
    }

    case "POST /api/lenses": {
      const body = await readJson(req);
      const session = getSession(body.sessionId);
      if (!session) return sendJson(res, 404, { error: "Unknown session" });
      session.lenses = resolveLenses(body.lenses);
      return sendJson(res, 200, { lenses: session.lenses.map((l) => l.id) });
    }

    case "POST /api/next": {
      const body = await readJson(req);
      const session = getSession(body.sessionId);
      if (!session) return sendJson(res, 404, { error: "Unknown session" });
      const pos = parsePosition(body.pos);
      if (!pos) return sendJson(res, 400, { error: "Missing position" });
      const focus = typeof body.focus === "string" && body.focus.trim() ? body.focus.trim().slice(0, 100) : null;
      const { emit, signal } = startStream(res);
      await nextSegment(session, pos, focus, localTimeOf(body), emit, signal);
      emit({ type: "done" });
      return void res.end();
    }

    case "POST /api/ask": {
      const body = await readJson(req);
      const session = getSession(body.sessionId);
      if (!session) return sendJson(res, 404, { error: "Unknown session" });
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
      if (!text) return sendJson(res, 400, { error: "Missing text" });
      const { emit, signal } = startStream(res);
      await answerListener(session, parsePosition(body.pos), text, localTimeOf(body), emit, signal);
      emit({ type: "done" });
      return void res.end();
    }

    case "POST /api/stop": {
      const body = await readJson(req);
      if (typeof body.sessionId === "string") endSession(body.sessionId);
      return sendJson(res, 200, { ok: true });
    }

    case "GET /api/route": {
      const from = parseLatLon(url.searchParams.get("from"));
      const to = parseLatLon(url.searchParams.get("to"));
      const mode = (url.searchParams.get("mode") ?? "walk") as SimMode;
      if (!from || !to || !["walk", "bus", "drive"].includes(mode)) {
        return sendJson(res, 400, { error: "Need from=lat,lon, to=lat,lon and mode=walk|bus|drive" });
      }
      return sendJson(res, 200, await route([from, to], mode));
    }

    case "GET /api/geocode": {
      const q = url.searchParams.get("q")?.trim();
      if (!q) return sendJson(res, 400, { error: "Missing q" });
      return sendJson(res, 200, await geocode(q));
    }

    default:
      return sendJson(res, 404, { error: "Not found" });
  }
}

function serveStatic(res: ServerResponse, pathname: string): void {
  const rel = normalize(decodeURIComponent(pathname === "/" ? "/index.html" : pathname)).replace(/^([/\\])+/, "");
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return void res.end("Not found");
  }
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else serveStatic(res, url.pathname);
  } catch (err) {
    console.error(`${req.method} ${url.pathname} failed:`, err);
    if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
    else res.end();
  }
});

server.listen(config.port, () => {
  console.log(`Tour guide prototype on http://localhost:${config.port}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set: narration will fail. Copy .env.example to .env.");
  if (!config.accessToken) console.warn("ACCESS_TOKEN is not set: anyone with the URL can use the API. Set one before opening a tunnel.");
});
