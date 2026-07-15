import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, ".worker-assets");
const snapshotDir = path.resolve(process.env.SITE_SNAPSHOT_DIR ?? path.join(root, ".snapshot"));

fs.mkdirSync(output, { recursive: true });
for (const entry of fs.readdirSync(output)) {
  fs.rmSync(path.join(output, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

const nextStatic = path.join(root, ".next", "static");
if (!fs.existsSync(nextStatic)) throw new Error("Next static assets are missing; run npm run build first");
fs.cpSync(nextStatic, path.join(output, "_next", "static"), { recursive: true });

const publicDir = path.join(root, "public");
if (fs.existsSync(publicDir)) fs.cpSync(publicDir, output, { recursive: true });

const fallbackDir = path.join(output, "fallback");
fs.mkdirSync(fallbackDir, { recursive: true });
for (const pageKey of ["home", "bracket", "matches", "review", "groups", "sources"]) {
  const payloadPath = path.join(snapshotDir, "pages", `${pageKey}.json`);
  if (!fs.existsSync(payloadPath)) throw new Error(`snapshot payload missing: ${pageKey}`);
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  fs.writeFileSync(path.join(fallbackDir, `${pageKey}.html`), payload.html);
}

const files = walk(output);
console.log(JSON.stringify({ output, files: files.length, bytes: files.reduce((sum, file) => sum + fs.statSync(file).size, 0) }, null, 2));

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
