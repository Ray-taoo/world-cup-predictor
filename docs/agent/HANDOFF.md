# Handoff

## 2026-07-15 Cloudflare Free deployment

The public site now uses a CPU-safe snapshot Worker at `https://worldcup-predictor.worldcupball.workers.dev/`. GitHub Actions renders the existing Next.js pages against a temporary D1 export, publishes six page snapshots through an atomic D1 pointer, and only deploys Worker code on code/manual runs. The Worker performs one D1 query per page and falls back to bundled HTML. Current version is `6ef621fc-c4fe-4893-a1ce-7d978a885303`; the original rollback target remains `9c8180ed-4551-47d3-8558-f1fcfffd45b4`. D1 migration `0003_site_snapshots.sql` is applied. Do not restore the failed OpenNext versions.

## Current state

Public deployment was attempted on 2026-07-13. The current public Worker is safely rolled back to `9c8180ed-4551-47d3-8558-f1fcfffd45b4` at `https://worldcup-predictor.worldcupball.workers.dev/`; do not use the old coffee-warbler URL. D1 `worldcup-predictor-data` exists and contains the current imported local data. Candidate OpenNext Worker versions `c60464e8-4209-4aca-a663-848737c81ccd` and `2bb7a4fa-577c-4103-a011-487310443087` were rolled back after public 1102 resource-limit failures. The account's Free Worker CPU ceiling cannot run the present server-rendered full-data predictions. Before any retry, serve a persisted D1 prediction/simulation snapshot or move to a Workers Paid CPU budget. Do not keep re-running Wrangler OAuth login: the completion token is one-time and nested OpenNext deployment intermittently consumes it.

Generic knockout scoreline displays use exactly three scores. On `/bracket`, M073-M084 preserve the original Baseline direction-filtered Top3 used for those first 12 matches; M085 onward uses Hybrid V2 raw Top3. The column omits model-name text, and the mixed-model hit KPI is currently `17/28=60.7%`. Homepage future-match scorelines remain Hybrid V2. Knockout hit rates compare against the network-fetched 90-minute result including stoppage time, never final extra-time or shootout totals. `refresh:results` compensates beyond the recent window when a completed knockout match lacks a normal-time score; M073-M100 all have theScore normal-time data.

Local-only result recovery now has a working automatic fallback. The public Worker at `https://worldcup-predictor.coffee-warbler.workers.dev/` was not deployed or modified.

`/bracket` is now a local-only responsive knockout tree instead of the old plain bracket/table layout. It uses existing fixtures, overrides, odds, predictions, and simulation output only; no model/data-sync/public logic was changed.
The follow-up layout pass removed forced horizontal scrolling, fixed center-card overlap, restored the group-stage per-match table on `/bracket`, and replaced the homepage overview with the same prediction-filled tree format.
Homepage and `/bracket` tree team prefixes now use shared English abbreviations through `teamCode()`, so missing teams no longer fall back to diamonds or flag glyphs.
Homepage model-comparison cards now show a clear model heading and distinct 90-minute W/D/L probability row; supporting metrics remain below in labeled rows.
Homepage and `/bracket` now share `src/components/KnockoutTree.tsx`; its displayed champion follows the same visible knockout path rather than a separate aggregate simulation ranking.
The shared `.shell` now matches the knockout tree width: 1500px maximum with a 40px viewport gutter.
Future knockout scoreline displays now use raw model top-three score probabilities instead of filtering to match the selected 1X2 direction. M097 France vs Morocco now shows `1-0 / 1-1 / 2-1` on homepage and `/bracket`.
Manual local refresh no longer waits for the full `refresh:tomorrow` command inside the HTTP request. `/api/local-refresh` starts it in the background, writes `.local/manual-refresh*.log`, and returns immediately so the review-page button does not spin for minutes.

