# T067 report — round 3

## Summary

Implemented the round 3 amendments on `task/T067-short-marker-port-stubs`:
20/40 marker/port defaults apply only through 40 instances; larger documents
retain 40/80. Diagnosed stubs may extend without a calibrated-score veto when
the targeted label problem disappears and no routed guard rises. Trials are
capped by the diagnosed movable-stub count and twelve. Refused plans remain
ineligible. Identical finished seats and net/stub routing requests reuse their
results within one public planning call.

The implementation and authorized geometry tests pass the build, types, lint,
formatting, local and slow checks. **Overall acceptance remains partial.**
All 628 drawings complete and are electrically equivalent, but crossings,
validation bends, several visual totals and aggregate validation wire reduction
miss their gates. `ltc3452` is still **13.12% slower than main**, down from
round 2's reported 20.4%, but above the allowed 10%.

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 — Short defaults and longer-seat repair | done | Document-size offsets cover marker/port placement, singleton stubs, rail tracks, blocker repair and compaction. R146/R148 keep their candidate searches. The amended post-hoc repair replaces the original per-seat precheck design. |
| 2 — R62/R10/equivalence | done | Direct contacts remain R38-owned. Fixed/locked poses stay fixed. An explicit error-diagnostic check preserves rejection of refused plans after removing the score gate. All 628 evaluations are equivalent; all safety/validity tests pass. |
| 3 — Tests | done | Added the 40/41-instance boundary, score-increasing label repair, refused-plan rejection, 5/13 diagnosed-stub budgets, routing reuse and cache lifetime checks. Updated only the authorized old-geometry expectations; retained blocker-repair intent and crossings/bends assertions. |
| 4 — Spec and evaluation | partial | Updated R6a/R12/R71/R146/R148. Completed all 628 evaluations, runtime measurement, large-plan comparison and repeated-output checks. Quality/runtime gates remain unmet; evidence and per-drawing regressions follow. |

## Review findings addressed

| Latest-round finding | Status | Resolution |
| --- | --- | --- |
| 1 — Large documents changed | done | Offsets depend on the complete document's instance count; 40 and 80 are restored above 40 instances. All six large plans are byte-identical to main. |
| 2 — Label repair score gate/cap | done | Removed the calibrated-score comparison. Require disappearance of the implicated diagnostic, no increase in any `routedGuards` count, and no error diagnostic. The trial limit is `min(diagnosed movable stubs, 12)`. Reuse candidate label diagnostics. Tests prove a score-increasing port repair is accepted and the larger cap is honored. |
| 3 — Runtime | partial | Reuse completed placement trials and immutable net/stub routing requests, including refused net requests. This lowers the measured regression, but final `ltc3452` remains +13.12%; no search budget or timeout was reduced/raised. |
| 4 — Old-geometry assertions | done | `routing.test.ts`: singleton stubs ±20. `port-seat-search.test.ts`: include both short edges and assert selection of the shorter routed edge. `rail-crossings.test.ts`: initial wire 1270, keeping crossings=1 and bends=1. Cascode origins use the authorized new distances. |

The earlier RC idempotence and final-port candidate-membership tests remain
passing in the full local suite.

## Acceptance results

```text
pnpm build → 0; all packages/apps built (existing large-chunk warning only)
pnpm typecheck → 0
pnpm lint → 0; 2036 files, 0 errors, 3303 warnings
pnpm format:check → 0; All matched files use Prettier code style!
pnpm test:local → 0; 787 files passed, 3 skipped; 8043 tests passed, 117 skipped
pnpm test:slow → 0; 2 files and 14 tests passed
node scripts/auto-layout-eval.mjs tmp/le10-input --jobs 12 → 0; 628/628 completed
```

Final logs are `/tmp/t067-r3-build-final.log`,
`/tmp/t067-r3-typecheck-final.log`, `/tmp/t067-r3-lint-final.log`,
`/tmp/t067-r3-format-final.log`, `/tmp/t067-r3-test-local-final.log`,
`/tmp/t067-r3-test-slow-final.log`, `/tmp/t067-r3-eval-repeat.log` and
`/tmp/t067-r3-eval-final-repeat.log` (both final-build evaluations exited 0).
Local tests took 89.50 s; slow tests took 51.94 s. No test timeout changed.

The first sandboxed local run exited 1 with `EPERM` on loopback listening,
PostgreSQL and process inspection (17 files/60 tests failed). The suite was
rerun with approved local access. A pre-final unrestricted run saw two new
refusal assertions fail against an already-loaded older module; a fresh run
with the guard passed, followed by the final complete cache-validation run
above. The initial typecheck's removed-constant import was fixed in the
explicitly authorized cascode test. The routing-reuse regression was run
without the cache first: `planRouteNet` was called twice instead of once;
with caching it passes, including the requirement to recompute on the next
public call. Logs: `/tmp/t067-r3-cache-red.log`,
`/tmp/t067-r3-cache-green.log`, `/tmp/t067-r3-cache2-tests.log`.

### Quality against `tmp/le10-t063final/report.json`

| Metric | Dev: baseline → round 3 | Relative change | Val: baseline → round 3 | Relative change |
| --- | ---: | ---: | ---: | ---: |
| Crossings | 275 → 279 | +1.45% | 125 → 155 | +24.00% |
| Bends | 1863 → 1807 | −3.01% | 709 → 763 | +7.62% |
| Wire length | 468491.35 → 429674.63 | −8.29% | 194054.23 → 192606.12 | −0.75% |
| Median area / human | 1.447722 → 1.284404 | −11.28% | 1.407807 → 1.239508 | −11.95% |

Dev completes 439/439; val completes 189/189. The previously refused val
case `yje2n6eva2` now completes and contributes 37 crossings, 40 bends,
10880 wire units, 7 label-clearance findings and the foreign-route finding.
On the 188 validation drawings completed in both runs, crossings are
118 (−5.60%), bends 723 (+1.97%), and wire 181726.12 (−6.35%). This explains
much of the aggregate difference but does **not** replace the requested gates.

