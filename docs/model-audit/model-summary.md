# Model Diagnostics Summary

Generated: 2026-07-07T05:48:17.283Z

## Answers

1. Score distribution concentration: possible concentration risk.
2. Odds dependency: market correlation home/draw/away = 0.988/0.955/0.990; near-identical market matches = 13.
3. 0-1/0-2/1-2 high frequency is consistent with current low-to-mid lambda totals and knockout tempo damping where present.
4. Exact-score decline cannot be judged as structural from this export alone; use archived pre-match snapshots before changing weights.
5. Missing variables: weather, confirmed lineup, referee/set-piece profile.
6. Most likely structural issue: score matrix is mostly Elo/manual-input lambda + market-weighted 1X2, with limited independent defensive/team style data.
7. Priority tests: archive predictions before kickoff, ablate market weight, ablate scoreline adjustment, compare 0-6 matrix calibration.
8. Plausible but unproven factors: weather, travel, venue surface, referee, rest-day effects.
9. Suggested ablations: marketWeight=0, no knockout xG damping, no scorelineAdjustment, no iteration adjustments.
10. Baseline to preserve: current exported diagnostics plus current model.ts behavior.

## Key Numbers

- Matches: 104
- Completed matches found: 94
- Strict pre-match evaluated: 0
- Strict by model: {}
- Diagnostic replay evaluated: 94
- Lambda home: {"min":0.4589305219471512,"max":4.4,"avg":1.6644008230101381,"p25":0.8838377785960507,"p50":1.444049721469256,"p75":2.2991041357505604}
- Lambda away: {"min":0.3102566568877481,"max":3.159519645474738,"avg":1.1356283169534962,"p25":0.6006856781494564,"p50":0.9751311645742791,"p75":1.4754239873071104}
- Top1 frequency: {"1-1":48,"1-0":20,"0-1":17,"2-0":8,"3-0":6,"4-0":3,"0-2":1,"0-3":1}
- Target score top3 share: {"0-1":0.36538461538461536,"0-2":0.10576923076923077,"1-2":0.2980769230769231,"1-1":0.625}
- Average top3 probability sum: 36.9%
- Strict actual top3 coverage: n/a
- Diagnostic replay top3 coverage: 35.1%
- Strict 1X2 log loss: n/a
- Strict 1X2 Brier: n/a
- Diagnostic replay 1X2 log loss: 0.782
- Diagnostic replay 1X2 Brier: 0.151
- Exact score log loss: n/a
- Total goals RMSE: 0.000
- Market dependency: {"matchesWithOdds":95,"homeCorrelation":0.9879157324674028,"drawCorrelation":0.9546661925416847,"awayCorrelation":0.9898499822046497,"nearIdenticalCount":13,"maxDeltaBelow1Point":13,"maxDeltaAbove5Points":24}
- Stage evaluation: {}

## Provenance

- Code-proven: model uses Elo, host flag, recent form, confederation, manual team inputs, long-term team market strength, odds, group motivation, stage adjustment, iteration calibration.
- Data-proven: odds and result rows were read locally.
- Reasonable inference: scoreline clustering follows lambda and scoreline adjustment.
- Unknown: true out-of-sample pre-match score accuracy without archived prediction snapshots.
