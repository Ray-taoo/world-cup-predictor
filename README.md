# 世界杯预测

本项目是一个本地优先的世界杯预测网站，包含赛程、赔率融合、单场胜平负预测、赛后复盘、Monte Carlo 晋级概率和每日 21:00 赛前刷新。

## 本地运行

```powershell
npm install
npm run build
npm run start -- --hostname 0.0.0.0 --port 80
```

访问：

```text
http://127.0.0.1/
```

## 每天 21:00 自动刷新

公网部署后，不依赖你的电脑开机。推荐用 GitHub Actions 云端定时任务：

- `.github/workflows/nightly-refresh.yml` 每天 UTC 13:00 运行，也就是北京时间 21:00。
- 运行 `npm run export:nightly-snapshot` 抓取明日赔率和核对状态。
- 写入 `src/data/nightly-snapshot.json` 并自动提交到 GitHub。
- Vercel 连接 GitHub 仓库后，会在这次提交后自动重新部署网站。

刷新内容：

- 明日比赛赔率：The Odds API 免费额度。
- 已结束赛果：openfootball + 本地补充赛果。
- 首页“21:00 赛前核对”指标：赔率导入数量、缺盘口场次、仍需人工复核首发/伤停的场次。

GitHub 仓库需要配置 Secret：

```text
ODDS_API_KEY=你的 The Odds API key
```

## 免费部署建议

第一版推荐 Vercel：

- Next.js 原生支持，部署最快。
- 免费计划可部署动态 Next.js。
- 自动更新交给 GitHub Actions；Vercel 负责托管和每次 GitHub 提交后的自动部署。

需要在 Vercel 环境变量中填写：

```text
ODDS_API_KEY=你的 The Odds API key
```

注意：当前项目仍保留 SQLite 给本地手工导入/锁定赛果使用；公网自动刷新优先读取 GitHub Actions 生成的 `nightly-snapshot.json`。正式多人使用版本建议下一步接入免费数据库，例如 Neon、Turso 或 Supabase。

## GitHub 发布

发布前检查：

```powershell
npm run predeploy:check
```

安装 Git 后，在项目目录执行：

```powershell
git init
git add .
git commit -m "init world cup predictor"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

然后在 Vercel 里选择 Import Git Repository，导入这个 GitHub 仓库即可。

Vercel 导入设置：

```text
Framework Preset: Next.js
Build Command: npm run build
Install Command: npm ci
Output Directory: 留空
Environment Variables:
  ODDS_API_KEY=你的 The Odds API key
```

GitHub 仓库设置：

```text
Settings -> Secrets and variables -> Actions -> New repository secret
Name: ODDS_API_KEY
Value: 你的 The Odds API key
```

这样每天北京时间 21:00 由 GitHub Actions 云端自动刷新数据；刷新提交进入 GitHub 后，Vercel 会自动重新部署。

## 域名说明

`worldcup.Predict` 里的 `.predict` 当前不是 IANA 有效顶级域，因此不能作为真实公网域名直接注册。可以先使用 Vercel 免费域名，例如：

```text
https://worldcup-predict.vercel.app
```

后续购买有效域名后再绑定，例如 `.com`、`.app`、`.site`、`.world` 等。
