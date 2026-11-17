# T127 — Rail markers sit at the pin they serve, for every device kind

- Branch: `task/T127-rail-marker-hosts`
- Base: `main` at `af3a8e7`
- Status: approved under the user's 2026-11-16 goal to work through the listed
  optimisation points (item: supply/ground marker and port seating)

Numbers T088–T119 were used by an uncommitted experimental run and are skipped.

## Goal

A ground or supply marker whose rail partner is a BJT, op-amp, flip-flop or
other non-MOS multi-pin device pin is seated next to that pin and joined by a
short straight lead, exactly as it already is for MOS channel pins and two-pin
parts. Today such a marker gets no host: it is parked somewhere else and joined
through a rail trunk, which produces long loops around the drawing.

Observed on the corpus (human reviewer, random sample): `c3qbntbj56` — Q2's base
is grounded through a wire that leaves to the right, climbs over the whole
circuit and comes down to a ground marker at the top left ("why does Q2's
ground go all the way around the top?"). Other sightings from experiments:
`ecyqst76jd`, `z9mewmgkst`, `7d93gjqbw8` (BJT bases tied to ground with markers
parked far away).

## Context

- `powerHosts` in `packages/auto-layout/src/place-markers.ts:41` accepts only
  MOS D/S pins or two-pin devices as marker hosts. `assignPowerHosts`
  (`packages/auto-layout/src/pin-contacts.ts:49`) returns `undefined` for other
  pins, so no R12 stub is made; the marker falls into `remaining` and is joined
  by `railTrunk` (`packages/auto-layout/src/route.ts:228-232`), R43.
- T124 (merged) stopped the open-stub defect of that path but left the host
  rule as it is (see `tasks/T124-marker-stub-dangling/review.md`, finding 3).
- Rules R12, R43, R155 (local rail markers), R146/R148 (port and rail seat
  searches) in `docs/specs/auto-layout.md` describe marker seating. Read them
  before changing anything: later passes (rail-seat search, local rail markers)
  may already move markers and must keep working.
- Evaluation: `scripts/auto-layout-eval.mjs`; baseline report of `main`:
  `tmp/inputs/main-af3a8e7-report.json` (612 completed, 16 refused).

## Scope

Owned paths:

- `packages/auto-layout/src/place-markers.ts`, `pin-contacts.ts`, and — only if
  the investigation shows the stub or seat code needs it — `route.ts` (marker
  stub targets) and `rail-seat-search.ts`
- `packages/auto-layout/test/**` — new regression tests (synthetic fixtures)
- `docs/specs/auto-layout.md` — R12/R43 text

Out of scope: device placement, the routing of non-rail Nets, label seating,
scoring weights.

## Steps

1. Investigate and report: (a) over the corpus, how many markers are joined
   without a host today, by partner pin kind (BJT B/C/E, op-amp inputs/supplies,
   other blocks, ports), in how many cases, and how long their rail wires are
   compared with hosted markers; (b) why the host rule is restricted to MOS D/S
   and two-pin parts (history: grep the spec and tasks for the rule's origin —
   R12/R43/T071) and what would break if any visible device pin could host:
   which side of the pin does the marker go (ground below, supply above; what
   about a pin that leaves its symbol sideways or upward, like a BJT base or an
   op-amp input), collisions with the device's own wires, labels.
2. Generalise the host rule: any visible, non-bulk device pin on a rail Net may
   host its marker. The marker sits on the rail's side of the pin (ground below,
   supply above) reached by one straight lead when the pin leaves the symbol
   toward that side, or by a short L (one bend) when the pin leaves sideways;
   when neither seat is free, fall back to today's behaviour. Keep MOS and
   two-pin behaviour byte-identical.
3. Tests: BJT base to ground, BJT emitter/collector to a rail, op-amp input to
   ground, a block's supply pin; each asserts the marker's seat and the lead's
   shape (length, bends), and that the fallback still routes when the seat is
   blocked.
4. Corpus evaluation.

## Acceptance

```bash
export pnpm_config_verify_deps_before_run=false npm_config_verify_deps_before_run=false
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check   # all 0
pnpm vitest run packages/auto-layout scripts/visible-integrity.test.mjs   # 0 failures
node scripts/auto-layout-eval.mjs tmp/inputs/le10-input --jobs 6  # exits 0
```

- No case `threw`; the same 16 cases refused; all completed cases equivalent;
  no introduced dangling wires, unconnected pins or touching pins.
- Against `tmp/inputs/main-af3a8e7-report.json`: list changed plans; totals for
  wire, bends, crossings, label clearance, label overlaps, dev and val
  separately. Expected: wire and bends down in the changed cases, crossings not
  up; every case that gets worse on crossings or bends is listed and explained.
  Cases with only MOS and two-pin rail partners keep their plan hash.
- Render ORIGINAL | main | result for `c3qbntbj56`, `ecyqst76jd`, `7d93gjqbw8`
  and 7 more changed cases chosen by a stated rule (not hand-picked) and look at
  them: the marker sits at its pin and the long loop is gone.
- The reviewer reruns `pnpm test:local` and `pnpm test:slow`; do not run them.

## Notes for the implementer

Do not commit implementation. Never render, study or name the ids under
`sealed` in `tmp/inputs/sample.json`; the ids in `tmp/inputs/sample2.json` have
already been shown to the reviewer and may be used. Iterate on a sub-corpus of
the affected cases plus 30 others; run the full 628-case evaluation once at the
end.
