#!/usr/bin/env node
// Build-backed check of the server's two identity modes: spawns the built
// apps/server/dist/cli.js on isolated schemas and a stub silicon-notebook.
// Run after `pnpm build`. Exits non-zero on the first failed assertion.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../apps/server/dist/db.js";
import { deviceDescriptor } from "../packages/devices/dist/index.js";
import { createEmptyProject } from "../packages/model/dist/index.js";
import { serializeProject } from "../packages/project-protocol/dist/index.js";
import { builtInSymbols } from "../packages/symbols/dist/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const databaseUrl =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const admin = createDb(databaseUrl);
const schemas = [];
const children = new Set();
const serverOutput = [];
const aliceToken = `alice-${randomUUID()}`;
const unknownToken = `unknown-${randomUUID()}`;
let stubLookups = 0;
// Variables the check sets itself; inherited values must not leak in.
const OWN_VARIABLES = [
  "AUTO_CANVAS_AUTH",
  "AUTO_CANVAS_NOTEBOOK_API",
  "AUTO_CANVAS_BASE_PATH",
  "AUTO_CANVAS_USER_NAME",
  "AUTO_CANVAS_AGENT_IDLE_MS",
  "AUTO_CANVAS_PROJECT_LIMIT",
  "AGENT_ALLOWED_ORIGIN",
  "EDITOR_ROOT",
  "DATABASE_URL",
  "PORT",
  "HOST",
];

async function createSchema() {
  const schema = `mode_check_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  schemas.push(schema);
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.href;
}

function childEnv(env, unset = []) {
  const result = { ...process.env };
  for (const name of [...OWN_VARIABLES, ...unset]) delete result[name];
  return { ...result, HOST: "127.0.0.1", PORT: "0", ...env };
}

function spawnServer(env, unset) {
  const child = spawn(process.execPath, ["apps/server/dist/cli.js"], {
    cwd: root,
    env: childEnv(env, unset),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  const output = { stdout: "", stderr: "" };
  child.stdout.on("data", (data) => {
    output.stdout += data;
    serverOutput.push(String(data));
  });
  child.stderr.on("data", (data) => {
    output.stderr += data;
    serverOutput.push(String(data));
  });
  return { child, output };
}

/** Starts a server and resolves with its port and a stop function. */
async function startServer(env, unset) {
  const { child, output } = spawnServer(env, unset);
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Server start timed out")),
      30_000,
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code} before listening`));
    });
    child.stdout.on("data", () => {
      const match = /listening on .*:(\d+)/u.exec(output.stdout);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    stop: () => stopChild(child),
  };
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await exited;
  clearTimeout(timer);
}

/** Runs a server that must refuse to start; resolves with its exit and stderr. */
async function expectStartupFailure(env) {
  const { child, output } = spawnServer(env);
  const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
  const [code] = await once(child, "exit");
  clearTimeout(timer);
  return { code, stderr: output.stderr, stdout: output.stdout };
}

async function closedPort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function snapshot(response) {
  return {
    status: response.status,
    body: await response.text(),
    cache: response.headers.get("cache-control"),
    cookie: response.headers.get("set-cookie"),
  };
}

const projectText = (name) =>
  serializeProject(createEmptyProject("mode-check", name));
const definition = (name) => ({
  symbol: { ...builtInSymbols.find((item) => item.id === "resistor"), name },
  electrical: deviceDescriptor("resistor"),
});

// Today's standalone answers, written out rather than computed.
const LOCAL_USER = {
  id: "local",
  displayName: "Local user",
  email: null,
  provider: "local",
  role: "user",
  isAdmin: true,
};
const LOCAL_EXPECTATIONS = [
  [
    "GET",
    "/api/auth/me",
    undefined,
    { status: 200, body: { user: LOCAL_USER }, cache: "no-store" },
  ],
  [
    "GET",
    "/api/auth/providers",
    undefined,
    {
      status: 200,
      body: { github: false, google: false, email: false },
      cache: null,
    },
  ],
  [
    "POST",
    "/api/auth/profile",
    {},
    { status: 400, body: { error: "invalid-display-name" }, cache: null },
  ],
  [
    "POST",
    "/api/auth/logout",
    undefined,
    { status: 200, body: { ok: true }, cache: null },
  ],
  [
    "GET",
    "/api/integration/ready.json",
    undefined,
    { status: 404, body: { error: "Not found" }, cache: null },
  ],
];

