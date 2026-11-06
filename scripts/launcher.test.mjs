import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";

const scripts = fileURLToPath(new URL(".", import.meta.url));
let root;
let env;
let children;

function executable(name, source) {
  writeFileSync(join(root, "bin", name), source, { mode: 0o755 });
}

function launch(script, extra = {}) {
  const child = spawn("bash", [join(root, "scripts", `${script}.sh`)], {
    cwd: tmpdir(), // Launchers must find their own repository root.
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  const result = once(child, "close").then(([code]) => ({ code, output }));
  return { child, result };
}

function alive(pid) {
  const state = spawnSync("ps", ["-p", String(pid), "-o", "stat="], {
    encoding: "utf8",
  }).stdout.trim();
  return state !== "" && !state.includes("Z");
}

async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for fixture");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "auto-canvas-launcher-"));
  children = [];
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  for (const script of [
    "start.sh",
    "stop.sh",
    "dev.sh",
    "lib/launcher.sh",
    "lib/editor-supervisor.mjs",
  ]) {
    cpSync(join(scripts, script), join(root, "scripts", script));
  }
  mkdirSync(join(root, "apps/server/src"), { recursive: true });
  cpSync(
    join(scripts, "../apps/server/src/base-path.ts"),
    join(root, "apps/server/src/base-path.ts"),
  );
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "apps/server/dist"), { recursive: true });
  // A real TCP listener proves health, shutdown, and process ownership. Only
  // external build/PostgreSQL commands are replaced at their boundaries.
  writeFileSync(
    join(root, "apps/server/dist/cli.js"),
    `const http = require('node:http');
const fs = require('node:fs');
fs.writeFileSync('server.pid', String(process.pid));
fs.writeFileSync('server-env.json', JSON.stringify(process.env));
if (process.env.FIXTURE_MODE === 'crash') { console.error('fixture startup failure'); process.exit(7); }
if (process.env.FIXTURE_MODE === 'hang') setInterval(() => {}, 1000);
else http.createServer((req, res) => {
  if (req.url !== (process.env.AUTO_CANVAS_BASE_PATH || '') + '/api/health') { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ok:true}));
}).listen(Number(process.env.PORT), process.env.HOST);
process.on('SIGTERM', () => {
  if (process.env.FIXTURE_MODE !== 'ignore-term') process.exit(0);
});
`,
  );
  writeFileSync(
    join(root, "vite.cjs"),
    `require('node:fs').writeFileSync('vite.pid', String(process.pid));
if (process.env.FIXTURE_VITE_FAIL) process.exit(9);
if (process.env.FIXTURE_VITE_SLOW_CLOSE) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => setTimeout(() => process.exit(0), 300));
  }
}
setInterval(() => {}, 1000);
`,
  );
  executable(
    "pnpm",
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FIXTURE_ROOT/build.log"
if [[ "$*" == dev:editor ]]; then exec node vite.cjs; fi
exit "\${FIXTURE_BUILD_EXIT:-0}"
`,
  );
  executable(
    "psql",
    `#!/usr/bin/env bash
set -euo pipefail
case "\${FIXTURE_DB_MODE:-healthy}" in
  healthy) exit 0 ;;
  unreachable) echo 'fixture connection refused' >&2; exit 2 ;;
  missing)
    if [[ "$1" == *'/postgres'* ]]; then exit 0; fi
    [[ -f "$FIXTURE_ROOT/db-created" ]]
    ;;
esac
`,
  );
  executable(
    "createdb",
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" > "$FIXTURE_ROOT/db-created"\n',
  );
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  env = {
    ...process.env,
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
    PORT: String(port),
    HOST: "127.0.0.1",
    DATABASE_URL: "postgresql:///auto_canvas",
    START_TIMEOUT: "2",
    STOP_TIMEOUT: "1",
    FIXTURE_ROOT: root,
  };
});

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "close");
    }
  }
  for (const file of ["server.pid", "vite.pid"]) {
    if (!existsSync(join(root, file))) continue;
    try {
      process.kill(Number(readFileSync(join(root, file), "utf8")), "SIGKILL");
    } catch {
      // A successful cleanup has already removed the process.
    }
  }
  rmSync(root, { recursive: true, force: true });
});

test("background start waits for health, refuses a second start, stops by port, and is idempotent", async () => {
  const started = await launch("start").result;
  expect(started.code).toBe(0);
  expect(started.output).toContain(`http://127.0.0.1:${env.PORT}`);
  expect(readFileSync(join(root, "build.log"), "utf8")).toBe("build\n");
  expect(
    await (await fetch(`http://127.0.0.1:${env.PORT}/api/health`)).json(),
  ).toEqual({ ok: true });
  const second = await launch("start").result;
  expect(second.code).toBe(1);
  expect(second.output).toContain("already in use");
  expect(second.output).toContain(
    readFileSync(join(root, "server.pid"), "utf8"),
  );
  expect((await launch("stop").result).code).toBe(0);
  const stopped = await launch("stop").result;
  expect(stopped).toMatchObject({ code: 0 });
  expect(stopped.output).toContain("not running");
});

