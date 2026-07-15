> 状态更新，2026-07-04：本文记录的是修复前架构。当前主链路已改为 Sofascore JSON，相关最新状态以 `docs/agent/HANDOFF.md` 和 `docs/agent/STATUS.md` 为准。

# 世界杯预测网站代码检查简报

这份文档用于交给 ChatGPT 或其他代码审查工具，快速理解当前项目为什么“简单抓赛程/赛果”变复杂，以及应该重点检查哪里。

## 1. 项目现状

项目路径：

```text
D:\codex project\worldcup
```

当前本地网站：

```text
http://127.0.0.1:3000/
```

当前公网地址：

```text
https://worldcup-predictor.worldcupball.workers.dev/
```

重要限制：

- 当前阶段只允许本地开发。
- 禁止部署或修改公网 Worker。
- 禁止写生产数据库。
- 禁止执行 `wrangler deploy`、`wrangler d1 execute --remote`、`wrangler dev --remote` 等远程命令。

## 2. 技术栈

当前主站是 Next.js 应用：

```text
Next.js + React + TypeScript
```

本地数据库不是 D1，而是 sql.js 写出来的本地 SQLite 文件：

```text
.local/worldcup.sqlite
```

新增的 ESPN/Worker 方向目前是本地骨架，独立数据库：

```text
.local/worldcup-sync.sqlite
```

## 3. 当前代码结构

主页面：

```text
src/app/page.tsx
```

小组赛页面：

```text
src/app/groups/page.tsx
```

淘汰赛页面：

```text
src/app/bracket/page.tsx
```

复盘页面：

```text
src/app/review/page.tsx
```

数据读取和本地 SQLite：

```text
src/lib/db.ts
```

预测模型：

```text
src/lib/model.ts
src/lib/model-iteration.ts
src/lib/selection.ts
src/lib/trade-report.ts
```

当前静态赛程：

```text
src/data/generated-data.json
```

人工补充赛果：

```text
src/data/result-supplements.json
```

theScore fallback event id：

```text
src/data/result-web-sources.json
```

旧赛果同步：

```text
scripts/refresh-results.mjs
```

API-Football 同步尝试：

```text
scripts/sync-api-football-results.mjs
```

新增 ESPN/Cloudflare Worker 本地骨架：

```text
workers/worldcup-sync/
```

核心文件：

```text
workers/worldcup-sync/src/worldcup_sync_service.py
workers/worldcup-sync/src/entry.py
workers/worldcup-sync/migrations/0001_worldcup_sync.sql
workers/worldcup-sync/wrangler.jsonc
```

## 4. 当前赛程/赛果链路

### 旧链路

目前主站主要还是靠旧链路：

```text
openfootball/worldcup
+ result-supplements.json
+ result-web-sources.json(theScore event page)
-> scripts/refresh-results.mjs
-> .local/worldcup.sqlite / overrides 表
-> src/lib/db.ts readOverrides()
-> 页面展示
```

问题：

- openfootball 更新慢。
- result-supplements.json 是人工补比分。
- result-web-sources.json 需要手动维护 theScore event id。
- 新比赛如果没有 event id，定时任务跑了也抓不到。

### API-Football 链路

尝试过 API-Football：

```text
GET https://v3.football.api-sports.io/fixtures?league=1&season=2026
```

代码：

```text
scripts/sync-api-football-results.mjs
```

当前问题：

API key 能请求到 API，但当前套餐不允许访问 2026 赛季，返回：

```text
Free plans do not have access to this season, try from 2022 to 2024.
```

所以 API-Football 不能真正替代旧链路。

### ESPN 新链路

用户最新要求改为 ESPN：

```text
https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD&limit=200
```

新增代码：

```text
workers/worldcup-sync/src/worldcup_sync_service.py
workers/worldcup-sync/src/entry.py
```

目标架构：

```text
Cloudflare Worker
+ Cloudflare Cron Trigger
+ D1
+ ESPN scoreboard
```

当前本地实现：

```text
Python stdlib
+ local sqlite .local/worldcup-sync.sqlite
+ local CLI trigger
```

本地命令：

```powershell
npm run check:espn-sync
npm run sync:espn:recent
npm run sync:espn:full
npm run sync:espn:retry-analysis
py workers/worldcup-sync/src/entry.py health
```

当前 ESPN 问题：

本机访问 ESPN TLS 失败。已确认：

- Python 失败
- Node fetch 失败
- PowerShell 失败
- curl.exe 失败

典型错误：

```text
SSL: UNEXPECTED_EOF_WHILE_READING
schannel: failed to receive handshake
ECONNRESET
```

