# T166 report — round 1

## Summary

`pnpm notebook:package` builds the canvas's offline package for
silicon-notebook sites: `output/notebook-canvas/auto-canvas-notebook-<version>/`
and a deterministic `.tar.gz` of it. It holds the server bundled into one ESM
file (`apps/server/dist/cli.js`, with `apps/server/package.json` marking the
directory as ESM), its migrations, the notebook build of the editor, the two
launchers (mode 755), the README and TOML examples, the plugin wheel, an
`env.example`, `VERSION` and `THIRD-PARTY-NOTICES.txt`; the UI package
directory is added when it exists (T165). `scripts/package-notebook-canvas-check.mjs`
proves the tarball runs from an empty directory with only a Node executable.
An opus subagent implemented it in its own worktree; it could not write this
file (the harness refused), so the reviewer wrote it from its report.

## Steps

| Step               | Status | Where                                                                                                                                                                                    |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Spike            | done   | under `tmp/spike/`: vite's SSR build works with the options of `headless-bundle.mjs` plus `rollupOptions.external` for the three optional add-ons; rolldown emits `createRequire` itself |
| 2 Bundle and guard | done   | `scripts/lib/server-bundle.mjs`: `bundleServer`, `scanBundle`, `nativeModules`, `packageRoots`, `collectLicences`, `noticesText`, `OPTIONAL_REQUIRES`                                    |
| 3 Packaging script | done   | `scripts/package-notebook-canvas.mjs`: refusals (exit 2), bundle guard (exit 1), copies, wheel, notices, `VERSION`, `env.example`, a tarball written in Node                             |
| 4 Unit tests       | done   | `scripts/package-notebook-canvas.test.mjs`, 9 tests, no build needed                                                                                                                     |
| 5 Check            | done   | `scripts/package-notebook-canvas-check.mjs`, 17 checks                                                                                                                                   |
| 6 Docs             | done   | "Offline package" in `integrations/silicon-notebook/README.md`; `docs/testing/README.md`                                                                                                 |

## Investigation results

- Without `rollupOptions.external` for `pg-native`, `bufferutil` and
  `utf-8-validate`, vite inlines a stub that throws a plain `Error` without the
  `MODULE_NOT_FOUND` code: `ws` would still catch it, but `pg.native` would
  throw instead of returning null. With it, the bundle keeps lazy `require`
  calls that fail as in a checkout.
- `new URL("./migrations/", import.meta.url)` stays as it is; the agent
  distribution JSON is inlined; the MathJax fonts become lazy initialisers in
  the one file; the bundle holds no absolute path of the build machine.
- A hostless database URL has no user in an empty environment; the check uses
  `postgresql://<current_user>@127.0.0.1/<db>`.

## Deviations

- The bundle guard is stricter than planned: it also refuses a non-literal
  `require`, a literal `import()` or a static import of a non-builtin, and a
  build that writes anything besides `cli.js`.
- Extra refusals: an editor build that is not a `/canvas` build; setuptools
  leftovers already in the plugin tree (so the script removes only what it
  created).
- `pip wheel` also runs with `--disable-pip-version-check`,
  `PIP_CONFIG_FILE=/dev/null`, `PIP_NO_INPUT=1`.
- Migrations are copied from `apps/server/src/migrations` (the bundle is built
  from source; `apps/server/dist/cli.js` is only required to exist).
- The check sets `AUTO_CANVAS_LOG_FILE` into its temporary directory, takes
  the newest tarball unless `--tarball` is given, and traces both
  `init-db.sh` and `serve.sh`.

## Evidence from the implementer

Package: 217 files, 23.1 MiB; bundle 6,012,062 bytes; wheel 2,080 bytes;
tarball 8,423,804 bytes, 229 entries, owner root/0, every mtime the commit
time. Two runs gave the same sha256 for the bundle, the wheel and the
tarball. Load trace of each launch: 19 modules, `apps/server/dist/cli.js` and
18 `node:` builtins; the only failed resolution was `bufferutil` inside `ws`'s
`try`. Negative control: a `throw` inserted into the bundle's lazily loaded
double-struck glyph module makes the check fail exactly at the formula
preview (16 of 17). An interrupt during the check leaves no database and no
temporary directory.

Third-party packages in the bundle (20): @hono/node-server, @mathjax/mathjax-newcm-font,
@mathjax/src, hono, pg and its eleven helper packages, split2, ws, xtend, zod.
Three ship no licence file (@mathjax/mathjax-newcm-font Apache-2.0, pg-types
MIT, pgpass MIT); the notices name them so.

## Not done or not verified

- The refusal for a missing build output was not exercised.
- Determinism was shown on one machine only.
- `THIRD-PARTY-NOTICES.txt` covers the server bundle only, as planned; the
  editor build's third-party code (React and others) is not listed.
- The packaged README links to `../../docs/…`, which the package does not
  contain.
