# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/news020702/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/news020702/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A radar for token launches that have not happened yet. It reads a sealed DefiLlama
snapshot (758 protocols, as of 2026-11-14), finds the protocols that record no token
and are not a wrapped or staked product of one that trades, ranks them by what their
launch would be worth, and hands you a dashboard with the board, a detail view for
every protocol, and the steps to farm it.

## The model — `radar-cat-median-1`

No name is ever special-cased. The implied value follows from the snapshot's own figures:

```
implied_value = TVL × category multiple × growth factor × age factor
```

- **Category multiple** — for each category, the median market-cap / TVL ratio of the
  snapshot's own tokenized protocols in that category (at least 3 of them; otherwise the
  global median), clamped to 0.02–1.5. A tokenized DEX trades at ~0.34× its TVL, a
  tokenized lender at ~0.13×: the multiple is what the market already pays for that kind
  of protocol, read off the same file.
- **Growth factor** — `1 + clamp(7-day TVL change, −50…+100) / 100 × 0.5`.
- **Age factor** — `0.7 + 0.3 × min(days listed with no token, 1095) / 1095`. An unknown
  listing date counts as 365 days.

Values are rounded to whole dollars and nudged down by $1 where two raw values tie, so
the board strictly decreases with rank. The 40-protocol watchlist ($50M floor) is a floor,
never a ceiling: the board also ranks clean pre-token protocols below it — 198 rows in all.

Tokenized protocols are never ranked. They are shown apart in the dashboard as live
comparables with the market's own values.

## Run it

Node 22 or later, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

That writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's dataset),
`out/dashboard/` and `out/screenshots/` (copied in), and `out/dossier.json` (the summary
the judge reads, built with the vendored `vendor/makefun-board.ts`). Run it twice and the
outputs are byte-identical.

Open `out/dashboard/index.html` in a browser: sort the board by any column, filter by
category, chain or search, show the watchlist only, and click any row for its model
breakdown and farm plan.

## Files

- `main.ts` — the program: reads the snapshot, scores, writes the outputs.
- `lib/model.ts` — the value model (`scorePreToken`, `categoryMultiplesFromSnapshot`),
  the farm-plan generator (`farmStepsFor`), and the board builder (`buildRadar`).
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`. No network, no
  framework, no external fonts.
- `screenshots/` — three captures of the dashboard: the board, a protocol's detail view,
  a filtered view.
- `vendor/makefun-board.ts` — the make.fun dossier library, vendored unchanged.

## A note on the numbers

Implied values are this entry's own claim, derived from the sealed snapshot only. They do
not predict whether or when any protocol issues a token.
