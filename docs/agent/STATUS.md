# Project Status

## Latest 2026-07-15 Cloudflare Free deployment

- Replaced request-time OpenNext/model/simulation work with precomputed page snapshots stored in D1 and a 2 KB Worker request path.
- Added GitHub Actions schedule `*/15 * * * *`, manual dispatch, D1 export/temporary SQLite restore, verified result refresh, model checks, 10,000-run page rendering, checksum validation, and atomic snapshot pointer updates.
- Added D1 migration `0003_site_snapshots.sql`; production migration is applied and six active snapshots are published.
- Public Worker version after `ADMIN_SECRET` setup: `6ef621fc-c4fe-4893-a1ce-7d978a885303`. Rollback target: `9c8180ed-4551-47d3-8558-f1fcfffd45b4`.
- Public six-page smoke test and desktop/mobile browser checks pass without 1102 or console errors.

## Active objective

Deploy the current site to `worldcup-predictor.worldcupball.workers.dev` only after Worker CPU-safe rendering is available.

## Latest 2026-07-13 Cloudflare attempt

- Account `Rays` / subdomain `worldcupball`; Worker `worldcup-predictor`; rollback target and current public version: `9c8180ed-4551-47d3-8558-f1fcfffd45b4`.
- Created D1 `worldcup-predictor-data` (`fb8c88e6-41af-4f6f-b372-9fdfa5b72845`), applied migrations `0001` and `0002`, and idempotently imported: overrides 100, odds_quotes 17,839, team_inputs 48, result_sync_status 28, prediction_snapshots 188, input bundles 178, result_sync_events 1,431, match_context 3, matches 14.
- OpenNext Cloudflare build, D1 binding, cron `*/15 * * * *`, result-sync secret, and local preview were implemented and validated locally. `typecheck`, model/result/snapshot/site-health checks and build passed.
- Public candidate versions `c60464e8-4209-4aca-a663-848737c81ccd` and `2bb7a4fa-577c-4103-a011-487310443087` returned Cloudflare 1102 on dynamic pages. Cloudflare documents 1102 as Worker CPU/memory resource exhaustion; this account's Free CPU limit cannot support the current server-rendered full-data prediction pages. Both candidates were rolled back immediately without changing D1.
- Do not retry public deployment with `wrangler login`/`deploy` until using a persisted precomputed prediction/simulation view or a Workers Paid CPU budget. Wrangler/OpenNext also intermittently consumes the one-time OAuth completion token during nested deploys; this is not API/model token usage.

## Latest 2026-07-10 UI check

- Homepage model-comparison cards now separate model name, 90-minute W/D/L label, three emphasized outcome probabilities, and supporting inputs. Replaced dense dash-separated output with labeled fields and visible separators.
- Verified locally: `npm run typecheck` passes; desktop cards render at 602px wide with a flex outcome row; mobile switches to one column. Screenshots: `.local/verification/model-comparison-card.png`, `.local/verification/model-comparison-mobile.png`.

## Latest 2026-07-12 UI check

- `/bracket` now uses the requested historical model split: M073-M084 show the original Baseline direction-filtered Top3; M085+ show Hybrid V2 raw Top3. The score column has no repeated model label. Runtime mixed-model 90-minute score KPI: `17/28=60.7%`.

- Fixed scoreline consistency: `ScorelineChips` caps supplied model lists at three; homepage future cards use Hybrid V2, while `/bracket` follows the M073-M084 Baseline / M085+ Hybrid split.
- Removed the historical result-window gap. Automatic theScore schedule/detail discovery now fetches missing normal-time scores for every completed knockout match, not only recent fixtures. M073-M100 coverage is 28/28 with no `90分钟待同步`; M075/M076 penalties and all extra-time scores remain separate from normal time.
- Runtime verification: France vs Spain opening card and reason both show Hybrid `1-1 17.1% / 0-0 10.3% / 2-1 9.1%`; `/bracket` shows exactly three scores per row and current mixed-model normal-time score KPI `17/28=60.7%`.

