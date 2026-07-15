const baseUrl = process.env.SITE_HEALTH_URL ?? "http://127.0.0.1:3000";

const pages = ["/", "/matches", "/review", "/groups", "/bracket", "/sources"];
const forbidden = [
  "Unhandled Runtime Error",
  "Application error",
  "ERR_CONNECTION_REFUSED",
  "明日单场胜平负预测",
  "明日场次"
];

const failures = [];

for (const path of pages) {
  const url = `${baseUrl}${path}`;
  try {
    const response = await fetch(url, { redirect: "manual" });
    const body = await response.text();

    if (!response.ok) failures.push(`${path} returned HTTP ${response.status}`);
    for (const text of forbidden) {
      if (body.includes(text)) failures.push(`${path} contains stale/error text: ${text}`);
    }
  } catch (error) {
    failures.push(`${path} unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error("site health check failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`site health ok: ${pages.length} pages`);
