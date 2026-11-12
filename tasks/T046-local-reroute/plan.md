# T046 — Local rerouting for crossed layouts

Branch: codex/t042-unrouted-net-repair, after T045.

1. Use crossing evidence to select a bounded set of candidates, leave placement unchanged, try local wire alternatives, retain the incumbent on a tie or regression. Respect protected geometry and replay checks.
2. On the same 30 Gallery originals run the default search and compare with T045, T044 and originals. Verify physical connectivity, wire safety, electrical equivalence where extractable and the four Brokaw captions after serialization. Publish a same-scale comparison locally.
3. Own packages/auto-layout/src and test, the APR spec and this task. Run package tests, repository typecheck, changed-source format and whitespace checks.
