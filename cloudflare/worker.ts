interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(sql: string): D1Statement;
}

interface AssetsBinding {
  fetch(input: Request | string | URL): Promise<Response>;
}

interface Env {
  DB: D1Database;
  ASSETS: AssetsBinding;
  ADMIN_SECRET?: string;
  CRON_SECRET?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface SnapshotRow {
  run_id: string;
  payload_json: string;
  checksum: string;
  generated_at: string;
}

interface SnapshotPayload {
  pageKey: string;
  path: string;
  generatedAt: string;
  html: string;
}

const pageRoutes = new Map([
  ["/", "home"],
  ["/bracket", "bracket"],
  ["/matches", "matches"],
  ["/review", "review"],
  ["/groups", "groups"],
  ["/sources", "sources"]
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (path.startsWith("/_next/") || path.startsWith("/fallback/") || path === "/favicon.ico") {
      return env.ASSETS.fetch(request);
    }

    if (request.method === "GET" && path === "/api/site-snapshot") {
      const pageKey = url.searchParams.get("page") ?? "home";
      if (![...pageRoutes.values()].includes(pageKey)) return json({ ok: false, error: "unknown page" }, 404);
      const row = await loadSnapshot(env.DB, pageKey);
      if (!row) return json({ ok: false, error: "snapshot unavailable" }, 503);
      return new Response(row.payload_json, { headers: snapshotHeaders(row, "application/json; charset=utf-8") });
    }

    if (request.method === "POST" && path === "/api/local-refresh") {
      return enqueueSync(env.DB, "public-refresh", "manual");
    }

    if (request.method === "POST" && path === "/api/cron/snapshot") {
      if (!authorized(request, env.CRON_SECRET)) return json({ ok: false, error: "unauthorized" }, 401);
      return enqueueSync(env.DB, "protected-cron", "cron-api");
    }

    if (request.method !== "GET" && path.startsWith("/api/")) {
      if (!authorized(request, env.ADMIN_SECRET)) return json({ ok: false, error: "admin authorization required" }, 401);
      return enqueueSync(env.DB, `admin:${path}`, "admin-api");
    }

    const pageKey = request.method === "GET" ? pageRoutes.get(path) : undefined;
    if (pageKey) return renderSnapshotPage(request, env, pageKey);

    return env.ASSETS.fetch(request);
  },

  scheduled(_event: unknown, env: Env, ctx: ExecutionContextLike): void {
    ctx.waitUntil(enqueueSyncRow(env.DB, "cloudflare-cron", "cloudflare-cron").then(() => undefined));
  }
};

async function renderSnapshotPage(request: Request, env: Env, pageKey: string): Promise<Response> {
  try {
    const row = await loadSnapshot(env.DB, pageKey);
    if (row) {
      const payload = JSON.parse(row.payload_json) as SnapshotPayload;
      return new Response(payload.html, { headers: snapshotHeaders(row, "text/html; charset=utf-8") });
    }
  } catch (error) {
    console.error("snapshot read failed", error instanceof Error ? error.message : "unknown error");
  }
  const fallback = new URL(`/fallback/${pageKey}.html`, request.url);
  return env.ASSETS.fetch(new Request(fallback, { method: "GET", headers: request.headers }));
}

function loadSnapshot(db: D1Database, pageKey: string): Promise<SnapshotRow | null> {
  return db.prepare(`
    SELECT p.run_id, p.payload_json, p.checksum, p.generated_at
    FROM site_snapshot_pointer AS active
    JOIN site_page_snapshots AS p ON p.run_id = active.active_run_id
    WHERE active.id = 1 AND p.page_key = ?
    LIMIT 1
  `).bind(pageKey).first<SnapshotRow>();
}

async function enqueueSync(db: D1Database, reason: string, requestedBy: string): Promise<Response> {
  const result = await enqueueSyncRow(db, reason, requestedBy);
  return json({ ok: true, accepted: true, requestId: result.requestId, duplicate: result.duplicate }, 202);
}

async function enqueueSyncRow(db: D1Database, reason: string, requestedBy: string): Promise<{ requestId: string; duplicate: boolean }> {
  const requestedAt = new Date().toISOString();
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const dedupeKey = `${reason}:${bucket}`;
  const requestId = crypto.randomUUID();
  const existing = await db.prepare("SELECT request_id FROM sync_requests WHERE dedupe_key = ? LIMIT 1")
    .bind(dedupeKey).first<{ request_id: string }>();
  if (existing) return { requestId: existing.request_id, duplicate: true };
  await db.prepare(`
    INSERT OR IGNORE INTO sync_requests
      (request_id, requested_at, requested_by, status, completed_at, error, dedupe_key)
    VALUES (?, ?, ?, 'pending', NULL, NULL, ?)
  `).bind(requestId, requestedAt, requestedBy, dedupeKey).run();
  return { requestId, duplicate: false };
}

function authorized(request: Request, secret?: string): boolean {
  if (!secret) return false;
  const bearer = request.headers.get("authorization");
  const explicit = request.headers.get("x-admin-secret") ?? request.headers.get("x-cron-secret");
  return bearer === `Bearer ${secret}` || explicit === secret;
}

function normalizePath(path: string): string {
  if (path === "/index.html") return "/";
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

function snapshotHeaders(row: SnapshotRow, contentType: string): Headers {
  return new Headers({
    "content-type": contentType,
    "cache-control": "public, max-age=60, stale-if-error=86400",
    "etag": `\"${row.checksum}\"`,
    "x-snapshot-run": row.run_id,
    "x-snapshot-generated-at": row.generated_at,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin"
  });
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}