test.each(["start", "dev"])(
  "%s and stop load repository .env from any working directory",
  async (script) => {
    writeFileSync(
      join(root, ".env"),
      `PORT=${env.PORT}
HOST=127.0.0.1
DATABASE_URL=postgresql:///env_canvas
AUTO_CANVAS_PROJECT_LIMIT=17
AUTO_CANVAS_AGENT_IDLE_MS=12345
START_TIMEOUT=2
STOP_TIMEOUT=1
SKIP_BUILD=1
`,
    );
    const configuration = {
      PORT: undefined,
      HOST: undefined,
      DATABASE_URL: undefined,
      AUTO_CANVAS_PROJECT_LIMIT: undefined,
      AUTO_CANVAS_AGENT_IDLE_MS: undefined,
      START_TIMEOUT: undefined,
      STOP_TIMEOUT: undefined,
      SKIP_BUILD: undefined,
    };
    const running = launch(script, configuration);
    if (script === "dev") {
      await until(() => existsSync(join(root, "vite.pid")));
    } else {
      expect((await running.result).code).toBe(0);
      expect(existsSync(join(root, "build.log"))).toBe(false);
    }
    expect(
      JSON.parse(readFileSync(join(root, "server-env.json"), "utf8")),
    ).toMatchObject({
      PORT: env.PORT,
      HOST: "127.0.0.1",
      DATABASE_URL: "postgresql:///env_canvas",
      AUTO_CANVAS_PROJECT_LIMIT: "17",
      AUTO_CANVAS_AGENT_IDLE_MS: "12345",
      START_TIMEOUT: "2",
      STOP_TIMEOUT: "1",
    });
    const stopped = await launch("stop", configuration).result;
    expect(stopped.code).toBe(0);
    expect(stopped.output).toContain("auto-canvas stopped.");
    expect((await launch("stop", configuration).result).output).toContain(
      "not running",
    );
  },
);

test.each(["start", "dev"])(
  "%s and stop prefer exported shell values over .env, including empty and quoted values",
  async (script) => {
    writeFileSync(
      join(root, ".env"),
      `PORT=invalid
HOST=invalid
DATABASE_URL=postgresql:///env_canvas
AUTO_CANVAS_USER_NAME='Env user'
AUTO_CANVAS_PROJECT_LIMIT=17
AGENT_ALLOWED_ORIGIN=http://env.invalid
START_TIMEOUT=invalid
STOP_TIMEOUT=invalid
`,
    );
    const configuration = {
      AUTO_CANVAS_USER_NAME: 'Shell user\'s "name"\n$(not-a-command)',
      AUTO_CANVAS_PROJECT_LIMIT: "23",
      AGENT_ALLOWED_ORIGIN: "",
    };
    const running = launch(script, configuration);
    if (script === "dev") {
      await until(() => existsSync(join(root, "vite.pid")));
    } else {
      expect((await running.result).code).toBe(0);
    }
    expect(
      JSON.parse(readFileSync(join(root, "server-env.json"), "utf8")),
    ).toMatchObject({
      ...configuration,
      PORT: env.PORT,
      HOST: env.HOST,
      DATABASE_URL: env.DATABASE_URL,
      START_TIMEOUT: env.START_TIMEOUT,
      STOP_TIMEOUT: env.STOP_TIMEOUT,
    });
    const stopped = await launch("stop").result;
    expect(stopped.code).toBe(0);
    expect(stopped.output).toContain("auto-canvas stopped.");
  },
);

test("missing .env is optional and stop uses the default port", async () => {
  executable(
    "lsof",
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" > "$FIXTURE_ROOT/lsof.log"\nexit 1\n',
  );
  const stopped = await launch("stop", { PORT: undefined }).result;
  expect(stopped.code).toBe(0);
  expect(stopped.output).toContain("not running on port 4310");
  expect(readFileSync(join(root, "lsof.log"), "utf8")).toContain("-iTCP:4310");
});