| Guard | Limit | Round 3 | Result |
| --- | ---: | ---: | --- |
| Completed | ≥627 | 628 | pass |
| Non-equivalent | 0 | 0 | pass |
| Floating pins | ≤10 | 6 | pass |
| Missing connections | ≤18 | 16 | pass |

| Visual diagnostic | Dev baseline → round 3 | Val baseline → round 3 | Combined baseline → round 3 |
| --- | ---: | ---: | ---: |
| `VISUAL_LABEL_CLEARANCE` | 129 → 135 | 50 → 53 | 179 → 188 |
| `VISUAL_LABEL_RUN_ON` | 24 → 32 | 6 → 8 | 30 → 40 |
| `VISUAL_LABEL_OVERLAP` | 5 → 5 | 0 → 0 | 5 → 5 |
| `VISUAL_LABEL_OWNER_DISTANCE` | 0 → 0 | 2 → 2 | 2 → 2 |
| `VISUAL_TERMINAL_DEPARTURE` | 66 → 39 | 17 → 10 | 83 → 49 |
| `VISUAL_TERMINAL_ON_FOREIGN_ROUTE` | 0 → 0 | 0 → 1 | 0 → 1 |
| `VISUAL_WIRE_THROUGH_SYMBOL` | 12 → 13 | 8 → 4 | 20 → 17 |

All other reported visual totals are zero in both runs. Clearance, run-on
and terminal-on-foreign-route fail the combined guard; dev wire-through-symbol
also increases. Reports: `/tmp/t067-r3-all-first.json`,
`/tmp/t067-r3-all-repeat.json`; comparison: `/tmp/t067-r3-summary.log`.

### Determinism and large documents

All 628 plan hashes, statuses, diagnostics, result metrics and equivalence
outcomes are identical before and after routing reuse (`DETERMINISM 628 628 []`).
The two evaluations on the exact final build also match on all those fields
(`DETERMINISM 628 628 []`). Existing identical-input and repeated-layout
contract tests pass. Evidence: `/tmp/t067-r3-determinism.log`,
`/tmp/t067-r3-final-determinism.log`; final-build reports:
`/tmp/t067-r3-all-repeat.json`, `/tmp/t067-r3-all-final-repeat.json`.

All six complete JSON-serialized plans match the saved main build:
`38m8wdesbh` (50 instances), `4fb59zv76m` (50), `8b2n3zf9vj` (51),
`b9afqhsjzv` (103), `g47e465db5` (70), `sm663cbs8b` (94).
Evidence: `/tmp/t067-r3-large.log`; command: `node /tmp/t067-large.mjs`.
The unchanged main package build is `/tmp/t067-base`; its originating HEAD
`c347745e33a5b99332f2beea2d524842dfc929a2` differs from plan base `b00910b`
only by the task plan. No branch switch was used.

### Held-out runtime

Final baseline and current timing commands ran sequentially, without concurrent
builds, tests, evaluations or comparisons. The baseline helper is the exact
`tmp/fixture-timing.mjs` harness with only its auto-layout import redirected to
the saved main build. Both used `held-out-cases.json`.

| Fixture | Main | Round 3 | Change | Within +10% |
| --- | ---: | ---: | ---: | --- |
| deadtime | 18508 ms | 16153 ms | −12.72% | pass |
| ltc3452 | 15295 ms | 17302 ms | +13.12% | fail |

Logs: `/tmp/t067-r3-final-base-timing.log`,
`/tmp/t067-r3-final-current-timing.log`,
`/tmp/t067-r3-final-timing-comparison.log`. The explicit timing checker exits 1.
Before routing reuse, the paired measurement was +12.02% / +17.93% for
`deadtime` / `ltc3452`. With net-only reuse, two pairs measured `ltc3452`
+14.52% and +13.90%. Stub/refusal reuse further improves it, but insufficiently.

## Investigation results

Runtime profiling attributed the extra work to relocation/rail finishing and
routing, rather than the final label-repair pass. In a profiled `ltc3452` run,
relocation took 7.76 s versus main's 5.49 s, rail search 3.14 s versus 1.27 s,
and finishing 8.69 s versus 5.43 s (nested phases overlap; do not sum them).
A temporary preview probe found only 3 identical-content duplicates among
3920 identity-cache misses, so broad content-based transaction caching was
not retained. Repeated net/stub planning on identical immutable snapshots was
reproducible and is now reused. The cache key includes the request and reserved
IDs; snapshot/resolver and public-call scope prevent stale reuse. All temporary
`[DEBUG-t067-*]` instrumentation was removed.

The amended label gate changes eleven drawings relative to round 2. It lowers
combined clearance from 191 to 188 and run-on from 49 to 40. It also adds four
crossings; val gains one bend and dev loses one relative to round 2. `routedGuards` contains
visual diagnostics, floating pins and missing connections; it does not contain
crossing/bend totals. Extending a diagnosed stub can therefore pass the specified
label gate while rerouting other wires. No new acceptance constraint or scoring
retune was introduced without a plan decision.

| Drawing | Split | Round-2 → round-3 effect |
| --- | --- | --- |
| `23wahmw6b2` | val | clearance −1, run-on −1; crossings 0→1, bends 3→4, wire 1220→1260 |
| `6s5h7b7fh9` | dev | clearance −1; crossings 0→2, bends 3→2, wire 1110→990 |
| `7ary9f5v85` | dev | clearance −1; wire 980→1020 |
| `eb25ea2c-790d-4e55-9453-4f78dcf0ba76` | dev | run-on −1; wire 720→770 |
| `k6bybqnz4b` | dev | run-on −1; wire 2640→2680 |
| `n3z4as7gcg` | val | run-on −1; wire 380→420 |
| `ppzgs289t8` | dev | run-on −1; wire 1790→1830 |
| `ryycgf9hf6` | dev | run-on −1; wire 220→260 |
| `tjatf7fjdr` | dev | run-on −1; wire 680→720 |
| `va2326fmq3` | val | run-on −1; wire 550→590 |
| `y2qecpr77m` | dev | run-on −1; crossings 6→7, wire 2900→2840 |

