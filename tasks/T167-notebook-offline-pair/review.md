# T167 review

## Round 1 — changes-requested

Reviewed: Codex round 1 (`gpt-6.2-astra`, STATUS: partial — the sandbox
denied loopback and PostgreSQL), its uncommitted diff, and Opus's rerun of
every acceptance command outside the sandbox (`/tmp/claude-review/t167-review.sh 1`,
logs in `/tmp/claude-review/t167-r1/`). Two plan changes in this round (see
plan.md): the offline text says nothing about databases (the owner's
decision of 2026-11-25), and the readiness probe is `/api/ready`.

Rerun results: build, notebook build, launcher and package unit tests,
typecheck, lint, format, docs, deadcode 0; canvas package and its check 0
(21 of 21); stage S 0 (101 passed); stage M 0 (114 passed); stage L 0 (89
passed); `pnpm test:local` 0 (852 files); 0 leftover databases; the notebook
checkout unchanged. **Stage P exit 1 (45 passed, 1 failed)** after 1,610 s,
3.1 GB in the sandbox: all four packs (default, canvas, canvas-next,
companion) and their rewrite checks pass, P1 installs and starts the
default package, then `P1 GET /api/health -> 200` fails with **401**, and
the stage stops; P2–P4 never ran.

| # | Severity | Where | Finding | Expected fix |
| --- | --- | --- | --- | --- |
| 1 | must-fix | `scripts/lib/notebook-integration/stage-p.mjs` (`:274-277`, and P4) | A packaged silicon-notebook answers `/api/health` 401 without a session; its documented readiness probe is `/api/ready` (`packaging/DEPLOY.md:59, 228, 248`; `backend/app/main.py:590`). | P1 and P4 probe `GET /api/ready` → 200 (the plan now says so); keep the `/canvas` 404 check. Then make sure P2–P4 are complete as the plan describes (they never ran here). |
| 2 | must-fix | `integrations/silicon-notebook/README.md`, "Offline installation…" and "Upgrades and switching back" | The owner decided (2026-11-25) that the offline installation, upgrade and switch-back text says nothing about databases beyond what installing needs: no backup, restore, pairing or migration. The section has "Stop the notebook and back up its database and the canvas database together. Restore them as a pair. Restoring just one is unsupported.", "keep the existing canvas database URL … The canvas applies pending migrations at startup.", "Keep the canvas database and directory for reuse." | Remove those sentences (and any like them in `docs/testing/README.md`'s stage P text). Installation keeps creating the canvas database and running `init-db.sh` (needed to install). The switch-back says the canvas directory is left in place. silicon-notebook's own documents stay linked for everything else. |
| 3 | note | stage P | Duration about 27 minutes and 3.1 GB of sandbox for the build phase alone; recorded for `docs/testing/README.md`'s stage P section (what it needs). | State the measured time and disk there (the reviewer's figures above, updated after a full run). |

The four T165 follow-ups and their controls pass in stage S (101 checks).
The reviewer runs stage P again after this round; Codex cannot (no network).

## Round 2 — accepted by the task owner

Both round 1 must-fix findings are closed. The complete package workflow
passed through the P4 switch-back with the documented readiness endpoint.
The offline upgrade and switch-back instructions reflect the owner's
database-documentation decision. The testing guide now records resource
use for a complete run. A separate P2 SIGINT run exited 130, cleaned up
its companions and database, and removed its temporary root. See the
[report](report.md) for the host reruns and checks against main.

## Independent PR review, round 1

- The pinned notebook installer redirects venv stderr to a fixed file outside
  the stage root. The operator-facing test notes now document this upstream
  packaging limitation; the canvas check does not remove a file another
  installer may be using.
- A slow catalog lookup for a lost CREATE could exhaust the admin session
  before a confirmed database received its DROP. Cleanup now sends confirmed
  drops after the bounded activity poll and before querying the catalog for
  lost creates. A stage S control expires its session in the lookup and
  verifies that the confirmed DROP has already been sent.

## Independent PR review, round 2

The build checks the site inbox immediately before delivering each archive
and refuses to replace an existing destination. The offline install guide
and the stage both run isolated pip with its configuration disabled. A
fresh venv installed the packaged wheel with an unusable find-links URL
and a missing requirements file in the caller's pip environment. The CLI
also anchors relative wheel-builder paths at the invocation directory,
preserving their spelling for interpreter selection after the packer
changes directories.

## Independent PR review, round 3

The offline guide now requires replacing the example admin password before
the first launch. For a plugin-version upgrade it keeps services stopped
until the new wheel, matching UI, and service path are in place. It names
the new wheelhouse for the upgrader's version-pinned reinstall. The stage
prerequisites also describe the wheel dependency for older setuptools.

## Independent PR review, round 4

- The cache exclusion compares filesystem identities along directory
  ancestors, including when a requested cache has missing path components.
- Each package launch checks the configured ports immediately before starting
  the launcher. Paired launches check the canvas port as well.
- The offline operator's Bash snippets stop on a failed command before
  proceeding to the next service start.
- The owner of the notebook installer has a separate proposed fix for its
  shared diagnostic file in [silicon-notebook PR #1079](https://github.com/huyangc/silicon-notebook/pull/1079).

## Independent PR review, round 5

The default notebook pack explicitly supplies empty canvas rewrite and UI
plugin variables. The paired packs override them with the selected endpoint
and plugin. The guide uses the same build arguments. The integration
harness also rejects frontend dotenv files in its disposable build clone
and checks all three built rewrite manifests.

The approved stage P tests use the Node guard, a browser proxy, packaged
Node, a restricted site PATH and offline pip. An OS-wide egress policy for
all native and Python processes is a separate host requirement. The
testing guide describes the coverage and where to run a host-wide test.
