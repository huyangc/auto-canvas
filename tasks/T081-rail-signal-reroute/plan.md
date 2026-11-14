# T081 — Reroute the signal side of a rail crossing

- Branch: `task/T081-rail-signal-reroute`
- Base: `main` at `8cdec30`
- Status: approved

## Goal

Toward the user's readability goal (2026-11-13: readability metrics within
20% of human drawings). On main `8cdec30` the frozen composite is dev 1.271×,
val 1.244× human; rail crossings are the third-largest excess (dev 20 vs
human 8, 2.20 composite units; val 15 vs 10, 0.92). R148's finished rail
search only moves rail markers and reroutes the **rail** Net. The Opus
analysis (2026-11-14, `tmp/gap3/`) classified the 20 dev rail crossings:
9 are a shared gate line (gates of a transistor row, often driven by an
op-amp) squeezed between the supply wire and the source pins and crossing a
source drop (`2adejzy693`, `3cr8ap2k4c`, `54a79nkqef`, `7d93gjqbw8`,
`ecyqst76jd`, `ftrjkg4566`, `rryf923yjz`, `x7evbngj49`, `ray97q5c2j`); 3 are
a rail marker's stub crossing a signal (`2adejzy693`, `3cr8ap2k4c`,
`6s67mqbxx9`); 6 are a long rail line crossed by a signal (`6r2q6deeq9`,
`fbnrez8q5g`, `kjs4xgzkba`, `westxcef83`, `69ksgcs72g`, `jz7rweg6gg`); 2 are
rail × rail. Val: `pd8crnm97d` (2), `g37crxfgf7` (1, gate line),
`3brrjxvweb` (3), `vbhxg297an` (1); `yje2n6eva2` (6) awaits a user decision.
In most of these the fix is to move the **signal** wire, not the rail.
Expected gain (estimate): dev 1.0–1.5, val 0.3–0.5 composite units.

## Context

- R148 (`docs/specs/auto-layout.md:1323`): marker seats, then "retry at
  most three crossed rail Nets against the retained signal geometry", tree +
  horizontal trunk tracks only, calibrated score with readability, all
  routed guards, ties keep the incumbent.
- Implementation: `packages/auto-layout/src/local-reroute.ts`
  `rerouteRailCrossings` (`:99`) → `rerouteNets` with `finish` (`rails`
  mode). In rails mode it skips every non-rail Net (`:153`). Signal mode
  (`rerouteCrossings`, `:89`) skips ground/supply Nets, ranks by total
  crossings, uses `routedScore`, at most three trials; it runs earlier
  (`auto-layout.ts:1233`, `:1115`, `:469`, `reroute-portfolio.ts`), so a
  signal Net that crosses a rail but has few total crossings is never
  retried, and it is never retried against the finished rail geometry.
- `trunkTracks` (`:39`): tree plus x/y tracks at the pin envelope's low,
  high, centre, and one grid step outside; `rails` suppresses vertical
  tracks.
- Call site: `auto-layout.ts:1306` (`rerouteRailCrossings(document,
  resolver, railed.result, stopped, finishLabels)`), then R149 gap closing.
- Metric: `readability-rail-crossings.ts` (crossing points between a rail
  Net and any other Net, deduplicated per Net pair). Weights in
  `readability-weights.ts` price one rail crossing about 2.7× an ordinary
  crossing; `calibratedScore` (`routed-search-score.ts:74`) already includes
  the frozen composite, so no new price is needed.
- Tests: `packages/auto-layout/test/rail-crossings.test.ts` covers R148.
- Evaluation: `node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12`;
  baseline `tmp/main-8cdec30-report.json`; `python3 tmp/excess.py <report>`;
  `python3 tmp/per-case-excess.py <report> railCrossings dev 20`.
  Large documents and held-out timing: `tmp/t080-harness/` (`large-input/`,
  `verify-large.mjs`, `timing.mjs` — fix their worktree path `W`, output
  paths and baseline import). Build the baseline yourself before changing
  code: copy this worktree's `packages/auto-layout/dist` after a clean
  `pnpm build` to `/tmp/t081-baseline/dist` (T080 needed a local
  module-resolution link for `@icm/*`; see its report).

## Scope

Owned: `packages/auto-layout/src/**` except `readability-metrics.ts`,
`readability-rail-crossings.ts` and `readability-weights.ts`;
`packages/auto-layout/test/**`; `tasks/T081-rail-signal-reroute/report.md`.
Proposed spec text (an R148 addition) goes in the report.

Out of scope: the frozen readability function; marker seating rules; port
seating; placement.

## Steps

1. **Investigate** the dev drawings above with the main planner: for each
   rail crossing, which signal Net crosses which rail, whether that signal
   Net has another legal route (tree or a trunk track outside the rail, a
   track on the other side of the source pins, a vertical track) and whether
   R148 or the earlier signal reroute ever tried it. Report the counts.
2. **Signal side of R148.** After R148's rail-Net retries, retry at most
   three **signal** Nets that cross a rail in the retained geometry, ordered
   by their rail-crossing count (then total crossings, then stable Net id),
   against the retained rail and signal geometry. Use the full `trunkTracks`
   (both axes) and the same acceptance as R148: label finishing before
   comparison, strictly better calibrated score, crossings/bends/wire may
   increase only with a strictly lower frozen composite, no lost name claim,
   terminal partition change, routing/connectivity or `VISUAL_*` guard
   regression, ties keep the incumbent, cancellation between trials.
   Protected / locked routing and direct contacts are skipped as in R148.
   Same eligibility as R148 (default mode, nonzero budget, ≤ 40 instances).
3. If step 1 shows a common case the trunk set cannot express (for example
   the gate line needs a track on the far side of the supply wire or below
   the source pins), add at most two extra candidate tracks for signal Nets
   derived from the crossed rail's geometry (one grid step beyond the rail
   wire on the side away from the signal pins). Report which cases it
   unlocks.
4. Tests in `rail-crossings.test.ts` (or a new file): a gate line crossing a
   source drop is rerouted to remove the rail crossing; a candidate that only
   trades a rail crossing for worse readability is rejected; protected routes
   are untouched; documents above 40 instances unchanged; determinism.
   Synthetic circuits only — never commit a Gallery drawing.
5. Evaluate all 628; review page human | main | T081 for the drawings named
   above, the ten whose composite falls most, and the 25 samples.

## Acceptance

```bash
pnpm build                                        # 0
pnpm typecheck                                    # 0
pnpm lint                                         # 0 errors
pnpm format:check                                 # 0
pnpm test:local                                   # 0
pnpm test:slow                                    # 0
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12
```

Against `tmp/main-8cdec30-report.json`:

- Readability composite lower on dev and val (val may be equal if no val
  drawing qualifies; report it); rail crossings lower on dev; no drawing's
  composite higher than main.
- Guards: 628/628 equivalent; floating and missing not above main; every
  `VISUAL_*` total not above main except label clearance (zero weight).
- Determinism; six large documents byte-identical; held-out medians within
  +20% (timing run alone, nothing else running).

## Notes for the implementer

- Recognise rails, signals and crossings from connectivity and geometry; no
  ids, names, text or coordinates.
- Tune on dev; report val.
- Do not change the frozen readability metrics or weights.