async function checkLocalContract() {
  for (const auth of ["accounts", "local"]) {
    const server = await startServer({
      DATABASE_URL: await createSchema(),
      ...(auth === "accounts" ? {} : { AUTO_CANVAS_AUTH: auth }),
    });
    try {
      if (auth === "accounts") {
        assert.equal(
          (await fetch(server.origin + "/api/projects")).status,
          401,
        );
        continue;
      }
      for (const headers of [{}, { Authorization: "Bearer x" }])
        for (const [method, path, body, expected] of LOCAL_EXPECTATIONS) {
          const actual = await snapshot(
            await fetch(server.origin + path, {
              method,
              headers,
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            }),
          );
          const label = `${auth ?? "unset"} ${method} ${path} ${JSON.stringify(headers)}`;
          assert.equal(actual.status, expected.status, label);
          assert.deepEqual(JSON.parse(actual.body), expected.body, label);
          assert.equal(actual.cache, expected.cache, label);
          assert.equal(actual.cookie, null, label);
        }
    } finally {
      await server.stop();
    }
  }
  console.log(
    "ok local mode: default account gate and explicit local identity",
  );
}

async function checkRestart(databaseUrlForSchema) {
  let projectId;
  const state = async (origin) => {
    const versions = await (
      await fetch(`${origin}/api/projects/${projectId}/versions`)
    ).json();
    assert.equal(versions.versions.length, 1);
    return {
      me: await (await fetch(`${origin}/api/auth/me`)).json(),
      component: await (
        await fetch(`${origin}/api/components/seeded-component`)
      ).json(),
      project: (
        await (await fetch(`${origin}/api/projects/${projectId}`)).json()
      ).project.projectText,
      version: (
        await (
          await fetch(
            `${origin}/api/projects/${projectId}/versions/${versions.versions[0].versionId}/project`,
          )
        ).json()
      ).projectText,
    };
  };
  const first = await startServer({
    DATABASE_URL: databaseUrlForSchema,
    AUTO_CANVAS_AUTH: "local",
  });
  let before;
  try {
    const json = { "content-type": "application/json" };
    const renamed = await fetch(`${first.origin}/api/auth/profile`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ displayName: "Seeded owner" }),
    });
    assert.equal(renamed.status, 200);
    const created = await fetch(`${first.origin}/api/projects`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        name: "Seeded secret project",
        projectText: projectText("Seeded secret project"),
      }),
    });
    assert.equal(created.status, 201);
    projectId = (await created.json()).project.id;
    const updated = await fetch(`${first.origin}/api/projects/${projectId}`, {
      method: "PUT",
      headers: { ...json, "If-Match": "revision-1" },
      body: JSON.stringify({
        name: "Seeded secret project",
        projectText: projectText("Seeded secret project v2"),
      }),
    });
    assert.equal(updated.status, 200);
    const published = await fetch(
      `${first.origin}/api/components/seeded-component`,
      {
        method: "PUT",
        body: JSON.stringify({
          definition: definition("Seeded component"),
          revision: 0,
        }),
      },
    );
    assert.equal(published.status, 200);
    before = await state(first.origin);
  } finally {
    await first.stop();
  }
  const second = await startServer({
    DATABASE_URL: databaseUrlForSchema,
    AUTO_CANVAS_AUTH: "local",
  });
  try {
    const after = await state(second.origin);
    assert.deepEqual(after, before);
    assert.equal(after.me.user.displayName, "Seeded owner");
    assert.equal(after.project, projectText("Seeded secret project v2"));
    assert.equal(after.version, projectText("Seeded secret project"));
    assert.equal(after.component.entry.id, "seeded-component");
  } finally {
    await second.stop();
  }
  console.log("ok restart: profile, component, project and version survive");
  return projectId;
}

async function checkConfigurationErrors() {
  const unreachable = `postgresql://127.0.0.1:${await closedPort()}/mode_check`;
  for (const [env, variable] of [
    [{ AUTO_CANVAS_AUTH: "" }, "AUTO_CANVAS_AUTH"],
    [{ AUTO_CANVAS_AUTH: "Notebook" }, "AUTO_CANVAS_AUTH"],
    [{ AUTO_CANVAS_AUTH: "notebook" }, "AUTO_CANVAS_NOTEBOOK_API"],
  ]) {
    const { code, stderr, stdout } = await expectStartupFailure({
      ...env,
      DATABASE_URL: unreachable,
    });
    const label = JSON.stringify(env);
    assert.notEqual(code, 0, label);
    assert.match(stderr, new RegExp(variable, "u"), label);
    assert.doesNotMatch(stderr + stdout, /ECONNREFUSED|connect/u, label);
    assert.doesNotMatch(stdout, /listening/u, label);
  }
  console.log("ok configuration errors: refused before any connection");
}