所以当前不是解析代码问题，而是本机到 `site.api.espn.com` 的 TLS 连接层失败。

## 5. 本地数据库

### 主站数据库

```text
.local/worldcup.sqlite
```

主要表：

```text
overrides
odds_quotes
team_inputs
result_sync_status
result_sync_events
api_football_fixtures
```

### ESPN sync 数据库

```text
.local/worldcup-sync.sqlite
```

表：

```text
matches
sync_runs
```

`matches` 用：

```text
external_provider = espn
external_event_id = ESPN events[].id
```

唯一约束：

```text
external_provider + external_event_id
```

已保存字段包括：

```text
kickoff_time_utc
stage
status
home_team_id
away_team_id
home_team_name
away_team_name
home_score
away_score
home_shootout_score
away_shootout_score
winner_team_id
winner_team_name
raw_event_json
```

`sync_runs` 记录同步日志：

```text
sync_type
status
events_found
matches_upserted
completed_results
failed_dates
error
```

## 6. 网站如何读取 ESPN sync 结果

`src/lib/db.ts` 现在会读取：

```text
.local/worldcup-sync.sqlite
```

当 ESPN sync 中有：

```text
status = completed
home_score IS NOT NULL
away_score IS NOT NULL
local_match_id LIKE 'M%'
```

则合并成 `OverrideResult` 给页面使用。

注意：

主站原本的 `overrides` 优先，不会被 ESPN sync 覆盖。

## 7. 当前最明显的问题

### 问题 1：数据源切换过多

项目经历过：

```text
openfootball
theScore event page
API-Football
ESPN
```

导致同步链路变复杂。

建议检查是否可以收敛为：

```text
ESPN only
```

旧源只保留只读兼容，不再继续扩展。

### 问题 2：本地和未来 Cloudflare 架构还没完全统一

当前网站仍主要跑：

```text
Next.js + Node + sql.js
```

新增 Worker 只是骨架：

```text
workers/worldcup-sync/
```

还没有真正通过 Wrangler 本地运行 Python Worker。

### 问题 3：ESPN 网络无法访问

这是当前最大阻塞。

本机直接请求 ESPN scoreboard TLS 失败，导致：

```text
npm run sync:espn:recent
```

返回：

```text
status=partial
failed_dates=5
events=0
upserted=0
```

### 问题 4：网站还没有完全切到 ESPN 数据库作为主数据源

目前只是：

```text
主站 overrides
+ ESPN sync completed Mxxx rows
```

还不是：

```text
网站赛程/赛果完全来自 ESPN/D1
```

## 8. 已经做过的测试

```powershell
npm run check:espn-sync
npm run sync:espn:recent
py workers/worldcup-sync/src/entry.py health
npm run typecheck
npm run check:site-health
```

结果：

- `check:espn-sync` 通过。
- `typecheck` 通过。
- `check:site-health` 通过。
- `sync:espn:recent` 可执行但 ESPN TLS 失败，状态为 `partial`。
- `health` 能返回最新同步状态。

## 9. 给 ChatGPT 的重点检查问题

请重点检查：

1. 是否应该停止继续维护 `result-web-sources.json`。
2. 是否应该把 `scripts/refresh-results.mjs` 降级为兼容 fallback。
3. ESPN sync 的 schema 是否足够支撑未来 D1。
4. `src/lib/db.ts` 里主站读取 ESPN sync 的方式是否合理。
5. 当前 Worker Python 写法是否适合 Cloudflare Python Worker。
6. 是否需要保留 API-Football 代码，还是删掉减少复杂度。
7. 当前 `.github/workflows/*` 是否可能误触发公网更新。
8. 是否应该暂停/删除 Windows Task Scheduler 相关脚本，避免和 Worker/Cron 方向冲突。
9. ESPN TLS 失败是否是本机网络、证书、代理、DNS、SNI 或 ESPN 阻断问题。
10. 最短路径是否应该是：先保证本地能抓 ESPN，再接 D1，再让网站读 D1。

## 10. 当前建议的最短修复路线

建议不要继续增加新数据源。

最短路线：

```text
1. 解决本机 ESPN TLS 访问问题
2. 确认 ESPN recent/full 能抓到 events
3. 确认 events 能 upsert 到 .local/worldcup-sync.sqlite
4. 确认 M084/M085 等能绑定到 Mxxx
5. 确认网站能读取 ESPN sync 完成比分
6. 再考虑 Wrangler 本地 Worker/D1
7. 最后才部署 Cloudflare
```

当前不要部署。
