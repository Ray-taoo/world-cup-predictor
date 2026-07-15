import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const worker = path.join(root, ".open-next", "worker.js");
const generated = path.join(root, ".open-next", "worker-next.js");

if (!fs.existsSync(worker)) throw new Error("OpenNext worker output is missing");
fs.rmSync(generated, { force: true });
fs.renameSync(worker, generated);
fs.writeFileSync(worker, `import generated from "./worker-next.js";
import { syncWorkerResults } from "../src/lib/cloudflare-result-sync";

export * from "./worker-next.js";

export default {
  fetch: generated.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(syncWorkerResults(env.DB).catch((error) => console.error("scheduled result sync failed", error)));
  }
};
`, "utf8");
