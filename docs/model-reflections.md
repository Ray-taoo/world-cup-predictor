# Model Reflections

Last updated: 2026-06-28

## Current Error Patterns

- Do not treat the highest single scoreline as the same thing as the 1X2 direction. A draw score such as 1-1 can be the most likely exact score while the sum of all home-win scores still makes home win the top 1X2 side. For user-facing output, top-three scorelines now prioritize the selected 1X2 direction first.
- Final group matches need qualification context. If both teams can advance with a draw in their last group match, the model should reduce tempo and raise draw pressure.
- If a team still needs points or goal difference, attack expectation can be lifted; if a team is already safe, tempo and attack expectation should be reduced.
- External data refreshes can fail. Team-input refresh must not block finished results, odds refresh, homepage rendering, or review pages.

## Rules To Recheck Before New Predictions

- Check whether the fixture is a final group match.
- Check whether both teams advance with a draw.
- Check whether one team must chase points or goal difference.
- Keep the displayed top-three scorelines aligned with the displayed 1X2 direction.
- Treat Polymarket or smart-wallet signals as external market evidence only after real prices/URLs are imported; do not infer chain flow from screenshots.

## Daily Summary 2026-06-29

- 1X2 active signals: 16/26 (61.5%).
- BTTS active signals: 13/26 (50.0%).
- Goals-range active signals: 36/62 (58.1%).
- Top-three scorelines: 22/73 (30.1%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-06-30

- 1X2 active signals: 17/27 (63.0%).
- BTTS active signals: 14/29 (48.3%).
- Goals-range active signals: 32/57 (56.1%).
- Top-three scorelines: 24/73 (32.9%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-01

- 1X2 active signals: 17/27 (63.0%).
- BTTS active signals: 14/29 (48.3%).
- Goals-range active signals: 32/57 (56.1%).
- Top-three scorelines: 24/73 (32.9%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-02

- 1X2 active signals: 19/30 (63.3%).
- BTTS active signals: 15/31 (48.4%).
- Goals-range active signals: 38/63 (60.3%).
- Top-three scorelines: 29/79 (36.7%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-03

- 1X2 active signals: 19/30 (63.3%).
- BTTS active signals: 16/33 (48.5%).
- Goals-range active signals: 40/66 (60.6%).
- Top-three scorelines: 30/82 (36.6%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-04

- 1X2 active signals: 20/31 (64.5%).
- BTTS active signals: 17/33 (51.5%).
- Goals-range active signals: 43/69 (62.3%).
- Top-three scorelines: 33/85 (38.8%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-05

- 1X2 active signals: 21/32 (65.6%).
- BTTS active signals: 18/35 (51.4%).
- Goals-range active signals: 44/71 (62.0%).
- Top-three scorelines: 33/88 (37.5%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-06

- 1X2 active signals: 21/32 (65.6%).
- BTTS active signals: 19/36 (52.8%).
- Goals-range active signals: 46/74 (62.2%).
- Top-three scorelines: 35/91 (38.5%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-07

- 1X2 active signals: 21/32 (65.6%).
- BTTS active signals: 19/36 (52.8%).
- Goals-range active signals: 46/75 (61.3%).
- Top-three scorelines: 35/92 (38.0%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-08

- 1X2 active signals: 21/32 (65.6%).
- BTTS active signals: 19/36 (52.8%).
- Goals-range active signals: 46/77 (59.7%).
- Top-three scorelines: 36/94 (38.3%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-09

- 1X2 active signals: 21/32 (65.6%).
- BTTS active signals: 19/37 (51.4%).
- Goals-range active signals: 46/79 (58.2%).
- Top-three scorelines: 36/96 (37.5%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Strict Three-Model Check 2026-07-10

- M097 France 2-0 Morocco was evaluated only from the pre-kickoff snapshot.
- Baseline remained the official model and selected the correct 1X2 side. Its log loss was 0.5439 and Brier score 0.2723.
- Hybrid also selected the correct 1X2 side, but over-corrected toward draw/BTTS: its top score was 1-1, while the actual score was 2-0. Its log loss was 0.7021 and Brier score 0.3893.
- Decision: keep Baseline unchanged; keep Hybrid experimental. Do not tune weights from one match. Accumulate at least 8-12 strict knockout samples before considering a formal weight change.
- Next check: compare aggregate log loss, Brier score, BTTS/Over 2.5 calibration, and raw Top-3 scoreline hit rate. A model must improve 1X2 calibration without materially worsening scoreline coverage before it can replace Hybrid's current rule set.

## Daily Summary 2026-07-10

- 1X2 active signals: 22/33 (66.7%).
- BTTS active signals: 19/37 (51.4%).
- Goals-range active signals: 47/80 (58.8%).
- Top-three scorelines: 37/97 (38.1%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-11

- 1X2 active signals: 23/34 (67.6%).
- BTTS active signals: 19/38 (50.0%).
- Goals-range active signals: 48/81 (59.3%).
- Top-three scorelines: 38/98 (38.8%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-12

- 1X2 active signals: 23/34 (67.6%).
- BTTS active signals: 19/39 (48.7%).
- Goals-range active signals: 50/83 (60.2%).
- Top-three scorelines: 38/100 (38.0%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-13

- 1X2 active signals: 23/34 (67.6%).
- BTTS active signals: 19/39 (48.7%).
- Goals-range active signals: 50/83 (60.2%).
- Top-three scorelines: 38/100 (38.0%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.

## Daily Summary 2026-07-15

- 1X2 active signals: 22/29 (75.9%).
- BTTS active signals: 17/34 (50.0%).
- Goals-range active signals: 54/88 (61.4%).
- Top-three scorelines: 38/101 (37.6%).
- Next check: review wrong rows on /review and keep scorelines aligned with the selected 1X2 side.