test("missing dependencies and failed builds fail before starting a server", async () => {
  rmSync(join(root, "node_modules"), { recursive: true });
  const missing = await launch("start").result;
  expect(missing.code).toBe(1);
  expect(missing.output).toContain("pnpm install --frozen-lockfile");
  mkdirSync(join(root, "apps/server/src"), { recursive: true });
  cpSync(
    join(scripts, "../apps/server/src/base-path.ts"),
    join(root, "apps/server/src/base-path.ts"),
  );
  mkdirSync(join(root, "node_modules"));
  expect((await launch("start", { FIXTURE_BUILD_EXIT: "7" }).result).code).toBe(
    7,
  );
  expect(existsSync(join(root, "server.pid"))).toBe(false);
});

test("creates only the missing default database and honors SKIP_BUILD", async () => {
  expect(
    (
      await launch("start", { FIXTURE_DB_MODE: "missing", SKIP_BUILD: "1" })
        .result
    ).code,
  ).toBe(0);
  expect(readFileSync(join(root, "db-created"), "utf8")).toContain(
    "--maintenance-db=postgresql:///postgres auto_canvas",
  );
  expect(existsSync(join(root, "build.log"))).toBe(false);
});

test("unreachable and missing custom databases report the attempted URL without creating a database", async () => {
  const unreachable = await launch("start", { FIXTURE_DB_MODE: "unreachable" })
    .result;
  expect(unreachable.code).toBe(1);
  expect(unreachable.output).toContain(
    "DATABASE_URL=postgresql:///auto_canvas",
  );
  const custom = await launch("start", {
    DATABASE_URL: "postgresql:///custom_canvas",
    FIXTURE_DB_MODE: "missing",
  }).result;
  expect(custom.code).toBe(1);
  expect(custom.output).toContain("DATABASE_URL=postgresql:///custom_canvas");
  expect(existsSync(join(root, "db-created"))).toBe(false);
});

test("startup failure prints the log tail and timeout cleans up the process it started", async () => {
  const crashed = await launch("start", { FIXTURE_MODE: "crash" }).result;
  expect(crashed.code).toBe(1);
  expect(crashed.output).toContain("fixture startup failure");
  const hung = await launch("start", {
    FIXTURE_MODE: "hang",
    START_TIMEOUT: "1",
  }).result;
  expect(hung.code).toBe(1);
  const pid = Number(readFileSync(join(root, "server.pid"), "utf8"));
  expect(alive(pid)).toBe(false);
});

test("interrupting startup cleans up its unready server", async () => {
  const running = launch("start", {
    FIXTURE_MODE: "hang",
    START_TIMEOUT: "30",
  });
  await until(() => existsSync(join(root, "server.pid")));
  running.child.kill("SIGINT");
  expect((await running.result).code).toBe(130);
  expect(alive(Number(readFileSync(join(root, "server.pid"), "utf8")))).toBe(
    false,
  );
});

test("stop escalates to SIGKILL after its grace period", async () => {
  expect(
    (await launch("start", { FIXTURE_MODE: "ignore-term" }).result).code,
  ).toBe(0);
  const stopped = await launch("stop", { STOP_TIMEOUT: "0" }).result;
  expect(stopped.code).toBe(0);
  expect(stopped.output).toContain("SIGKILL");
});

test("development starts Vite and Ctrl+C frees the server port and stops Vite", async () => {
  const running = launch("dev");
  await until(() => existsSync(join(root, "vite.pid")));
  expect(readFileSync(join(root, "build.log"), "utf8")).toBe(
    "--filter @icm/server... build\ndev:editor\n",
  );
  running.child.kill("SIGINT");
  expect((await running.result).code).toBe(130);
  const stopped = await launch("stop").result;
  expect(stopped.output).toContain("not running");
  expect(alive(Number(readFileSync(join(root, "vite.pid"), "utf8")))).toBe(
    false,
  );
});

test("a failed Vite command propagates its status and cleans up the API", async () => {
  expect((await launch("dev", { FIXTURE_VITE_FAIL: "1" }).result).code).toBe(9);
  expect((await launch("stop").result).output).toContain("not running");
});

test("missing pnpm fails fast with installation instructions", async () => {
  rmSync(join(root, "bin", "pnpm"));
  symlinkSync("/bin/bash", join(root, "bin", "bash"));
  symlinkSync("/usr/bin/dirname", join(root, "bin", "dirname"));
  const missing = await launch("start", { PATH: join(root, "bin") }).result;
  expect(missing.code).toBe(1);
  expect(missing.output).toContain("pnpm is required on PATH");
  expect(missing.output).toContain("pnpm install --frozen-lockfile");
});