Relative to main on common drawings, dev's bend increases total +168 over
79 drawings, offset by −224 over 93 drawings. Val's increases total +81 over
35 drawings, offset by −67 over 32 drawings: the residual is +14 bends, plus
40 on the newly completed drawing. Dev clearance changes are +29/−23; val
common clearance changes are +11/−15, plus 7 on the new drawing. Dev run-on
changes are +17/−9; val changes are +4/−2. The following tables identify every
per-drawing increase, with concrete changed nets or label findings. The full
before/after placements, per-net bends and diagnostic objects are retained in
`/tmp/t067-r3-causes.json`; label counts were checked against the evaluation.

### Per-drawing label causes

`LC` is clearance; `LR` is run-on. Deltas are against main; the newly
completed drawing is explicitly marked. Findings name the actual conflicting
label and object(s); generated route IDs are rendered as “wire”. A “no stub
named/owned” note means none of that drawing's remaining diagnosed label
problems names a marker/port or an annotation it owns, so the stipulated
stub-only repair cannot address those conflicts. Other rows identify remaining
conflicts without assuming which rejection condition prevented a repair.

| Drawing | Split | ΔLC | ΔLR | Final conflicting labels/objects |
| --- | --- | ---: | ---: | --- |
| `244ym7g4ht` | val | +1 | +0 | LC: net-label-route-ui-73-b-74 over wire; no stub named/owned |
| `296p9s5vn2` | dev | +1 | +0 | LC: instance-label-P5 over M8 |
| `2bgg3pxz64` | dev | +0 | +1 | LR: Vinp's name "Vinp" and R1's name "R1" |
| `2bqpr5kx5c` | dev | +1 | +0 | LC: net-label-route-ui-7 over wire; LC: net-label-route-ui-41 over M3; no stub named/owned |
| `2fth4gkqvw` | dev | +1 | +0 | LC: instance-label-P5 over M4 |
| `2jhdk32et5` | dev | +1 | +0 | LC: instance-label-R2-copy-1 over wire; no stub named/owned |
| `386ggqhz53` | dev | +0 | +1 | LR: S2's name "S2" and C1's name "C1"; no stub named/owned |
| `3qr7ymvw7w` | val | +1 | +0 | LC: net-label-route-ui-173 over C1; no stub named/owned |
| `465ye6znxc` | dev | +0 | +1 | LR: M5's name "M5" and S's name "S" |
| `4vtqat76zf` | dev | +1 | +0 | LC: label-VDD1 over GND2 |
| `54a79nkqef` | dev | +0 | +1 | LR: X1's name "A" and Q1's name "Q1"; LR: M3's name "M3" and M1's name "M1"; no stub named/owned |
| `5yj2bfc5gy` | dev | +1 | +1 | LC: instance-label-X1 over wire; LR: R1's name "R1" and IN-'s name "IN-"; LR: IN+'s name "IN+" and R2's name "R2" |
| `6h64rkphmh` | val | +1 | +0 | LC: instance-label-P1 over wire; LC: instance-label-S1 over P1 |
| `6kdqknzyj2` | val | +1 | +0 | LC: instance-label-P1 over M4 |
| `6qd8k68e2t` | dev | +1 | +0 | LC: label-VDD1 over wire; no stub named/owned |
| `6qg2h7weje` | dev | +1 | +0 | LC: instance-label-P6 over M4 |
| `7c8zm2gr7e` | dev | +0 | +1 | LR: X1's name "X1" and Voutp's name "Voutp" |
| `7cf5c6mjqj` | val | +0 | +1 | LR: Ch's name "Ch" and Vdc's name "Vdc" |
| `7d93gjqbw8` | dev | +0 | +1 | LR: Q2's name "Q2" and R1's name "R1"; no stub named/owned |
| `7me953ys54` | dev | +1 | +0 | LC: instance-label-P4 over M4 |
| `8ws52x9256` | dev | +1 | +0 | LC: power-label-vdd2 over C1 |
| `a2nn9n6pbn` | dev | -1 | +1 | LR: M1's name "M1" and C1's name "C1"; no stub named/owned |
| `avtwmf4nh6` | dev | +1 | +0 | LC: net-label-route-ui-25 over wire; no stub named/owned |
| `dhnx9vs3zf` | dev | +0 | +1 | LR: Vbias's name "Vbias" and Vin2's name "Vin2" |
| `fxpjxwtwgq` | val | +1 | +0 | LC: net-label-route-ui-187 over M1; no stub named/owned |
| `gxkpf3k899` | dev | +0 | +1 | LR: C2's name "C1" and M3's name "M3"; no stub named/owned |
| `hdag4x8jrw` | val | +1 | +0 | LC: instance-label-mload over wire; LC: label-ldo-vgate over mload, wire; no stub named/owned |
| `jqzavktq25` | dev | +1 | +0 | LC: instance-label-P1-copy-1 over M2 |
| `jv9yfs5gnx` | dev | +2 | -1 | LC: instance-label-S3 over wire; LC: net-label-route-129489af0262b6a3 over wire; no stub named/owned |
| `jvkws955tv` | dev | +1 | +0 | LC: instance-label-P1-copy-1-copy-1-copy-1-copy-1-copy-1 over M6-copy-1-copy-1-copy-1-copy-1-copy-1 |
| `n756yysrkx` | dev | +1 | +0 | LC: instance-label-S3-copy-1 over wire; no stub named/owned |
| `ne46whs3fw` | dev | +2 | +0 | LC: net-label-route-ui-17 over V1, wire; LC: net-label-route-ui-15 over wire; no stub named/owned |
| `nqmdjx54je` | dev | +1 | +0 | LC: instance-label-mload over wire; LC: label-ldo-vgate over mload, wire; no stub named/owned |
| `p8mbn2ej8c` | dev | +2 | +0 | LC: net-label-route-ui-1 over S1; LC: net-label-route-ui-24 over C1, wire; LC: net-label-route-ui-33 over V2; no stub named/owned |
| `qdadm49css` | dev | +0 | +1 | LR: Rs's name "Rs" and M2's name "M2"; no stub named/owned |
| `qf5f4t5p8q` | dev | +0 | +1 | LR: CL's name "CL" and M4's name "M4"; no stub named/owned |
| `rxdzz3wdry` | dev | +1 | +0 | LC: text20 over wire; no stub named/owned |
| `s78j9fyzha` | val | +1 | +0 | LC: net-label-2 over IN2, wire; LC: inferred-bias-label-Vbias over VBIAS |
| `sahr77a4gy` | dev | +0 | +1 | LR: C1's name "C1" and V_DDREG's name "VDDREG" |
| `sbdmdbt4wt` | dev | +1 | +0 | LC: instance-label-M3 over P3 |
| `sbfkkj67cm` | val | +1 | +0 | LC: instance-label-P1 over M4_2 |
| `sf6e58mmjb` | dev | +0 | +1 | LR: M1's name "M1" and Vinn's name "Vinn" |
| `thvk3esjhs` | dev | +2 | +0 | LC: label-dfba03e2-1abc-4494-93e7-a5f91ac7011b over wire; LC: label-7994f139-f7d5-49f8-bd7d-43c24a5d0ce9 over wire; LC: label-110a50ff-5a9b-4710-950e-293588c9d4cc over m2; no stub named/owned |
| `tsvpdfd75s` | dev | +1 | +0 | LC: net-label-route-3631d779c7510f73-copy-1-copy-1-copy-1 over wire; no stub named/owned |
| `vcgtzej894` | dev | +1 | +1 | LC: instance-label-P4 over M2; LR: Vinp's name "Vinp" and M8's name "M8" |
| `vgk5a82dfc` | val | +1 | +0 | LC: instance-label-MN2 over B2 |
| `vkafsqxh8n` | val | +1 | +0 | LC: instance-label-P1 over M4 |
| `wvwmyesa4g` | dev | +1 | +1 | LC: instance-label-X1 over wire; LR: X1's name "Gm" and Vin's name "Vin" |
| `x5jaqe94t7` | val | +1 | +0 | LC: instance-label-P3 over M4 |
| `x5v9g25v3b` | val | +0 | +1 | LR: M3's name "M3" and CLKN's name "CLKN" |
| `xtk2ekkzp5` | val | +0 | +1 | LR: Vin's name "Vin" and RS's name "RS" |
| `xy58cpp5m8` | dev | +1 | +0 | LC: instance-label-P1 over M2 |
| `yje2n6eva2` | val | +7 | +0 | new completion; LC: instance-label-XSLAVE over wire; LC: instance-label-P3 over XSLAVE, wire; LC: instance-label-P4 over wire; LC: instance-label-P8 over XSLAVE; LC: power-label-vdd1_2 over VDD1_2; LC: power-label-vdd1_3 over VDD1_3; LC: auto-layout-label-6def5149910abb84 over XMASTER, wire |
| `z7zzac64t2` | val | +0 | +1 | LR: I1's name "IB" and R2's name "R2"; no stub named/owned |
| `zbnecpyqr9` | dev | +0 | +1 | LR: Vx1's name "Vx1" and Vx2's name "Vx2" |