Sofascore currently returns HTTP 403 on this machine, so the operational schedule fallback is The Odds API event feed using local `ODDS_API_KEY`. Result refresh runs through openfootball, verified supplements, automatic theScore date schedule pages, FIFA article attempts, then configured web fallbacks. API-Football and ESPN are not in the normal local refresh path.

## Main flow

```text
Sofascore JSON if reachable, otherwise The Odds API event feed
-> workers/worldcup-sync/src/worldcup_sync_service.py
-> .local/worldcup-sync.sqlite
-> src/data/live-fixtures.json
-> src/lib/data.ts and src/lib/db.ts
-> local Next.js pages

openfootball + supplements + theScore date pages + FIFA article attempts + configured web fallbacks
-> scripts/refresh-results.mjs
-> .local/worldcup.sqlite overrides
```

`live-fixtures.json` contains M089-M104 so future knockout matches appear before teams are known. Full/recent sync updates the same M ids and completed scores are read as overrides.

Local startup recovery is non-blocking: `scripts/start-local-site.ps1` and `npm run start:local` both start `refresh:results` in the background, log failures, and continue starting the site.

## Commands

```powershell
npm install
npm run check:worldcup-sync
npm run sync:worldcup:full
npm run refresh:tomorrow
npm run check:tomorrow-model-eval
npm run typecheck
npm run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-local-site.ps1
```

## Verified