async function editorFixture() {
  const directory = await mkdtemp(join(tmpdir(), "mode-check-editor-"));
  await mkdir(join(directory, "assets"));
  const index = "<!doctype html><title>fixture</title>\n";
  const script = "console.log('fixture asset');\n";
  await writeFile(join(directory, "index.html"), index);
  await writeFile(join(directory, "assets", "a.js"), script);
  return { directory, index, script };
}

async function notebookStub() {
  const stub = createServer((request, response) => {
    response.shouldKeepAlive = false;
    if (request.url !== "/api/me") {
      response.writeHead(404);
      response.end();
      return;
    }
    stubLookups++;
    if (request.headers.authorization !== `Bearer ${aliceToken}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"detail":"Not authenticated"}');
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "alice",
        email: "alice@example.test",
        display_name: "Alice",
        role: "user",
        username: "alice",
      }),
    );
  });
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");
  return stub;
}

async function rawUpgrade(port, path) {
  const socket = connect(port, "127.0.0.1");
  await once(socket, "connect");
  socket.write(
    `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
  );
  let reply = "";
  socket.on("data", (chunk) => (reply += chunk));
  const timer = setTimeout(() => socket.destroy(), 5000);
  await once(socket, "close");
  clearTimeout(timer);
  return reply;
}

async function checkNotebookMode(fixture, stub) {
  const server = await startServer({
    DATABASE_URL: await createSchema(),
    AUTO_CANVAS_AUTH: "notebook",
    AUTO_CANVAS_NOTEBOOK_API: `http://127.0.0.1:${stub.address().port}`,
    AUTO_CANVAS_BASE_PATH: "/canvas",
    AUTO_CANVAS_AGENT_IDLE_MS: "nonsense",
    EDITOR_ROOT: fixture.directory,
    // Node prints connection options and HTTP events under these settings;
    // the final check that no token value was logged must hold then too.
    NODE_DEBUG: "net,http,https",
  });
  try {
    const get = (path, headers = {}) =>
      fetch(server.origin + path, { headers });
    for (const path of [
      "/canvas/",
      "/canvas/assets/a.js",
      "/canvas/api/health",
    ])
      assert.equal((await get(path)).status, 404, path);
    assert.equal(await (await get("/@notebook/canvas/")).text(), fixture.index);
    assert.deepEqual(
      Buffer.from(
        await (await get("/@notebook/canvas/assets/a.js")).arrayBuffer(),
      ),
      Buffer.from(fixture.script),
    );
    assert.deepEqual(await (await get("/@notebook/canvas/api/health")).json(), {
      ok: true,
    });
    const ready = await get("/@notebook/canvas/api/integration/ready.json");
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ok: true, mode: "notebook" });
    assert.equal(
      (
        await get("/@notebook/canvas/api/projects", {
          Authorization: `Bearer ${unknownToken}`,
        })
      ).status,
      401,
    );
    const alice = { Authorization: `Bearer ${aliceToken}` };
    const saved = await fetch(
      `${server.origin}/@notebook/canvas/api/projects`,
      {
        method: "POST",
        headers: { ...alice, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Notebook project",
          projectText: projectText("Notebook project"),
        }),
      },
    );
    assert.equal(saved.status, 201);
    const listed = await (
      await get("/@notebook/canvas/api/projects", alice)
    ).json();
    assert.deepEqual(
      listed.projects.map((project) => project.name),
      ["Notebook project"],
    );
    const reply = await rawUpgrade(
      server.port,
      "/@notebook/canvas/api/agent/sessions/x/editor",
    );
    assert.ok(reply.startsWith("HTTP/1.1 404"), reply.slice(0, 40));
  } finally {
    await server.stop();
  }
  console.log(
    "ok notebook mode: only /@notebook serves; readiness, save and upgrade refusal; relay never built",
  );
}

/** Every proxy setting Node can honour, pointed at `proxy`, with no exemption. */
function proxyEnv(proxy) {
  const env = { NODE_USE_ENV_PROXY: "1" };
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) {
    env[name] = proxy;
    env[name.toLowerCase()] = proxy;
  }
  return env;
}

