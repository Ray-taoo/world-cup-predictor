# Local World Cup Sync

This phase is local only. Do not run remote Cloudflare commands.

## Site

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:3000/
```

## ESPN Sync Worker Core

Run parser/unit checks:

```powershell
npm run check:espn-sync
```

Run a recent ESPN sync into the isolated local sync database:

```powershell
npm run sync:espn:recent
```

Run a full ESPN sync for 2026-06-11 through 2026-07-19:

```powershell
npm run sync:espn:full
```

Retry analysis placeholder:

```powershell
npm run sync:espn:retry-analysis
```

Local sync data is written to:

```text
.local/worldcup-sync.sqlite
```

The existing website database remains:

```text
.local/worldcup.sqlite
```

These are intentionally separate until the Worker/D1 flow is fully verified.

## Forbidden In This Phase

Do not run:

```powershell
wrangler deploy
wrangler dev --remote
wrangler d1 execute --remote
wrangler secret put
```
