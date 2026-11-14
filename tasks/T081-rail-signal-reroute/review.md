# T081 review

## Round 1 — Opus, 2026-11-14

Verdict: **closed, not merged.** The signal-side retry is implemented safely
(628/628 equivalent, large documents and timing pass), but it changes no dev
drawing and regresses val `3brrjxvweb` by 0.0004 through later finishing,
and an existing local-marker test fails because the crossing disappears
before R155 adds its marker. The investigation explains why: 17 of the 18
signal–rail crossings were already tried by the earlier signal pass, and the
gate-row candidates that remove the rail crossing raise ordinary crossings
(3 → 6, 2 → 5). In the human drawings that gate line runs through another
device's symbol, which our guards forbid. Rerouting cannot close this gap;
the work stays on this branch for reference.