- Python parser/storage tests pass.
- TypeScript typecheck passes.
- Next.js production build passes.
- `npm run refresh:tomorrow` passes.
- Local homepage returns HTTP 200 and includes Canada/Morocco plus odds/market text.
- Current DB has 17,615 odds rows; M089-M096 all have odds rows.
- Current homepage HTTP check passes: status 200, France/Morocco text visible, no `等待官方赛果源` or `等待赛果更新` text.
- Playwright Chromium check passes with local executable path; homepage status 200, title `世界杯预测`, match and odds text visible, no waiting-result text.
- 2026-07-09 UI check passes with local Chrome: homepage and `/bracket` tree prefixes contain `ZA`, `SE`, `CD`, `EN` and no diamond/flag glyphs. Screenshots: `.local/verification/home-team-codes.png`, `.local/verification/bracket-team-codes.png`.
- 2026-07-09 raw knockout scoreline check passes: homepage M097 text shows `1-0 / 1-1 / 2-1`; `/bracket` M097 row shows `1-0 / 1-1 / 2-1`; `npm run typecheck`, `npm run check:model-variants`, `npm run check:site-health`, and `npm run check:prediction-snapshots` pass.
- 2026-07-09 three-model pre-match eval report exists at `scripts/check-tomorrow-model-eval.mjs`, command `npm run check:tomorrow-model-eval`, output `.local/tomorrow-model-eval.json`. It prefers M097/M098 and falls back to nearest 2-4 future matches, reports raw top-three scorelines, model disagreement, odds timestamp, missing inputs, and strict post-match metrics only when a final result plus pre-kickoff snapshot exists.
- Latest three-model eval checks passed: `npm run typecheck`, `npm run check:model-variants`, `npm run snapshots:capture` (`inserted: 0`, `skipped: 12`), `npm run check:prediction-snapshots` (`predictionSnapshotsChecked: 136`), and `npm run check:tomorrow-model-eval`.
- Repeated recent sync remains idempotent: M089-M096 stay at 8 unique rows.
- 2026-07-05: M089/M090 no longer wait for results. `scripts/refresh-results.mjs` now merges `live-fixtures.json` and automatically discovers finished results from theScore date pages, e.g. `https://www.thescore.com/worldcup/events/2026-07-04` -> events `93020/93019`. No manual M089/M090 URL is needed in `result-web-sources.json`.
- Forced openfootball failure still recovered automatic theScore results. Latest normal result sync: `scoredFound=72`, `matched=72`, `supplemental=8`, `theScoreResults=8`, `fifaResults=0`, `webResults=3`, `combined=90`.
- `npm run check:result-sync` includes regression coverage for article-style result text and theScore date-page event parsing.
- 2026-07-07 read-only model diagnostics export exists at `docs/model-audit/`. Command: `npm run audit:model`. Latest run covered 104 matches and 92 completed matches; checks passed: audit, script syntax, typecheck, site health. It includes 0-6 score matrices, market correlation, calibration bins, concentration buckets, focus-match diagnostics, and model clamp/code-location notes. It does not modify model weights or SQLite data.
- `completed-match-evaluation.csv` is strict: it only uses archived pre-match prediction snapshots. Current local snapshots do not cover completed matches, so strict evaluated count is 0. Current-model replay metrics are in JSON/summary as diagnostic-only.
- 2026-07-07 short-term model iteration is local-only and experimental. `src/lib/model-variants.ts` adds `market-only-v1`, `baseline-v1-market-elo`, and `hybrid-v2-knockout` side by side. Homepage shows a compact comparison block, but Baseline V1 is not replaced.
- Pre-match snapshots are active locally through `npm run snapshots:capture` and `npm run snapshots:stats`. Current DB has 30 snapshots: 10 per model, all `T-24h`. T-24h/T-6h/T-1h input bundles are compact; only `FINAL_PREMATCH` stores full 0-6 matrices. Duplicate capture inserted 0 and skipped 15 after compaction. Capture is non-blocking in `refresh:tomorrow` and `scripts/start-local-site.ps1`.
- Model diagnostics now pages snapshot reads in batches of 500 and can evaluate all three model versions separately once captured snapshots become completed matches. Current strict count is still 0 because captured snapshots are for future matches.
- Baseline comparison guard is active. `baseline-v1-market-elo` in `/api/model-comparison` must equal the official `predictionForMatch(...).blended` probabilities; `npm run check:model-variants` enforces this plus DC matrix normalization, model presence, missing-market degradation, and TBD exclusion.
- Current snapshot stats after snapshot lambda-column closeout: 93 snapshots, DB size 3,387,392 bytes, average payload bytes per snapshot 994, average DB bytes per snapshot 36,424, full matrices 0, by type T-24h 81 / T-6h 12, by model Baseline 32 / Hybrid 32 / Market-only 29, `lambdaTotalRows` 78, `marketTotalRows` 14. Duplicate capture inserted 0 and skipped 15.
- Homepage model comparison cards now include 90-minute W/D/L, xG, top3 scores, total goals, over 2.5, BTTS, advancement, confidence, market-data completeness, missing inputs, and market/team/final lambda correction text. Lineup, injury, weather, and venue are explicitly marked as not included.
- `/api/model-comparison` exposes match-level `oddsTimestamp`; snapshot capture writes it to `prediction_snapshots.odds_timestamp`. Current API sample: M095/M096 have `2026-07-07T05:05:46Z`, while M097+ are null because no local odds rows exist yet.
- `scripts/refresh-local-inputs.mjs` now captures pre-match snapshots after local input/result/odds refresh, matching the objective that snapshots are generated by local data-refresh flows.
- Model variant output now includes `lambdaTotal` and `lambdaDifference`; component lambdas expose market/team/final total and difference. `npm run check:model-variants` guards the arithmetic.
- `prediction_snapshots` now has nullable lambda total/difference columns for market/team/final. Snapshot capture migrates old local DBs and backfills totals/differences from existing home/away lambda columns.
- Snapshot capture failure is now recorded without blocking local refresh flows. `scripts/refresh-local-inputs.mjs` and `scripts/refresh-tomorrow.mjs` write `.local/pre-match-snapshot-error.json` on snapshot failure; a later successful snapshot capture removes it.
- Latest snapshot reads now have a scoped local path: `src/lib/prediction-snapshots.ts` and `GET /api/snapshots/latest?matchId=...&modelVersion=...` use `WHERE match_id = ? AND model_version = ? AND generated_at < kickoff_time ORDER BY generated_at DESC LIMIT 1`, avoiding whole-table snapshot loads for page/API reads.
- Snapshot capture creates `idx_prediction_snapshots_latest(match_id, model_version, generated_at DESC)`. `npm run check:snapshot-read-path` verifies the latest-snapshot query uses that index.
- `npm run check:prediction-snapshots` is the read-only snapshot integrity guard. Latest run checked 93 snapshots with 0 duplicate keys and 0 missing input bundles.
- Real OU/AH odds are now in the local chain. `odds_quotes` stores totals and handicap columns; latest local refresh imported 125 odds rows and DB counts are 18,510 total rows, 118 totals rows, 56 handicap rows, 0 BTTS rows. The Odds API rejects BTTS for this sport endpoint with HTTP 422, API-Football free plan has no 2026 odds access, and Polymarket/Nansen returned no active BTTS World Cup markets, so BTTS is still missing by source limitation.
- `market-only-v1` now merges latest H2H with latest available OU/AH/BTTS rows per match and current next-match output is `partial` with only `btts` missing.
- `hybrid-v2-knockout` now uses an independent team attack/defense lambda layer from Elo, recent goals for/against, and manual absence counts. Baseline is still unchanged; `npm run check:model-variants` checks Baseline equality, OU/AH usage, and Hybrid team lambdas not being identical to Baseline xG.
- Latest urgent checks passed: `node --check scripts/capture-prediction-snapshots.mjs`, `node --check scripts/snapshot-stats.mjs`, `node --check scripts/check-model-variants.mjs`, `npm run typecheck`, `npm run check:model-variants`, `npm run snapshots:capture`, `npm run snapshots:stats`, `npm run check:site-health`, `npm run check:scorelines`, `npm run check:current-predictions`, `npm run audit:model`.

