# Agent Operating Notes

This project is a long-running World Cup prediction model. Keep work resumable across context compaction and new threads.

## Start Here

Before changing code, read these files in order:

1. `docs/agent/HANDOFF.md` - shortest handoff entry point and current next action.
2. `docs/agent/STATUS.md` - live project state, active task, decisions, blockers.
3. `docs/agent/KNOWLEDGE.md` - stable domain and repo knowledge.
4. `package.json` - current scripts.

Do not load large source files until the handoff/status notes point to them.

## Continuity Rules

- Keep `docs/agent/STATUS.md` current after each meaningful phase: intent, files changed, verification run, open risks, next action.
- Keep `docs/agent/HANDOFF.md` short enough for a new thread to read first.
- Put stable lessons in `docs/agent/KNOWLEDGE.md`; do not let `STATUS.md` become a long archive.
- If context is getting low or the task is paused, update `HANDOFF.md` and `STATUS.md` before doing more exploratory work.
- Do not start parallel threads that edit the same files. Use a new thread only as a clean continuation point after handoff is written.
- Treat Codex memory as helpful background only. The repo handoff files are the source of truth for this project.

## Product Priorities

- Preserve the model-improvement loop: prediction vs actual, why it missed or worked, and the next improvement.
- Finished-result refresh should stay automatic through `npm run refresh:tomorrow` / nightly snapshot flow.
- Betting guidance should remain concrete and honest: show both `[0]` and handicap guidance when available, and mark missing handicap prices as requiring pre-match verification.
- Do not fabricate odds, lineups, injuries, or handicap prices.

## Useful Commands

```powershell
npm run refresh:tomorrow
npm run typecheck
npm run build
npm run predeploy:check
npm run dev
```

Use the narrowest verification command that matches the change. For UI changes, run the app and verify the visible page when practical.

## Done Means

- The requested behavior is implemented or clearly blocked.
- `docs/agent/STATUS.md` and `docs/agent/HANDOFF.md` reflect the final state.
- Relevant checks were run, or the reason they were not run is recorded.
