import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const root = process.cwd();
const site = (process.env.SITE_SNAPSHOT_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const output = path.resolve(process.env.SITE_SNAPSHOT_DIR ?? path.join(root, ".snapshot"));
const dataDir = path.resolve(process.env.WORLD_CUP_DATA_DIR ?? path.join(root, ".local"));
const pages = [
  ["home", "/"],
  ["bracket", "/bracket"],
  ["matches", "/matches"],
  ["review", "/review"],
  ["groups", "/groups"],
  ["sources", "/sources"]
];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, "pages"), { recursive: true });

const generatedAt = new Date().toISOString();
const captured = [];
for (const [pageKey, route] of pages) {
  const response = await fetch(`${site}${route}`, { headers: { accept: "text/html", "cache-control": "no-cache" } });
  const html = await response.text();
  if (!response.ok) throw new Error(`${route} returned ${response.status}`);
  if (!/^<!doctype html>/i.test(html)) throw new Error(`${route} did not return an HTML document`);
  if (/worker threw exception|error code:\s*11(?:01|02)|internal server error/i.test(html)) {
    throw new Error(`${route} contains a Worker/runtime error`);
  }
  if (html.length > 1_500_000) throw new Error(`${route} snapshot exceeds 1.5 MB`);
  const checksum = sha256(html);
  const payload = { pageKey, path: route, generatedAt, html };
  fs.writeFileSync(path.join(output, "pages", `${pageKey}.json`), JSON.stringify(payload));
  captured.push({ pageKey, path: route, checksum, bytes: Buffer.byteLength(JSON.stringify(payload)) });
}

const combined = captured.map((page) => fs.readFileSync(path.join(output, "pages", `${page.pageKey}.json`), "utf8")).join("\n");
for (const marker of ["M073", "M100"]) {
  if (!combined.includes(marker)) throw new Error(`snapshot acceptance marker missing: ${marker}`);
}
const bracketHtml = JSON.parse(fs.readFileSync(path.join(output, "pages", "bracket.json"), "utf8")).html;
const knockoutScoreStat = bracketHtml.match(/比分[\s\S]{0,40}?(\d+)\/(\d+)=\d+(?:\.\d+)?%/);
if (!knockoutScoreStat || Number(knockoutScoreStat[2]) < 28) {
  throw new Error("snapshot knockout score statistic missing or incomplete");
}
if (combined.includes("coffee-warbler.workers.dev")) throw new Error("old workers.dev subdomain found in snapshot");
if (/\.local[\\/]|worldcup\.sqlite/.test(combined)) {
  throw new Error("local path or database name leaked into snapshot");
}

const sourceUpdatedAt = await readSourceUpdatedAt();
const checksum = sha256(captured.map((page) => `${page.pageKey}:${page.checksum}`).join("\n"));
const runId = `${generatedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${checksum.slice(0, 12)}`;
const manifest = {
  runId,
  generatedAt,
  sourceUpdatedAt,
  schemaVersion: 1,
  checksum,
  totalBytes: captured.reduce((sum, page) => sum + page.bytes, 0),
  pages: captured
};
fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));

function readSourceUpdatedAt() {
  const databasePath = path.join(dataDir, "worldcup.sqlite");
  if (!fs.existsSync(databasePath)) return generatedAt;
  return readDatabaseTimestamp(databasePath);
}

async function readDatabaseTimestamp(databasePath) {
  const SQL = await initSqlJs({ locateFile: (file) => path.join(root, "node_modules", "sql.js", "dist", file) });
  const db = new SQL.Database(fs.readFileSync(databasePath));
  const value = db.exec("SELECT MAX(updated_at) FROM overrides")[0]?.values?.[0]?.[0];
  db.close();
  return value ? String(value) : generatedAt;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