test("Linux ss fallback extracts every PID and refuses an unidentified listener", async () => {
  executable(
    "ss",
    `#!/usr/bin/env bash
printf '%s\\n' "$FIXTURE_SS_OUTPUT"
`,
  );
  // Force the ss boundary even on macOS, where lsof is always installed.
  writeFileSync(
    join(root, "scripts", "inspect.sh"),
    `#!/usr/bin/env bash
source "$(dirname "\${BASH_SOURCE[0]}")/lib/launcher.sh"
command() {
  if [[ "$1" == -v && "$2" == lsof ]]; then return 1; fi
  builtin command "$@"
}
launcher_listeners
printf '%s\\n' "$launcher_listener_pids"
launcher_port_free
`,
  );
  const known = await launch("inspect", {
    FIXTURE_SS_OUTPUT:
      'LISTEN 0 511 127.0.0.1:4310 0.0.0.0:* users:(("node",pid=123,fd=3),("node",pid=456,fd=3))',
  }).result;
  expect(known.code).toBe(1);
  expect(known.output).toContain("123\n456\n");
  expect(known.output).toContain("already in use");
  const hidden = await launch("inspect", {
    FIXTURE_SS_OUTPUT: "LISTEN 0 511 127.0.0.1:4310 0.0.0.0:*",
  }).result;
  expect(hidden.code).toBe(1);
  expect(hidden.output).toContain("already in use");
});

test("repeated package-manager signals cannot interrupt development cleanup", async () => {
  const running = launch("dev", { FIXTURE_VITE_SLOW_CLOSE: "1" });
  await until(() => existsSync(join(root, "vite.pid")));
  running.child.kill("SIGINT");
  await new Promise((resolve) => setTimeout(resolve, 50));
  running.child.kill("SIGTERM");
  expect((await running.result).code).toBe(130);
  expect((await launch("stop").result).output).toContain("not running");
  expect(alive(Number(readFileSync(join(root, "vite.pid"), "utf8")))).toBe(
    false,
  );
});

test("editor supervisor kills a process group that ignores SIGTERM after STOP_TIMEOUT", async () => {
  // `sh` leads the group and prints its PID; `sleep` inherits the ignored
  // SIGTERM, standing in for a Vite worker that does not shut down.
  const supervisor = spawn(
    process.execPath,
    [
      join(scripts, "lib/editor-supervisor.mjs"),
      "sh",
      "-c",
      'trap "" TERM; echo $$; sleep 30',
    ],
    {
      env: { ...process.env, STOP_TIMEOUT: "1" },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const [line] = await once(supervisor.stdout, "data");
  const group = Number(String(line).trim());
  expect(Number.isInteger(group) && group > 0).toBe(true);
  const started = Date.now();
  supervisor.kill("SIGTERM");
  await once(supervisor, "exit");
  // The group survived SIGTERM, so it is gone only because of the escalation.
  expect(Date.now() - started).toBeGreaterThanOrEqual(400);
  await expect
    .poll(() => spawnSync("pgrep", ["-g", String(group)]).status, {
      timeout: 3000,
    })
    .toBe(1);
}, 15_000);

test("launchers normalize, export and probe the configured base path", async () => {
  const started = await launch("start", { AUTO_CANVAS_BASE_PATH: "/canvas/" })
    .result;
  expect(started.code).toBe(0);
  expect(started.output).toContain(`http://127.0.0.1:${env.PORT}/canvas/`);
  expect(
    JSON.parse(readFileSync(join(root, "server-env.json"), "utf8"))
      .AUTO_CANVAS_BASE_PATH,
  ).toBe("/canvas");
  expect(
    (
      await launch("stop", { AUTO_CANVAS_BASE_PATH: "invalid-for-start" })
        .result
    ).code,
  ).toBe(0);
  const running = launch("dev", { AUTO_CANVAS_BASE_PATH: "/canvas/" });
  await until(() => existsSync(join(root, "vite.pid")));
  expect(
    JSON.parse(readFileSync(join(root, "server-env.json"), "utf8"))
      .AUTO_CANVAS_BASE_PATH,
  ).toBe("/canvas");
  running.child.kill("SIGINT");
  expect((await running.result).code).toBe(130);
});

test("launchers reject an unsafe base before building or starting", async () => {
  const invalid = await launch("start", {
    AUTO_CANVAS_BASE_PATH: "/canvas/../api",
  }).result;
  expect(invalid.code).toBe(1);
  expect(invalid.output).toContain("AUTO_CANVAS_BASE_PATH");
  expect(existsSync(join(root, "server.pid"))).toBe(false);
  expect(existsSync(join(root, "build.log"))).toBe(false);
});