- The homepage `近期单场胜平负预测` board retains Baseline 1X2 direction but now displays the raw Hybrid V2 Top3 scorelines, with an explicit source label.
- The knockout scoreline table and score-hit KPI use the same per-match Baseline/Hybrid split and compare only the 90-minute score including stoppage time. Matches without a confirmed normal-time score are excluded from the score denominator rather than compared against final extra-time/shootout totals.
- `refresh:results` parses theScore event `line_scores`, stores normal-time and extra-time scores separately in `result_sync_status`, and backfills previously stored theScore events automatically. Current coverage is M073-M100; M099 final `1-2` / 90-minute `1-1`, M100 final `3-1` / 90-minute `1-1`.
- Verified: `npm run check:result-sync`, `npm run refresh:results` (`normalTimeBackfilled: 17`), `npm run typecheck`, `npm run check:model-variants`, `npm run check:site-health`, plus local homepage and `/bracket` HTTP 200 checks.

- Homepage and `/bracket` now use one `KnockoutTree` component. Its final card is resolved from the same completed-result/predicted-advance path as the visible semifinal cards; the center no longer mixes in a separate tournament-wide champion ranking.
- The tree is 1400px wide on both pages and collapses to one column on mobile. Verified locally with `npm run typecheck` and browser checks: France vs Spain is visible, neither page shows Spain as the path champion, and both show Argentina as the current final-path champion.
- The shared page shell now uses the same 1500px desktop width and 40px viewport gutter as the knockout tree, so `/bracket` result rows and homepage sections align with their overview tree.

## Implemented

- Confirmed Sofascore returns HTTP 403 locally; added The Odds API event-feed fallback for future knockout schedule when Sofascore fails.
- Unified future schedule discovery and completed-result ingestion in `worldcup_sync_service.py`.
- Added paginated full sync and lightweight recent sync.
- Added status, score, penalty score, winner, venue, raw JSON and external event id parsing.
- Added idempotent SQLite upsert keyed by provider plus external event id.
- Added matching to existing M001-M104 ids and conversion of old-provider rows.
- Added cached M089-M104 knockout schedule and automatic winner/loser slot resolution.
- Merged live fixtures into the website data layer.
- Updated home/matches/review stage labels and pending-result wording.
- Removed API-Football and ESPN from the normal local refresh path.
- Fixed `refresh:tomorrow` so it always runs result refresh after schedule sync, even when the schedule fallback succeeds.
- Fixed `check-current-predictions` to include `src/data/live-fixtures.json`.
- Refreshed real odds through The Odds API; M089-M096 now have odds rows.
- Added a cross-platform Python launcher for Windows and Linux.
- Kept all work local. No deploy, remote D1 command, public write or Cloudflare API mutation was performed.

## Verification

