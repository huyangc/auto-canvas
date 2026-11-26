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

## Independent review follow-up

The independent reviewer reproduced a command-load failure on setuptools 83.
The module requirement remains conditional on the backend version and the
command-load check now runs on every supported backend. The new bundled-command
case failed on the first commit and passed after the fix. All 21 packaging
tests and all 24 archive checks passed. The normal package build, typecheck,
lint, formatting and docs checks passed again.

The second review reproduced a failure in pip's backend subprocess. Some
CPython builds lexically collapse the interpreter's parent components in
`sys.executable`. For interpreter paths containing a parent component,
the CLI now resolves the parent directory using the OS and preserves the
final virtual-environment executable symlink. A Python venv regression
runs a child interpreter through `sys.executable` and verifies its prefix.
All 22 packaging tests passed with Python 3.13. The actual package build
through the reviewer's symlink-and-parent path passed, its archive passed
24/24 checks, and typecheck, lint, formatting and docs checks passed.
