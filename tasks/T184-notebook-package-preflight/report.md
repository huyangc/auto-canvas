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

The third review identified a venv whose bin directory is itself a symlink.
The CLI now resolves parent traversals individually, keeping a lexical parent
when it denotes the same directory and retaining the path suffix. The regression
exercises a linked bin directory and compares with the caller's direct
interpreter. Both suites use the same existing Python discovery order.
Launcher and packaging tests passed 69/69. The rebuilt package passed all 24
archive checks. Typecheck, lint, formatting, docs and deadcode passed.

Round 4 reproduced macOS native realpath accepting a parent traversal through
a regular file. The CLI now checks the original executable path with the
kernel before rewriting any traversal. The new case failed before the guard
and passed afterward. All 70 launcher and packaging checks, all 24 archive
checks, the normal package build and all static checks passed.