## Open item

Sofascore 403 is preserved as a partial-source error; fallback keeps future fixtures current but does not provide final scores. Completed knockout results are now automatically recovered from theScore date pages when openfootball lags. FIFA official article pages currently return only the frontend shell to direct fetch, so FIFA remains an attempted source but produced `fifaResults: 0` in the latest run. Public deployment still requires replacing the local SQLite adapter with a D1 adapter.

Strict historical model evaluation still needs archived pre-kickoff prediction snapshots for completed matches.
Hybrid V2 remains experimental until strict pre-match snapshots produce enough completed-match evaluation rows.

The strict evaluation report now retains completed matches from frozen pre-match reports and emits `completedEvaluationSummary`. M097 (2-0) is the first strict knockout comparison: Baseline currently beats Hybrid on log loss/Brier, so keep Baseline unchanged and wait for 8-12 strict samples before changing experimental weights.
The cumulative summary now comes from all completed strict snapshots in `.local/worldcup.sqlite`, not from the overwritten prematch/postmatch JSON files. Each model summary includes `evaluatedMatchIds`.

Real local inputs are now active for M099-M101: 12 complete The Odds API event-level BTTS rows, 3 FotMob injury feeds, and 3 Open-Meteo forecasts. Confirmed lineup count is still 0 because the source currently reports predicted/lastStarting11; Hybrid keeps that input missing. Normal weather produced multiplier 1 for all three matches. Baseline is unchanged.
Homepage now reads the same match context as the API. Market-only/Baseline explicitly label new context as excluded by model definition; Hybrid displays injury/weather/venue as included. Read-path and deterministic-computation caches reduced warm homepage response to about 1.3 seconds while invalidating automatically when SQLite/snapshot inputs change.

Latest bracket verification screenshots:
- `.local/verification/bracket-desktop-1440x900.png`
- `.local/verification/bracket-tablet-1024x768.png`
- `.local/verification/bracket-mobile-375x812.png`
- `.local/verification/home-desktop-1440x900.png`
- `.local/verification/home-tablet-1024x768.png`
- `.local/verification/home-mobile-375x812.png`
