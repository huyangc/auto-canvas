# T184 report — offline wheel preflight

The packaging CLI preserves path traversal through symbolic links when invoked from another directory. For setuptools 68 through 70.0, the Python probe loads the wheel command through the selected setuptools distribution before packaging begins. The usage example and offline packaging guide list the build interpreter requirements.

## Acceptance

| Check | Result |
| --- | --- |
| Packaging tests before the fix | 2 new regressions failed, 18 passed |
| Packaging tests after the fix | All 20 passed |
| Typecheck, lint, formatting and documentation links | Passed. Lint reported 0 errors and 4,001 warnings |
| `pnpm notebook:package` with the configured packaging Python | Produced the 218-file package and 8.0 MiB archive |
| `node scripts/package-notebook-canvas-check.mjs --tarball <archive>` on PostgreSQL lane 3 | 24/24 passed, including browser boot and offline wheel installation |

The regressions exercise two executable files reached through different interpretations of a symbolic link followed by a parent component, and a backend whose wheel module imports while its command cannot load. The existing Python, pip, setuptools, wheel and sanitized-environment checks also pass.
