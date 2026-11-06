# auto-canvas

[中文说明](README_zh.md)

auto-canvas is a web schematic canvas for analog circuits. Its goal is to take
a circuit netlist, place and route the devices automatically, let an engineer
fine-tune the drawing interactively in the browser, and hand the result to EDA
tools.

auto-canvas is built on [Analog Canvas](https://github.com/cascode-ai/analog-canvas)
by cascode-ai: the editor, its data model and its netlist interchange come from
an Analog Canvas snapshot. See [Built on Analog Canvas](#built-on-analog-canvas).

## Where it is going

```text
paper figure ─► netlist ─► automatic placement ─► human fine-tuning ─► EDA tools
                           and routing
(silicon-notebook)         (auto-canvas, planned) (auto-canvas editor) (Aether / EDA harness)
```

1. [silicon-notebook](https://github.com/huyangc/silicon-notebook) extracts
   circuit figures from papers and turns them into SPICE netlists.
2. auto-canvas imports the netlist and draws it with automatic placement and
   routing.
3. An engineer adjusts the drawing on the canvas.
4. The placed devices are connected to an EDA tool through its Agent or an EDA
   harness.

## Status

Works today:

- **Schematic editor** in the browser: device placement, wiring with
  connectivity-aware junctions and crossings, net labels, hierarchical Cells,
  undo, structural SPICE/Spectre import and export, SVG/PDF/PNG export.
- **Single-user server** (`apps/server`, PostgreSQL): Cloud Projects with
  optimistic revisions, three history versions, restore and SVG previews; the
  User Components library with catalog, publishing, deletion and restore.
- **Agent editing API** (MCP and HTTP) over the same typed edit model the GUI
  uses, and a headless workspace for scripted drawing.
- **Agent relay on the server.** Live Agent sessions use Node and PostgreSQL;
  Vite forwards HTTP and WebSocket traffic to `apps/server`.
- **Offline EDA export** scripts for Aether and Virtuoso in [eda/](eda/).
- **Desktop preview** (`apps/desktop`, Electron) that works without a server.

Not done yet:

- **Automatic placement and routing.** Netlist import places devices on a
  grid and draws no wires.
- **silicon-notebook integration.**
- **Simulation** is not part of auto-canvas. Export SPICE, Spectre or RNL
  for external tools; saved Project simulation folders are preserved.

## Requirements

- Node.js 24 or newer and pnpm 11.16
- PostgreSQL 16, with two databases owned by your OS user:

```bash
createdb auto_canvas
createdb auto_canvas_test
```

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm start
```

Open the printed URL (default <http://127.0.0.1:4310>). This builds the app,
starts the server in the background, and serves the editor, API and Agent relay
on one URL. Stop it with `pnpm stop`. Logs append to `.local/logs/server.log`.
The launcher creates a missing `auto_canvas` database when PostgreSQL CLI tools
are available; create `auto_canvas_test` separately before running tests.

For development, run `pnpm dev`: the API starts in the background and Vite
serves the editor with hot reload on <http://localhost:5173>. Ctrl+C stops both.
API logs append to `.local/logs/server-dev.log`. Use `pnpm dev:editor` to run
only Vite against an already-running server.

`npm run start`, `npm run stop` and `npm run dev` work the same; installing
must use pnpm. The server applies database migrations at startup. Configuration
(database URL, host, port, project limit and launcher timeouts) is in
[apps/server/README.md](apps/server/README.md).

Optionally copy [.env.example](.env.example) to `.env` at the repository root
and uncomment the settings you need. `start`, `stop` and `dev` load this Bash
configuration before applying defaults; exported shell variables take precedence.
A missing `.env` uses defaults. `.env` is ignored by Git.

## Commands

| Command                   | What it does                                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| `pnpm start`              | Build and start the whole app in the background                           |
| `pnpm stop`               | Stop the server on the configured port                                    |
| `pnpm dev`                | Server plus Vite hot reload; Ctrl+C stops both                            |
| `pnpm dev:editor`         | Editor dev server (Vite)                                                  |
| `pnpm server:dev`         | Build and start the server against `auto_canvas`                          |
| `pnpm server:migrate`     | Apply database migrations and exit                                        |
| `pnpm build`              | Build every package and app                                               |
| `pnpm check`              | Format, docs links, generated files, typecheck, lint, unit tests, build   |
| `pnpm test:local`         | Unit and integration tests (Vitest); server tests use `auto_canvas_test`  |
| `pnpm test:e2e:local`     | Browser tests (Playwright); run `pnpm setup:e2e` once to install Chromium |
| `pnpm mcp:package`        | Build the MCP server package for Agents                                   |
| `pnpm test:desktop-build` | Build the desktop renderer                                                |

## Repository layout

```text
apps/
  editor/       React schematic editor (web, and the desktop renderer)
  server/       Single-user Node server: identity, Cloud Projects, User Components
  desktop/      Electron desktop preview
  mcp-server/   MCP adapter for Agents
  local-host/   Minimal static host for a built editor
packages/
  model, edit-engine, derived, devices, symbols, components   circuit model and editing
  component-library                                            User Component contract
  spice, netlist, rnl, project-protocol                        import, export, file format
  render-svg, exporters, math-typesetting                      rendering and figure export
  agent-adapter, agent-client, agent-routing                   Agent API
eda/            Offline Aether / Virtuoso import tools
docs/           Contracts, guides and the development workflow
tasks/          One directory per development task: plan, report, review
```

## How development works

Opus (Claude Code) writes a plan for each task, Codex implements it, and Opus
reviews the result by rerunning the acceptance commands and reading the diff.
Reviewed work reaches `main` through a pull request that needs passing CI and
a posted codex review. See [docs/workflow.md](docs/workflow.md),
[AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md).

## Documentation

- [Documentation map](docs/README.md)
- [Server HTTP contract](docs/specs/server.md)
- [Specifications](docs/specs/README.md)
- [EDA tools](docs/eda-import.md)
- [Agent guide](docs/agent/README.md)

## Built on Analog Canvas

auto-canvas is a modified version of **Analog Canvas**, an open-source,
connectivity-aware schematic editor by cascode-ai.

- Repository: <https://github.com/cascode-ai/analog-canvas>
- Hosted editor and Community Gallery: <https://analog-canvas.tokenzhang.com/>
- Snapshot: commit `3d32c76` (version 0.9.2, 2026-11-05), recorded in
  [UPSTREAM.md](UPSTREAM.md)

From Analog Canvas: the schematic editor, the circuit model and edit engine,
the symbol and device library, SPICE/Spectre import and export, rendering and
figure export, the Agent API and MCP server, the desktop preview and the EDA
export scripts.

Changed in auto-canvas: the hosted Gallery, accounts, Cloudflare deployment and
upstream CI are removed; `apps/server` replaces the Cloudflare Worker for
Cloud Projects and User Components; the development workflow is new; automatic
placement and routing is the work ahead.

If auto-canvas helps your work, please credit Analog Canvas as well.