- `npm run check:worldcup-sync`: passed.
- `npm run refresh:tomorrow`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run check:prediction-board`: passed.
- `npm run check:site-health`: passed after clearing stale `.next` and restarting local dev server.
- Homepage HTTP check: 200, includes Canada/Morocco and odds/market text.
- Playwright Chromium check: HTTP 200, title `世界杯预测`, current match text present, odds/market text present, no `等待官方赛果源`; reload produced no 4xx/5xx responses.
- Duplicate sync check: two repeated `sync:worldcup:recent` runs left M089-M096 at 8 unique rows.
- Fixture integrity check: 104 unique M ids, M001-M104 complete.
- Current odds DB count: 17,615 rows; M089-M096 have odds rows.
- 2026-07-05 refresh: M089 Paraguay 0-1 France and M090 Canada 0-3 Morocco were parsed from configured web result sources and inserted into overrides. `pendingResults` is empty, M089/M090 appear in completed ids.
- 2026-07-05 Playwright check: homepage 200, no `等待官方赛果源`/`等待赛果更新`, France/Morocco review text visible, no 4xx/5xx responses.
- 2026-07-05 regression: `npm run check:result-sync` now covers article-style result parsing for `Canada 0-3 Morocco` and `France’s 1-0 win over Paraguay`.

## Latest 2026-07-05

- M089/M090 no longer depend on manually configured web URLs. `scripts/refresh-results.mjs` now auto-fetches theScore date pages around each kicked-off fixture, parses structured event id/status/score, and writes final scores through the same idempotent result path.
- Startup recovery now runs `npm run refresh:results` directly in `scripts/start-local-site.ps1` before starting the local site, instead of trying API-Football first and falling back after failure.
- Startup recovery is now non-blocking in both `scripts/start-local-site.ps1` and `scripts/start-local.mjs`; result sync starts in the background and the site starts immediately.
- Latest normal sync: `scoredFound=72`, `matched=72`, `supplemental=8`, `theScoreResults=8`, `fifaResults=0`, `webResults=3`, `combined=90`.
- Forced openfootball failure still recovered automatic theScore results, so a primary-source miss no longer leaves recent finished knockout matches stuck in waiting.
- `result_retry_count` now drives `next_retry_at` with real exponential backoff instead of resetting to the first retry interval on every failed check.
- Latest checks passed: `npm run check:result-sync`, `npm run typecheck`, `npm run build`, `npm run check:prediction-board`, and `npm run check:site-health`. Homepage HTTP check returned 200 with no waiting-result text.

## Latest 2026-07-07

- Added a read-only model diagnostics export: `npm run audit:model`.
- The export writes only under `docs/model-audit/` and does not update model weights, predictions, odds, results, SQLite data, local env files, or any public Cloudflare resource.
- Latest export covered 104 matches, 92 completed matches, and wrote model diagnostics JSON/CSV, scoreline frequency CSV, completed-match evaluation CSV, and a summary markdown.
- The export now includes 0-6 score matrices, extra odds-null fields, market correlation, calibration bins, stage/time evaluation, concentration buckets, focus-match diagnostics, lambda duplicate checks, and model clamp/code-location notes.
- Completed-match evaluation now uses strict pre-match archived snapshots only. Current local snapshots do not cover completed matches, so strict evaluated count is 0; 92 completed-match current-model replay rows are kept only as diagnostic summary, not as out-of-sample backtest.
- Latest checks passed: `npm run audit:model`, `node --check scripts/export-model-diagnostics.mjs`, `npm run typecheck`, and `npm run check:site-health`.
- Important limitation: strict pre-match backtesting still requires archived pre-kickoff prediction snapshots for completed matches.

## Latest 2026-07-07 Short-Term Model Iteration

- Added local-only experimental model comparison without replacing Baseline V1:
  - `market-only-v1`
  - `baseline-v1-market-elo`
  - `hybrid-v2-knockout`
- Added `src/lib/model-variants.ts` with 1X2-only market lambda solving, team/model lambda comparison, knockout 90-minute vs advance separation, and Dixon-Coles low-score correction for Hybrid V2.
- Added local API `GET /api/model-comparison` and a compact homepage comparison block for upcoming matches.
- Added pre-match snapshot capture:
  - `npm run snapshots:capture`
  - `npm run snapshots:stats`
  - SQLite tables: `prediction_snapshots` and `prediction_input_bundles`
  - Unique key prevents duplicate snapshots for the same match/model/type/input hash.
- Snapshot capture is wired into `npm run refresh:tomorrow` and `scripts/start-local-site.ps1` as non-blocking local work.
- Snapshot capture now keeps T-24h/T-6h/T-1h input bundles compact; only `FINAL_PREMATCH` stores the full 0-6 matrix.
- Current snapshot stats: 30 snapshots, 10 per model, all `T-24h`, DB size 3,133,440 bytes, average DB bytes per snapshot 104,448, no full matrices yet because no `FINAL_PREMATCH` snapshot window was reached.
- `completed-match-evaluation.csv` now reads `prediction_snapshots` by pages of 500 and is ready to evaluate all three models separately once these snapshots become completed matches. Current strict count remains 0 because all captured snapshots are for future matches.
- Latest checks passed: `npm run snapshots:capture`, duplicate capture inserted 0/skipped 15, `npm run snapshots:stats`, `npm run audit:model`, `npm run typecheck`, `npm run check:site-health`, `npm run check:scorelines`, `npm run check:current-predictions`, no API key grep hit in audit outputs, and direct `/api/model-comparison` matrix normalization check with max error `5.55e-16`.
- No public deploy, remote D1 write, production DB write, historical-result weight tuning, or random score diversification was performed.

## Latest 2026-07-07 Baseline Guard

- Fixed the `baseline-v1-market-elo` comparison row so its 90-minute 1X2 probabilities equal the existing official `predictionForMatch(...).blended` output. Before this, the comparison row recomputed 1X2 from xG only, which could make Baseline appear changed even though the official prediction was unchanged.
- Added `npm run check:model-variants` to verify:
  - all three model versions are present,
  - Baseline comparison probabilities exactly match the official Baseline reference,
  - h2h-only market degradation records missing `over_under`, `asian_handicap`, and `btts`,
  - TBD/placeholder teams do not enter model comparison,
  - Dixon-Coles/full score matrices normalize within `1e-6`.
- Snapshot stats after corrected capture: 42 snapshots, DB size 3,182,592 bytes, average DB bytes per snapshot 75,776, full matrices 0, by model: Baseline 15, Hybrid 15, Market-only 12. Duplicate capture inserted 0/skipped 15.
- Latest sample next match difference from `/api/model-comparison`: Argentina vs Egypt: Market-only 71.8/19.6/8.7, Baseline 73.2/19.1/7.7, Hybrid V2 82.6/13.5/4.0.

## Latest 2026-07-07 Urgent Closeout

- Homepage model comparison now shows the requested comparison fields in one compact card: 90-minute W/D/L, xG, top3 scores, total goals, over 2.5, BTTS, advancement, confidence, market-data completeness, missing market inputs, and market/team/final lambda correction text. Lineup, injury, weather, and venue are explicitly marked as not included instead of silently treated as zero.
- Snapshot payload stats now report estimated per-row payload bytes separately from whole-DB bytes per snapshot.
- Current snapshot stats: 57 snapshots, DB size 3,248,128 bytes, full matrices 0, by model: Baseline 20, Hybrid 20, Market-only 17. Re-running capture inserted 0 and skipped 15, so duplicate snapshots are still blocked.
- Latest checks passed: `node --check` for snapshot scripts and model-variant check, `npm run typecheck`, `npm run check:model-variants`, `npm run snapshots:capture`, `npm run snapshots:stats`, `npm run check:site-health`, `npm run check:scorelines`, `npm run check:current-predictions`, and `npm run audit:model`.
- Homepage HTTP check returned 200 and included the new BTTS/model-comparison content. No public deploy or remote write was performed.

## Latest 2026-07-07 Snapshot Odds Timestamp

- `/api/model-comparison` now exposes the latest local odds timestamp per match. `scripts/capture-prediction-snapshots.mjs` writes that value into `prediction_snapshots.odds_timestamp` and includes it in the input hash, so market-backed snapshots have traceable odds timing without changing model probabilities.
- `npm run check:model-variants` now fails if a `h2h_only` market-backed comparison has no match-level `oddsTimestamp`.
- Current API sample: M095/M096 have `2026-07-07T05:05:46Z`; M097+ are `null` because those future fixtures do not yet have local odds rows.
- Current snapshot stats: 72 snapshots, DB size 3,305,472 bytes, full matrices 0, by model: Baseline 25, Hybrid 25, Market-only 22. Re-running capture inserted 0 and skipped 15.
- Latest checks passed: `node --check scripts/capture-prediction-snapshots.mjs`, `node --check scripts/check-model-variants.mjs`, `npm run typecheck`, `npm run check:model-variants`, `npm run snapshots:capture`, `npm run snapshots:stats`, and `npm run check:site-health`.

## Latest 2026-07-07 Local Input Snapshot Hook

- `scripts/refresh-local-inputs.mjs` now runs `npm run snapshots:capture` after local input, recent result, and odds refresh. This closes the explicit objective gap that snapshots should be generated after local data refresh flows, not only after `refresh:tomorrow` or site startup.
- The refresh script logging was changed to ASCII-only text to avoid console mojibake while preserving behavior.
- Current snapshot stats: 78 snapshots, DB size 3,317,760 bytes, by type: T-24h 72 / T-6h 6, full matrices 0, input bundles 72, dedupe saved rows 6. Re-running capture inserted 0 and skipped 15.
- Latest checks passed: `node --check scripts/refresh-local-inputs.mjs`, `npm run snapshots:capture`, `npm run snapshots:stats`, `npm run typecheck`, and `npm run check:site-health`.

## Latest 2026-07-07 Lambda Total/Difference

- Model variant output now includes `lambdaTotal` and `lambdaDifference` in addition to home/away lambdas. `componentLambdas` also exposes market/team/final total and difference, closing the explicit market solver output gap for `lambda_market_total` and `lambda_market_difference`.
- Snapshot input bundles now include `lambdaTotal` and `lambdaDifference`, so the immutable pre-match inputs preserve those values.
- `npm run check:model-variants` now verifies `lambdaTotal = lambdaHome + lambdaAway` and `lambdaDifference = lambdaHome - lambdaAway` for every variant with lambdas.
- API sample: M095 `market-only-v1` home 2.25, away 0.60, total 2.85, difference 1.65.
- Current snapshot stats: 93 snapshots, DB size 3,383,296 bytes, by type: T-24h 81 / T-6h 12, full matrices 0, by model: Baseline 32, Hybrid 32, Market-only 29. Duplicate capture inserted 0 and skipped 15.
- Latest checks passed: `npm run typecheck`, `npm run check:model-variants`, `node --check scripts/capture-prediction-snapshots.mjs`, `npm run snapshots:capture`, `npm run snapshots:stats`, and `npm run check:site-health`.

## Latest 2026-07-07 Snapshot Lambda Columns

- `prediction_snapshots` now has nullable columns for `lambda_market_total`, `lambda_market_difference`, `lambda_team_total`, `lambda_team_difference`, `lambda_final_total`, and `lambda_final_difference`.
- `scripts/capture-prediction-snapshots.mjs` migrates older local SQLite files by adding missing columns and backfilling totals/differences from existing home/away lambda columns.
- `scripts/snapshot-stats.mjs` now reports `lambdaTotalRows` and `marketTotalRows` so missing lambda-total persistence is visible.
- Current snapshot stats after migration/backfill: 93 snapshots, DB size 3,387,392 bytes, `lambdaTotalRows` 78, `marketTotalRows` 14. Sample M095 final lambdas: market-only 2.25/0.60/2.85/1.65, baseline 3.158/0.406/3.564/2.753, hybrid 2.694/0.499/3.193/2.196.
- Latest checks passed: `node --check scripts/capture-prediction-snapshots.mjs`, `node --check scripts/snapshot-stats.mjs`, `npm run snapshots:capture`, `npm run snapshots:stats`, and `npm run check:site-health`.

## Latest 2026-07-07 Snapshot Failure Recording

- `scripts/refresh-local-inputs.mjs` now treats snapshot capture as optional: if `npm run snapshots:capture` fails, the local input refresh can still finish and writes `.local/pre-match-snapshot-error.json` with command, exit code, stdout, stderr, and timestamp.
- `scripts/refresh-tomorrow.mjs` now writes the same error file when optional pre-match snapshot capture fails, and removes the file after a later successful snapshot capture.
- Latest checks passed: `node --check scripts/refresh-local-inputs.mjs`, `node --check scripts/refresh-tomorrow.mjs`, `npm run snapshots:capture`, `npm run snapshots:stats`, `npm run typecheck`, and `npm run check:site-health`. Current state has no `.local/pre-match-snapshot-error.json`, meaning the latest capture path is clean.

## Latest 2026-07-07 Latest Snapshot Read Path

- Added `src/lib/prediction-snapshots.ts` with `readLatestPredictionSnapshot(matchId, modelVersion)`. It uses the required scoped query shape: `WHERE match_id = ? AND model_version = ? AND generated_at < kickoff_time ORDER BY generated_at DESC LIMIT 1`.
- Added local API `GET /api/snapshots/latest?matchId=...&modelVersion=...` so website/API callers can fetch one latest legal pre-match snapshot without loading the whole snapshot table.
- Valid request sample: `/api/snapshots/latest?matchId=M095&modelVersion=market-only-v1` returns the latest T-6h snapshot with top-10 scorelines and 90-minute probabilities. Invalid model version returns HTTP 400.
- Latest checks passed: `npm run typecheck`, valid latest-snapshot API request, invalid latest-snapshot API request, `npm run check:site-health`, and `npm run snapshots:stats`.

## Latest 2026-07-07 Snapshot Read Index

- Snapshot capture now creates `idx_prediction_snapshots_latest` on `(match_id, model_version, generated_at DESC)` so latest-snapshot reads are scoped and indexed.
- Added `npm run check:snapshot-read-path`, which runs `EXPLAIN QUERY PLAN` against the latest-snapshot query and fails if the index is not used.
- Latest query-plan check output: `SEARCH prediction_snapshots USING INDEX idx_prediction_snapshots_latest (match_id=? AND model_version=?)`.
- Latest checks passed: `node --check scripts/capture-prediction-snapshots.mjs`, `node --check scripts/check-snapshot-read-path.mjs`, `npm run typecheck`, `npm run snapshots:capture`, `npm run snapshots:stats`, `npm run check:snapshot-read-path`, `npm run check:site-health`, and latest-snapshot API request.

## Latest 2026-07-07 Snapshot Integrity Check

- Added `npm run check:prediction-snapshots` as a local read-only SQLite guard for archived prediction snapshots.
- The guard verifies legal pre-kickoff timing, no duplicate `(match_id, model_version, snapshot_type, input_hash)` rows, every snapshot has an input bundle, only `FINAL_PREMATCH` stores full score matrices, top-10 scoreline payloads stay bounded, allowed model versions are used, and lambda total/difference columns match home/away lambdas.
- Latest result: 93 snapshots checked, 0 `FINAL_PREMATCH`, 0 duplicate keys, 0 missing bundles.
- Latest checks passed: `node --check scripts/check-prediction-snapshots.mjs`, `npm run check:prediction-snapshots`, `npm run typecheck`, `npm run check:model-variants`, and `npm run check:snapshot-read-path`.

## Latest 2026-07-07 Real OU/AH Odds Link

- Stopped non-core snapshot/context work and focused on real market inputs.
- Extended local `odds_quotes` and `OddsQuote` to persist totals, spread/handicap, and BTTS prices when the source returns them.
- `fetchTheOddsApiQuotes` now requests `h2h,spreads,totals,btts`, then degrades to supported market sets instead of breaking H2H refresh.
- Current The Odds API World Cup endpoint rejects BTTS with HTTP 422 `Markets not supported by this endpoint: btts`; BTTS remains honestly missing.
- API-Football odds endpoint was tested with the local key: free plan returns 0 results for 2026 odds with `Free plans do not have access to this season`; live odds returned 0 rows.
- Polymarket Gamma active markets and Nansen prediction-market screener returned no active BTTS/both-teams-to-score World Cup markets.
- Local DB after refresh: 18,510 odds rows, 118 totals rows, 56 handicap rows, 0 BTTS rows.
- `market-only-v1` now combines latest H2H with latest available OU/AH/BTTS rows per match. Current next matches are `partial` quality with only `btts` missing, so OU and AH are now used by the solver.
- `npm run check:model-variants` now fails if `market-only-v1` does not use available OU/AH markets.
- Latest checks passed: `npm run typecheck`, direct local `POST /api/odds/refresh` returned 125 imported odds, DB count query, and `npm run check:model-variants` with `marketSolverUsesOuAh: true`.

## Latest 2026-07-07 Hybrid Team Attack/Defense Layer

- `hybrid-v2-knockout` now uses an independent team attack/defense lambda layer instead of reusing Baseline xG as its team component.
- The layer uses only existing quantitative inputs: Elo, recent goals for, recent goals against, and manual team absence counts. It does not use regional stereotypes, future results, random score diversification, or post-match retuning.
- Baseline remains unchanged and guarded by `npm run check:model-variants`.
- Latest API sample shows independent Hybrid team lambdas differ from Baseline team lambdas, e.g. M095 Baseline team 3.16/0.41 vs Hybrid team 1.83/0.56.
- Latest checks passed: `npm run typecheck`, `npm run check:model-variants`, and direct `/api/model-comparison` inspection.

## Limitation

Sofascore is still blocked by HTTP 403 locally. The Odds API fallback can discover future fixtures and odds, but not final scores. Completed results are handled by openfootball plus supplements plus automatic theScore date pages. FIFA official article pages currently return only the frontend shell to direct fetch, so direct FIFA parsing remains a best-effort fallback and returned zero latest results.

## Next action

Keep the local scheduled/site startup path. Do not deploy until the user explicitly authorizes public changes.

## Latest 2026-07-08 Bracket Page UI

- Rebuilt `/bracket` from the old plain bracket/table layout into a responsive knockout tree with left/right halves, center trophy, champion probability, top-four prediction, final/champion summary, real match scores, and future-match probabilities from existing local data.
- Removed the old `预测淘汰赛签表` section and the old five-column knockout result table from `src/app/bracket/page.tsx`.
- Kept changes local-only. No model, odds, sync, database, Cloudflare, GitHub, or public deployment logic was changed.
- Checks passed: `npm run typecheck`, `npm run build`, local `/bracket` HTTP 200, Playwright/Chrome screenshots at 1440x900, 1024x768, and 375x812.
- Follow-up fix: widened the tree layout, removed forced horizontal scrolling, strengthened borders/connectors, restored the group-stage per-match prediction/result table on `/bracket`, and replaced the homepage overview chart with the same prediction-filled tree format.

## Latest 2026-07-08 Local Refresh Button

- Fixed `/api/local-refresh` so it starts `npm run refresh:tomorrow` in the background and returns immediately instead of holding the HTTP request open for several minutes.
- Manual refresh logs now write to `.local/manual-refresh.log`, `.local/manual-refresh.err.log`, and `.local/manual-refresh-state.json`.
- Added a small running-state guard so repeated clicks do not start duplicate refresh jobs within the same 20-minute window.
- `FullRefreshButton` now handles network errors and clears the loading state after the background refresh is started.
- Checks passed: `npm run typecheck`; direct `POST /api/local-refresh` returned 200 in under 1 second; Playwright click test on `/review` confirmed the button stops spinning and shows the background-refresh message.

## Latest 2026-07-09 Bracket Team Codes

- Homepage overview and `/bracket` knockout trees now use shared `teamCode()` English abbreviations instead of local flag/diamond fallback maps.
- Added missing codes for teams such as South Africa, Sweden, DR Congo, England, Scotland, and the rest of the 2026 fixture pool.
- Checks passed: `npm run typecheck`; local Chrome verification found no diamond/flag prefixes and confirmed `ZA`, `SE`, `CD`, and `EN` render on both `/` and `/bracket`.

## Latest 2026-07-09 Raw Knockout Scorelines

- Future knockout scoreline displays now use the model's raw top-three score probabilities instead of filtering scorelines to match the selected 1X2 side.
- Updated homepage prediction sections, `/matches`, `/review` pending rows, `/bracket` table/statistics, review-row generation, match reason text, and the recent single-match forecast cards.
- M097 France vs Morocco now renders raw top three as `1-0 / 1-1 / 2-1` on homepage and `/bracket`.
- Checks passed: `npm run typecheck`, `npm run check:model-variants`, `npm run check:site-health`, and `npm run check:prediction-snapshots`.

## Latest 2026-07-09 Three-Model Pre-Match Eval

- Added local read-only report `scripts/check-tomorrow-model-eval.mjs` and command `npm run check:tomorrow-model-eval`.
- The report prefers M097 France vs Morocco and M098 Spain vs Belgium, then fills with nearest future unfinished matches. It writes `.local/tomorrow-model-eval.json` and prints the same JSON to the console.
- It reports `market-only-v1`, `baseline-v1-market-elo`, and `hybrid-v2-knockout` side by side: selected 1X2, raw top-one/top-three scorelines, score-direction conflict, lambdas, Over 2.5, BTTS, advance probabilities, market quality, missing inputs, odds timestamp, and disagreement summary.
- It guards that `baseline-v1-market-elo` still equals official `predictionForMatch(...).blended`, only evaluates finished matches from strict pre-kickoff snapshots, and keeps lineup/injury/weather/venue as missing context inputs.
- Latest M097/M098 output: M097 all three select home; Market-only/Baseline top1 `1-0`, Hybrid top1 `1-1`. M098 all three select home; Market-only/Hybrid top1 `1-1`, Baseline top1 `1-0`.
- Checks passed: `npm run typecheck`, `npm run check:model-variants`, `npm run snapshots:capture` (`inserted: 0`, `skipped: 12`), `npm run check:prediction-snapshots` (`predictionSnapshotsChecked: 136`, `duplicateKeys: 0`), and `npm run check:tomorrow-model-eval`.

## Latest 2026-07-10 Strict Evaluation Loop

- Re-ran `npm run check:tomorrow-model-eval` after M097 finished; M097 is now retained from its frozen pre-match report and evaluated against the strict pre-kickoff snapshots.
- The report now writes `completedEvaluationSummary` with sample size, 1X2 hits, raw Top-3 scoreline hits, mean log loss, mean Brier, Over 2.5 hits, and BTTS hits per model.
- M097 evidence keeps Baseline official: Baseline log loss/Brier `0.5439/0.2723`; Hybrid `0.7021/0.3893`. No formal weights were changed.
- 2026-07-11 fix: cumulative model metrics now read every completed match with a strict pre-kickoff snapshot directly from SQLite. Overwriting the latest JSON no longer resets historical sample counts; `evaluatedMatchIds` records the included matches.

## Latest 2026-07-11 Real Match Inputs

- The Odds API batch endpoint rejects `btts` with HTTP 422, so the existing odds refresh now enriches normal H2H/OU/AH rows through the provider's per-event odds endpoint. Latest refresh stored 12 complete BTTS rows across M099-M101 and 3 external event IDs.
- `refresh:local-inputs` now reads FotMob match details for explicit unavailable players and confirmed lineup status, plus Open-Meteo hourly weather at the resolved venue city. Latest run matched 3 injury feeds, 0 confirmed lineups, and 3 weather forecasts with 0 extreme-weather adjustments.
- Only Hybrid V2 consumes the new squad/weather context. Predicted or last-starting lineups remain `confirmed_lineup` missing; normal weather leaves lambdas unchanged. Baseline behavior and weights remain unchanged.
- Snapshot bundles and tomorrow evaluation JSON now retain context source, external event ID, fetched time, weather coordinates, and missing-context audit fields.
- Homepage context fix: the page now passes `.local/match-context.json` into Hybrid V2 just like the model-comparison API. Hybrid shows injury/weather/venue as included and keeps only unconfirmed lineup missing. Market-only and Baseline now say those inputs are excluded by model definition instead of implying a fetch failure.
- Local performance fix: `readOdds` keeps full SQLite history but returns only each provider's earliest opening plus latest two live quotes; SQLite reads, model-iteration state, and 10,000-run simulation use one-entry caches invalidated by source-file/data revisions. Warm homepage response improved from roughly 2.7-3.2 seconds to 1.27-1.45 seconds.