### Per-drawing bend causes

Each listed net is identified by its terminal membership, avoiding renamed
Net IDs. Counts are main→round 3. These are the concrete rerouted nets that
add bends after shorter placement/search/finishing; some increases are offset
by fewer bends on other nets in the same drawing. The new completion has no
baseline routed plan. All per-net counts sum to the evaluator's bend totals.

| Drawing | Split | Δbends | Nets with added bends (main→round 3) |
| --- | --- | ---: | --- |
| `23wahmw6b2` | val | +1 | `C1.2,C3.1,M1.S,R1.1` 2→3 |
| `244ym7g4ht` | val | +1 | `GND3.0,X1.IN+` 0→1; `C2.1,C3.1,P1.P,X1.OUT` 2→3 |
| `29hn4q6qbk` | dev | +2 | `C1.2,I1.-,M1.G` 1→3 |
| `2bgg3pxz64` | dev | +4 | `GND2.0,X1.IN+` 1→2; `C1.1,R1.1,R2.2,R3.2` 0→1; `C2.1,P2.P,R2.1,X1.OUT` 2→5 |
| `2hxyaemr8h` | val | +1 | `C1.P2,L1.2,M1-copy-1.G,M1.D` 2→3 |
| `2jhdk32et5` | dev | +4 | `GND3-copy-1.0,Q1-copy-1.B` 1→2; `GND4-copy-1.0,Q1.E` 0→4; `Q1.C,R2-copy-1-copy-1.2,R2-copy-1.1` 0→2 |
| `2sqrha67j7` | dev | +2 | `C1-copy-1.1,P2-copy-1-copy-1.P,X1-copy-1-copy-1.OUT` 1→2; `C1-copy-1-copy-1.1,C1-copy-1.2,X1-copy-1-copy-1.IN-` 2→3 |
| `2zr5gwx42v` | dev | +5 | `GND1.0,Q1.S,Q2.E,Q2.S` 0→1; `P1.P,Q1.E,Q2.C` 0→4 |
| `386ggqhz53` | dev | +1 | `M1.S,M2.S,S3.2` 1→2 |
| `3brrjxvweb` | val | +3 | `C1-copy-1-2.2,GND1.0,M1.B,M1.D,M2.B,M2.D` 3→4; `C1-copy-1.2,P1.P` 0→2 |
| `3cr8ap2k4c` | dev | +1 | `GND3-copy-1-copy-1-copy-1-copy-1.0,Q1-copy-1-copy-1-copy-1-copy-1.B` 1→2; `GND5-copy-1-copy-1-copy-1-copy-1.0,Q1-copy-1-copy-1.B` 1→2; `M1-copy-1-copy-1-copy-1-copy-1.D,Q1-copy-1-copy-1-copy-1-copy-1.E,X1.IN-` 0→4 |
| `3pdxhn7cd8` | dev | +2 | `M1.G,X2.Y` 0→2 |
| `3qr7ymvw7w` | val | +2 | `GND1.0,X1.IN+` 1→2; `C1.1,C2.1,X1.IN-` 2→3 |
| `3zwtdefs7v` | dev | +4 | `M1-copy-1.D,M2-copy-1.S,M4-copy-1.G` 0→1; `M1-copy-1.G,M3-copy-1.G,M4-copy-1-copy-1.D,M9-copy-1.D,P2-copy-1.P` 3→4; `M2-copy-1.G,M5-copy-1.G,P1-copy-1.P` 0→2 |
| `4mrnbmegkb` | dev | +1 | `GND2.0,X1.IN+` 1→2; `C1.1,C2.2,X1.IN-` 2→4 |
| `4qk6efgw4z` | dev | +1 | `I2-copy-1.+,M1-copy-1.D,M1.G,M2-copy-1-copy-1.S` 2→4 |
| `4vtqat76zf` | dev | +3 | `I2.+,Q1.C,Q4.C` 0→4; `I2.-,Q2.E,Q4.B` 2→3; `P2.P,Q3.E,Q4.E` 1→3 |
| `4wce8zcf6c` | dev | +3 | `GND2-copy-1-copy-1.0,X1-copy-1-copy-1.IN+` 1→2; `C2-copy-1-copy-1.1,P2-copy-1-copy-1.P,X1-copy-1-copy-1.OUT` 2→3; `C2-copy-1-copy-1.2,S1.2,X1-copy-1-copy-1.IN-` 3→4 |
| `52fcykxabp` | val | +1 | `GND2.0,X1.IN+` 1→2; `C2.1,C4.1,P1.P,X1.OUT` 3→5 |
| `55g7v28588` | dev | +2 | `P1.P,X1.OUT,X4.2,X5.2` 2→4 |
| `59zd8d2t9q` | dev | +1 | `C1.1,C3.1,M1.G,M2.S` 3→4 |
| `5etmybq44s` | val | +4 | `M2-copy-1.G,M3-copy-1.G,P5.P` 1→2; `M3-copy-1.D,M4-copy-1.G` 1→2; `M1.D,M2.D,M3-copy-1.S,M4.D,P6.P` 2→3; `GND1.0,M2-copy-1.B,M2.B,M2.S,M3-copy-1.B,M3.B,M3.S` 0→1 |
| `5hjsy2g863` | val | +3 | `C1_2.1,M1_2.D,M3_2.D,instance-b116bc75-d403-4d30-8054-81f2e90aa930.P` 0→2; `M1_2.S,M2_2.D,X1_2.IN-` 2→3 |
| `5rfesjhe2f` | dev | +2 | `M1.S,R1.1` 0→1; `M1.D,M1.G,M2.G,M4.D,M5.S` 2→3 |
| `5szk39hcj3` | dev | +2 | `GND1.0,M2.D,M4.B,M4.S` 0→2 |
| `5yj2bfc5gy` | dev | +4 | `C1.2,R1.2,X1.IN-` 1→2; `C1.1,P3.P,X1.OUT-` 1→6; `C1-copy-1.2,R2.2,X1.IN+` 3→4 |
| `64fy6zcx24` | val | +1 | `GND3.0,Q2.E` 0→2; `R1-copy-1-copy-1-copy-1-copy-1.2,R1-copy-1-copy-1-copy-1.1,X1-copy-1-copy-1-copy-1.IN-` 3→4 |
| `6acrn4nr4v` | val | +4 | `I1.-,M2.D,P2.P` 0→1; `I2.+,M1.D,M2.S` 0→3 |
| `6c8e267vzp` | dev | +1 | `C1-copy-1-copy-1.2,L1-copy-1-copy-1.2,M1.D,P1.P,R1-copy-1-copy-1.2` 0→1 |
| `6dwz87zh3j` | dev | +2 | `M1.G,P1.P` 0→2 |
| `6ecccd6yxz` | val | +4 | `C1.2,P1-copy-1.P,R1.1` 2→3; `L1.1,P1.P,R1.2` 1→2; `C1.1,L1.2,P2.P,R2-copy-1.1,R2.1` 3→5 |
| `6ejj2kkc4t` | val | +3 | `C1-copy-1.1,R1-copy-1.2` 0→2; `C1-copy-1.2,M1-copy-1.G,P1.P` 1→2 |
| `6qg2h7weje` | dev | +1 | `M6.D,M8.D,P5.P` 0→1 |
| `7h6eqbghwc` | dev | +3 | `GND1-copy-1.0,X1-copy-1-copy-1-copy-1-copy-1-copy-1.IN+` 1→2; `P2-copy-1-copy-1-copy-1-copy-1-copy-1.P,R1-copy-1.1,X1-copy-1-copy-1-copy-1-copy-1-copy-1.OUT` 2→3; `R1-copy-1-copy-1.1,R1-copy-1.2,X1-copy-1-copy-1-copy-1-copy-1-copy-1.IN-` 3→4 |
| `8ws52x9256` | dev | +1 | `C1.2,M2.D,R1.2` 3→4 |
| `9267mkznwd` | val | +2 | `P2.P,X2.IN+` 0→2 |
| `ajbq2gb8bc` | val | +3 | `M1.G,M2.D,M3.D,M3.G,M6.D` 1→2; `M1.D,M2.G,M4.D,M4.G,M5.D` 1→3 |
| `avtwmf4nh6` | dev | +1 | `M1.G,M5.G,P2.P` 0→1; `M2.D,M5.D,M7.G` 0→1 |
| `b7v4fcpcfw` | dev | +2 | `I1.-,M1.D,M2.G,P2.P` 1→2; `I2.+,M1.G,M2.S,R1.1` 0→1 |
| `bbr8qbcane` | dev | +6 | `C2.2,GND3.0` 0→1; `C2.1,M1.D,M2.D,P1.P,R1.1` 2→5; `C1.1,D1.A,M1.G,M2.G,R1.2` 0→2 |
| `bcmat889t9` | val | +1 | `I1_2.+,M1_2.G,M2_2.G,M7_2.D,M7_2.G` 1→2 |
| `czmmfvytar` | dev | +2 | `GND1.0,M2-copy-1.B,M2.B,M2.S,M4.B` 0→1; `M1-copy-1.G,M1.D,M2-copy-1.G,M2.D` 0→1 |
| `db4fyqav9a` | val | +3 | `GND2.0,X1.IN+` 1→2; `C3.1,P2.P,X1.OUT` 1→2; `C1.1,C2.1,C3.2,X1.IN-` 3→4 |
| `dhnx9vs3zf` | dev | +1 | `M1.S,P3-copy-1.P` 0→1 |
| `dwyz9ezgd7` | val | +1 | `GND2.0,M1.G` 0→2 |
| `e6dgpfyw4h` | val | +3 | `GND1.0,Q2.C` 1→2; `GND3.0,Q1.C` 0→1; `P1-copy-1.P,R1-copy-1-copy-1.1,R1-copy-2-copy-1.1,X1-copy-1.OUT` 1→2; `Q1.E,R1-copy-2-copy-1.2,V1.+` 0→2; `R1-copy-1-copy-1.2,R1-copy-1.1,X1-copy-1.IN-` 2→3 |
| `ean7z7acmp` | dev | +1 | `G1.-,G1_2.-,G1_3.-,GND2.0` 1→4 |
| `ec4pqk2sbd` | dev | +1 | `C1-copy-1.2,C2-copy-1.1,L1-copy-1.2,M1-copy-1.D,P1-copy-1.P,R1-copy-1.2` 0→1 |
| `en97w8v92y` | dev | +5 | `GND1.0,X1.IN+` 1→3; `GND3.0,X1-copy-2.IN+` 0→3; `C1.1,C2.2,X1.IN-` 2→3; `C1.2,C4.2,P1.P` 2→4; `C3.2,C4.1,X1-copy-1.IN-,X1-copy-2.IN-` 3→5 |
| `etswaaj69w` | dev | +1 | `C2_2.2,M1_2.D,M2_2.S` 2→3 |
| `fbnrez8q5g` | dev | +1 | `GND1.0,M1-copy-1.B,M1.B,X1.IN+` 0→3 |
| `fcm237dfta` | val | +2 | `C2.1,M2.D,M3.G,R2.2` 0→1; `C3.1,M1.G,M3.D,P1.P,R3.2` 2→3 |
| `ftrjkg4566` | dev | +5 | `GND2.0,Q1.C` 2→4; `GND3.0,Q2.C` 0→1; `M1.D,M1.G,M2.G,M3.D` 2→4; `Q2.E,R1.2` 0→4 |
| `g8xh7jm33z` | dev | +3 | `GND1.0,M1.B,M2.G` 0→1; `P2.P,X1.Y` 0→2; `X2.Y,X3.A` 0→1 |
| `g9gb6dwm5s` | val | +1 | `M1-copy-1.G,M2-copy-1.G,P1-copy-1.P` 2→3 |
| `gbvzf4h3fj` | dev | +4 | `VDD3.P,X5.D` 0→3; `I1.-,X1.1` 0→2 |
| `gfym3hxbpn` | val | +1 | `Q1.E,R2.1` 0→1 |
| `ggt3nqdx7s` | dev | +1 | `C1.2,C2.1,M2.G` 1→2 |
| `gh3gcb5h3a` | dev | +1 | `GND1.0,Q1.B,Q1.C` 3→5; `GND2.0,Q2.B,Q2.C` 2→3; `M1.D,Q1.E,R2.1,X1.IN+` 0→3 |
| `gjjws82g9a` | dev | +3 | `C1.1,R1.2` 0→2; `C1.2,M1.G,P1.P` 1→2 |
| `hatmn7acta` | dev | +7 | `C1.2,C2.2,P8.P` 1→4; `M2.D,M3.D,X1.Y,X2.A` 2→3; `C1.1,M3.S,M4.D,M5.D` 0→3; `M1.D,X1.A,X2.Y` 1→2 |
| `hdkd8txc8r` | dev | +2 | `I1.-,M1.D,M1.G,M2.G,M3.G` 1→3 |
| `hjtfydjx52` | val | +1 | `C1.1,M2.G,R1.1` 1→2; `M1.D,M1.G,M2.D,P1.P` 3→4 |
| `hn8ma6xaxq` | dev | +2 | `GND2.0,X1.IN+` 1→2; `C1.2,S2.2,X1.IN-` 2→3 |
| `hr85s6jbqz` | dev | +1 | `GND2.0,X1.IN+` 1→2; `GND2-copy-1.0,X1-copy-1.IN+` 0→1; `C2_2.1,C3.2,X1-copy-1.IN-` 1→2 |
| `hrya6nrqet` | dev | +2 | `GND2.0,M2.B,M3.B,M3.D,V3.-,V4.-` 0→2 |
| `hskp76wcqz` | val | +1 | `M1.G,V1.+` 0→1 |
| `jgpyrcegvt` | dev | +1 | `C1.2,C2.1,S1.1,X1.IN-` 3→4; `C1.1,P1.P,S1.2,X1.OUT` 2→4 |
| `jz7rweg6gg` | dev | +1 | `M1.G,P3.P` 0→2 |
| `k234gfaas6` | dev | +1 | `M1.D,M1.G,M2.G,M3.D` 1→4 |
| `k4jm47e8p6` | val | +9 | `GND1.0,X1.IN+` 1→2; `C1.2,S1.2,S2-copy-1.1` 0→2; `C1.1,S2.1,S3.1` 0→3; `C2.1,P2.P,X1.OUT` 0→3 |
| `kjs4xgzkba` | dev | +1 | `GND1.0,M1.B,M1.S,M2.B,M3.B,M3.D` 0→1 |
| `kyxytts7gz` | dev | +1 | `GND5.0,Q3.B` 0→2 |
| `m6rez5w83z` | dev | +1 | `I1.+,M1.S,M3.D,M4.D` 1→2 |
| `n2e3qtpbhs` | dev | +2 | `M1.D,M2-copy-1.G,M2.D,M3-copy-1.G,M3.D` 0→2 |
| `nj7zffxnvv` | dev | +1 | `C1.1,M2.D,M4.D,P1.P,R1.1` 1→2 |
| `npwtgsnajt` | dev | +3 | `C1.1,C2.2,M1.G,R2.1` 1→2; `C1.2,C3.1,M1.D,P1.P,R1.1` 0→2 |
| `nxd3aqa7fp` | dev | +5 | `GND2.0,Q1.B` 0→2; `GND3.0,Q2-copy-1.C` 0→4 |
| `p85m2pf92t` | dev | +1 | `C2.2,M5.D` 0→1 |
| `p8efzmbdd6` | dev | +1 | `GND1.0,X1.IN+` 1→2 |
| `pa8jaxypze` | dev | +1 | `C1.1,P2.P,X1.IN-,X1.OUT` 2→3 |
| `pfb4wcvg2v` | dev | +2 | `M1.G,M2.G,P1.P,P2.P` 1→3 |
| `phw9hkynmn` | dev | +1 | `C1.1,P2.P,X1.IN-,X1.OUT` 2→3 |
| `qb3ypmpy8v` | val | +4 | `L2.1,M1.G` 0→4; `C2.1,L2.2,R1.2` 2→3 |
| `qf5f4t5p8q` | dev | +1 | `M4.G,M6.G,P2.P` 0→2 |
| `qk9r4bb46n` | val | +2 | `C1.1,R1.1` 0→2 |
| `qn9hqksgdb` | dev | +7 | `GND1.0,Q1.E,Q1.S` 0→4; `Q1.B,R1.1,R2.1` 1→3; `Q1.C,R3.1` 0→1 |
| `ray97q5c2j` | dev | +5 | `GND1.0,M1.B,M2.B,M3.B,Q1.B` 0→3; `M1.G,M2.G,M3.G,X1.OUT` 3→4; `M2.S,R1.1,R4.1,X1.IN+` 2→4; `M1.S,Q1.E,R3.1,X1.IN-` 1→2 |
| `rdszbstcny` | dev | +1 | `C1.2,V1.+` 0→1 |
| `s75dft4ssy` | dev | +1 | `GND1_2.0,M1.B,M2.B,M3.B,M4.B,X1_2.IN+` 0→2 |
| `sbdmdbt4wt` | dev | +1 | `M2.D,M3.D` 0→2; `M1-copy-1.D,M2.G,M4-copy-1.D` 0→1 |
| `sbfkkj67cm` | val | +1 | `M6_2.D,M8_2.D,P4_2.P` 0→1 |
| `sqzs5tv6f6` | dev | +1 | `I1-copy-1.-,M2.D,M3.G,M5.G` 4→5 |
| `sxc4y2gcbw` | dev | +3 | `GND3.0,X1.IN+` 0→1; `C1.1,P1.P,R2.1,X1.OUT` 0→2 |
| `sze66ptvbq` | dev | +1 | `I1.-,M1.D,M1.G,M2.G,M3.G` 1→2 |
| `tc45yqjk5g` | val | +2 | `P3.P,R1.1,R2.1,R3.2,R4.2` 0→2 |
| `varchfngzy` | val | +1 | `M4.D,M7.D` 1→2; `I1.-,M1.G,M2.G,M3.D,M3.G` 3→5 |
| `vbhxg297an` | val | +2 | `M2.B,M3.G,VDD1.P` 0→2; `M3.D,M4.D,M5.G,P2.P` 0→2 |
| `vcfdca5hqp` | val | +1 | `C1.1,P1.P` 0→1 |
| `vcgtzej894` | dev | +1 | `M3.D,M7.D,P3.P` 0→1 |
| `vhg3q4gax7` | dev | +1 | `M3.G,M4.G,X1.OUT` 1→2 |
| `vnza7y8xzt` | val | +3 | `I1.-,M1.S,M2.S` 0→2; `I2.-,M3.D,P5.P` 2→3 |
| `vrra9vwhb3` | dev | +4 | `R1.2,R2.1,X1.IN-` 0→3; `P2.P,R1.1,X1.OUT` 0→1 |
| `vtvb2bzz89` | dev | +1 | `M1.G,X1.OUT` 1→2 |
| `w7bdvc28hc` | dev | +1 | `GND1.0,X1.IN+` 1→2 |
| `wqpaqw7b27` | dev | +2 | `M1_2.G,M1_4.G,M6.G,M8.G` 0→2 |
| `wvwmyesa4g` | dev | +4 | `GND2.0,X1.IN+` 1→2; `C3.1,C4.1,P2.P,X1.OUT` 2→5 |
| `x3memyn4ae` | dev | +1 | `M1.G,V1.+` 0→1 |
| `x5v9g25v3b` | val | +2 | `M3.D,M4.D,M5.G,M6.G,M7.G,M8.G` 0→4 |
| `yje2n6eva2` | val | +40 | new completion; `VDD1_3.P,XSLAVE.VDD` 0→1; `P4.P,XMASTER.clkp,XSLAVE.clkn,cell-pin-a00e0d0c41068638.P` 0→4; `P6.P,XMASTER.qp` 0→2; `P8.P,XSLAVE.dp` 0→4; `P9.P,XMASTER.dp` 0→2; `XMASTER.clkn,XSLAVE.clkp,cell-pin-83f55b173aa48593.P` 0→6; `P10.P,P12.P,P2.P,XBUFN.G,XMASTER.dn,XSLAVE.qp` 0→3; `I1.-,XDREF.D,XDREF.G,XMASTER.iref,XSLAVE.iref,XTAILBUF.G,cell-pin-23aca5a45f1af6a6.P` 0→8; `R1.2,XBUFP.D,cell-pin-e7196640834d2b56.P` 0→1; `P13.P,P13_2.P,XMASTER.reset,XSLAVE.reset` 0→4; `P3.P,P7.P,XMASTER.qn,XSLAVE.dn` 0→5 |
| `yn2pjbpeby` | dev | +3 | `GND3.0,X1.IN+` 0→3 |
| `ysw8genh97` | dev | +1 | `C1.1,P2.P,X1.IN-,X1.OUT` 2→3 |
| `yx945wjdj4` | val | +4 | `R1.2,R2.1,X1.IN-` 0→3; `P2.P,R1.1,X1.OUT` 0→1 |
| `z9gtr4yznd` | val | +3 | `GND2.0,X1.IN+` 1→2; `C1.1,P2.P,X1.OUT` 1→3 |
| `zevf5z56bn` | dev | +1 | `C1-copy-1.1,C2-copy-1.2` 0→1; `C2-copy-1.1,C4-copy-1.1,I1-copy-1.+,P1-copy-1.P,R1-copy-1.1` 3→4 |