async function checkProxyBypass(stub) {
  let trapped = 0;
  const trap = createNetServer((socket) => {
    trapped++;
    socket.destroy();
  });
  trap.listen(0, "127.0.0.1");
  await once(trap, "listening");
  const proxy = proxyEnv(`http://127.0.0.1:${trap.address().port}`);
  const exempt = ["NO_PROXY", "no_proxy"];
  const notebookApi = `http://127.0.0.1:${stub.address().port}`;
  try {
    // Control: in the same environment the global fetch does go to the trap,
    // so a zero count below means the server bypassed the proxy.
    const control = spawn(
      process.execPath,
      [
        "-e",
        `fetch(${JSON.stringify(`${notebookApi}/api/me`)}).then(() => {}, () => {})`,
      ],
      { cwd: root, env: childEnv(proxy, exempt), stdio: "ignore" },
    );
    const timer = setTimeout(() => control.kill("SIGKILL"), 30_000);
    await once(control, "exit");
    clearTimeout(timer);
    const controlTrapped = trapped;
    trapped = 0;

    const lookupsBefore = stubLookups;
    const env = {
      DATABASE_URL: await createSchema(),
      AUTO_CANVAS_AUTH: "notebook",
      AUTO_CANVAS_NOTEBOOK_API: notebookApi,
      ...proxy,
    };
    const server = await startServer(env, exempt);
    try {
      const listed = await fetch(`${server.origin}/@notebook/api/projects`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });
      assert.equal(listed.status, 200);
      assert.deepEqual((await listed.json()).projects, []);
    } finally {
      await server.stop();
    }
    assert.equal(stubLookups - lookupsBefore, 1, "stub lookups");
    assert.equal(trapped, 0, "server connections to the proxy");
    if (controlTrapped === 0)
      console.log(
        "NOT PROVEN proxy: the global fetch ignored the environment proxy on this Node, so the bypass was not exercised",
      );
    else
      console.log(
        "ok proxy: identity lookup goes direct with NODE_USE_ENV_PROXY and *_PROXY set (control fetch reached the trap)",
      );
  } finally {
    await new Promise((resolve) => trap.close(resolve));
  }
}

async function checkLocalMountRefusal(
  databaseUrlForSchema,
  projectId,
  fixture,
) {
  for (const basePath of ["", "/canvas"])
    for (const editorRoot of [undefined, fixture.directory]) {
      const server = await startServer({
        DATABASE_URL: databaseUrlForSchema,
        AUTO_CANVAS_AUTH: "local",
        ...(basePath ? { AUTO_CANVAS_BASE_PATH: basePath } : {}),
        ...(editorRoot ? { EDITOR_ROOT: editorRoot } : {}),
      });
      const label = `base ${JSON.stringify(basePath)} editor ${Boolean(editorRoot)}`;
      try {
        // Both the mount in front of this server's own base path (what a
        // wrongly enabled mount stripping would expose) and in front of
        // /canvas (what notebook's rewrite sends).
        for (const path of new Set([
          `/@notebook${basePath}/api/projects`,
          `/@notebook${basePath}/api/auth/me`,
          "/@notebook/canvas/api/projects",
          "/@notebook/canvas/api/auth/me",
        ])) {
          const text = await (await fetch(server.origin + path)).text();
          assert.ok(!text.includes(projectId), `${label} ${path} project id`);
          assert.ok(
            !text.includes("Seeded secret project"),
            `${label} ${path} project name`,
          );
          assert.ok(!text.includes('"id":"local"'), `${label} ${path} user`);
          assert.ok(!text.includes("Seeded owner"), `${label} ${path} user`);
        }
        assert.equal(
          (
            await fetch(
              `${server.origin}/@notebook/canvas/api/integration/ready.json`,
            )
          ).status,
          404,
          label,
        );
        // The seeded data is really there, so the refusals above mean something.
        const own = await (
          await fetch(`${server.origin}${basePath}/api/projects`)
        ).text();
        assert.ok(own.includes(projectId), `${label} own list`);
      } finally {
        await server.stop();
      }
    }
  const refused = await expectStartupFailure({
    DATABASE_URL: databaseUrlForSchema,
    AUTO_CANVAS_BASE_PATH: "/@notebook/canvas",
  });
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /AUTO_CANVAS_BASE_PATH/u);
  console.log(
    "ok local mode: /@notebook paths expose nothing; /@notebook base path refused",
  );
}

let fixture;
let stub;
try {
  await readFile(join(root, "apps/server/dist/cli.js"));
  await checkLocalContract();
  const seeded = await createSchema();
  const projectId = await checkRestart(seeded);
  await checkConfigurationErrors();
  fixture = await editorFixture();
  stub = await notebookStub();
  await checkNotebookMode(fixture, stub);
  await checkProxyBypass(stub);
  await checkLocalMountRefusal(seeded, projectId, fixture);
  const output = serverOutput.join("");
  for (const token of [aliceToken, unknownToken])
    assert.ok(!output.includes(token), "server output contains a token");
  console.log("ok server output: no bearer token value logged");
} catch (error) {
  process.exitCode = 1;
  console.error(error);
} finally {
  for (const child of children) await stopChild(child);
  if (stub) {
    stub.closeAllConnections();
    await new Promise((resolve) => stub.close(resolve));
  }
  if (fixture) await rm(fixture.directory, { recursive: true, force: true });
  for (const schema of schemas)
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
