# Future Cloudflare Deployment Plan

No deployment is allowed in the current phase.

## Future Steps

1. Create or bind a production D1 database.
2. Apply `workers/worldcup-sync/migrations/` to production D1.
3. Set production environment variables:
   - `APP_ENV=production`
   - `ALLOW_PRODUCTION_WRITES=true`
   - `SYNC_SOURCE=espn`
   - admin secret for internal sync endpoints
4. Deploy `workers/worldcup-sync` as the sync Worker.
5. Configure Cron Trigger:
   - recent sync every 10 minutes
   - full sync daily
   - retry analysis every 30 minutes
6. Connect the public site to the same production data source.
7. Verify production pages.
8. Roll back by disabling Cron and reverting the Worker deployment.

## Current Safety Rule

Until the user explicitly says "开始部署到公网", do not run any remote Cloudflare command and do not write production data.