### Per-drawing crossing increases

Crossing increases are also retained because they fail a primary gate. This
list includes increases offset by improvements on other drawings. Exact
before/after layouts and the overlapping bend/label causes are in the artifact
above; the three new round-3 repair-related crossing regressions are separately
identified in the round-2 comparison table.

| Drawing | Split | Main→round 3 crossings |
| --- | --- | ---: |
| `23wahmw6b2` | val | 0→1 |
| `2jhdk32et5` | dev | 2→3 |
| `3cr8ap2k4c` | dev | 1→3 |
| `3zwtdefs7v` | dev | 0→1 |
| `465ye6znxc` | dev | 0→1 |
| `4mrnbmegkb` | dev | 0→1 |
| `5etmybq44s` | val | 3→5 |
| `5yj2bfc5gy` | dev | 1→2 |
| `6qg2h7weje` | dev | 4→5 |
| `6s5h7b7fh9` | dev | 1→2 |
| `8prnjcqxqn` | dev | 3→4 |
| `avqe2g6qrf` | dev | 0→1 |
| `bxw2egnpy9` | val | 1→3 |
| `c3qbntbj56` | val | 0→1 |
| `caafz7vv6j` | val | 0→2 |
| `d2bpftaqyq` | dev | 0→2 |
| `d6egcq7hxy` | dev | 0→1 |
| `dwyz9ezgd7` | val | 0→1 |
| `en97w8v92y` | dev | 0→7 |
| `fbnrez8q5g` | dev | 0→1 |
| `fbtd4f4s3g` | val | 0→1 |
| `g8xh7jm33z` | dev | 0→1 |
| `gbvzf4h3fj` | dev | 0→1 |
| `jv9yfs5gnx` | dev | 0→1 |
| `jz7rweg6gg` | dev | 3→4 |
| `jzq4wvkwmf` | dev | 0→1 |
| `k6bybqnz4b` | dev | 1→2 |
| `kaxfrg2ass` | dev | 1→3 |
| `ksgnxmtgp5` | val | 0→1 |
| `kyxytts7gz` | dev | 2→4 |
| `n756yysrkx` | dev | 0→1 |
| `ne46whs3fw` | dev | 0→1 |
| `nwarxxcwp7` | dev | 0→1 |
| `nxd3aqa7fp` | dev | 0→2 |
| `p2whdap25e` | dev | 0→1 |
| `q7zt3ydkyh` | dev | 0→1 |
| `qf5f4t5p8q` | dev | 2→5 |
| `ray97q5c2j` | dev | 3→8 |
| `s75dft4ssy` | dev | 0→1 |
| `sbfkkj67cm` | val | 4→5 |
| `sjwfsqd453` | val | 0→1 |
| `t6b97vkyjv` | dev | 0→1 |
| `tsvpdfd75s` | dev | 0→1 |
| `vbhxg297an` | val | 0→1 |
| `vcgtzej894` | dev | 4→5 |
| `vgk5a82dfc` | val | 1→2 |
| `wsgc5ae43p` | dev | 3→6 |
| `x4p48f96bp` | dev | 0→1 |
| `x7evbngj49` | dev | 1→3 |
| `y2qecpr77m` | dev | 6→7 |
| `yje2n6eva2` | val | not completed→37 |
| `yke5mejy7e` | dev | 2→3 |
| `yn2pjbpeby` | dev | 0→2 |

## Deviations and open questions

- The latest plan's implementation changes are complete, but overall acceptance
  is not achieved. Opus/user must decide the remaining bend/crossing/visual
  tradeoffs and the +13.12% `ltc3452` runtime gap. There was no search-budget
  reduction, diagnostic weakening or circuit-specific exception.
- The unchanged bounded repair still extends only diagnosed aligned nonzero
  short stubs. It does not move arbitrary device labels, detached wire labels,
  long/unaligned seats, or validated touching contacts. Many remaining findings
  involve those other objects; their concrete conflicts are listed above.
- The revised label acceptance rule permits the primary-metric tradeoffs shown
  above because crossings and bends are outside `routedGuards`. Adding those
  constraints, changing placement/routing design, or retuning scores requires a
  further plan decision; none was silently introduced.
- The two routing caches supplement finished-seat reuse and are confined to the
  existing public-call reuse scope. They preserve request inputs and outcomes,
  including refusal. They improve runtime but do not meet the held-out limit.
- Only owned source/tests, the spec and this report were edited. The existing
  `plan.md` modification and untracked `review.md` were left untouched.
  No dependencies, lockfile or generated source were hand-edited. No LLM-provider
  call, commit, push, merge, rebase or branch switch was run.
