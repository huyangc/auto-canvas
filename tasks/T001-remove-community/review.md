# T001 review

## Round 1 — accepted

Reviewed: `git diff main` on `task/T001-remove-community` after Codex round 1;
acceptance rerun by Opus.

Codex stopped at the plan's scope boundary as instructed. The remaining Gallery
source is held in place by consumers the plan put out of scope (`worker/`,
`apps/editor/build`, `apps/editor/census`, `apps/editor/dev/local-replica.ts`,
one `packages/project-protocol` test), and the two new `scripts/` failures come
from the upstream CI gate catalog still naming deleted Gallery specs. Both are
plan-scope gaps, not implementation defects; they move to follow-up tasks.

| #   | Severity | Where                                                                                                                                                        | Finding                                                                                   | Expected fix                                                |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | note     | `apps/editor/src/gallery-*.ts`, `features/editor-shell/gallery-*.ts`, `phone-viewing.ts`, `usage-policy-note.ts`, `apps/editor/analytics/{routes,worker}.ts` | Unreachable from the web editor; still imported by out-of-scope consumers.                | Delete with the Worker replacement / upstream cleanup task. |
| 2   | note     | `scripts/lib/ci-validation-plan.test.mjs:123`, `scripts/lib/validation-gates.test.mjs:323`                                                                   | Upstream CI gate catalog names removed Gallery specs.                                     | Remove with the upstream CI/gate infrastructure.            |
| 3   | note     | `packages/agent-adapter` capability tuple                                                                                                                    | Still advertises three Gallery read operations; the editor answers `GALLERY_UNAVAILABLE`. | Drop from the adapter when the Agent API is revised.        |
| 4   | note     | editor header                                                                                                                                                | "Presented by TokenZhang", GitHub link and site links remain.                             | Rebrand task.                                               |

Acceptance rerun:

```text
pnpm typecheck     → 0
pnpm lint          → 0 (0 errors)
pnpm format:check  → 0
pnpm build         → 0
pnpm test:local    → 1: 9046 passed, 5 failed = 3 baseline (simulation-artifact-files)
                     + 2 expected (finding 2)
playwright editor-shell "every web path" + Opus menu/request check → 2 passed;
  only /api/auth/providers and /api/auth/me requested, no page errors
```
