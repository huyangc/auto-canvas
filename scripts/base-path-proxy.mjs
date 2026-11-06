#!/usr/bin/env node
// A real built server behind a prefix-preserving stand-in for Nginx + Next.js.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { createDb } from "../apps/server/dist/db.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const db = createDb(
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test",
);
const schema = `prefix_test_${crypto.randomUUID().replaceAll("-", "")}`;
const connection = new URL(
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test",
);
connection.searchParams.set("options", `-c search_path=${schema}`);
let child;
let proxy;
let closing;
const sockets = new Set();
async function close() {
  if (closing) return closing;
  closing = (async () => {
    for (const socket of sockets) socket.destroy();
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
    console.log("Prefix proxy stopped; removed test schema.");
  })();
  return closing;
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void close());
function track(socket) {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  return socket;
}

try {
  await db.query(`CREATE SCHEMA ${schema}`);
  let log = "";
  child = spawn(process.execPath, ["apps/server/dist/cli.js"], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: connection.href,
      AUTO_CANVAS_BASE_PATH: "/canvas",
      HOST: "127.0.0.1",
      PORT: "0",
      EDITOR_ROOT: "apps/editor/dist",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const upstreamPort = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Server timeout: ${log}`)),
      30_000,
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}: ${log}`));
    });
    const output = (data) => {
      log += data;
      const match = /listening on .*:(\d+)/u.exec(log);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
  });
  proxy = createServer((request, response) => {
    const path = new URL(request.url, "http://proxy.invalid").pathname;
    if (path === "/canvas" || path.startsWith("/canvas/")) {
      const forwarded = httpRequest(
        {
          host: "127.0.0.1",
          port: upstreamPort,
          path: request.url,
          method: request.method,
          headers: request.headers,
        },
        (upstream) => {
          response.writeHead(upstream.statusCode, upstream.headers);
          upstream.pipe(response);
        },
      );
      forwarded.on("error", () => {
        response.writeHead(502);
        response.end();
      });
      request.pipe(forwarded);
    } else {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ app: "notebook", path }));
    }
  });
  proxy.on("connection", track);
  proxy.on("upgrade", (request, socket, head) => {
    if (!request.url.startsWith("/canvas/")) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = track(
      connect(upstreamPort, "127.0.0.1", () => {
        upstream.write(
          `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`,
        );
        for (let index = 0; index < request.rawHeaders.length; index += 2)
          upstream.write(
            `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`,
          );
        upstream.write("\r\n");
        upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      }),
    );
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
  });
  proxy.listen(Number(process.env.ICM_E2E_PORT ?? "4173"), "127.0.0.1");
  await once(proxy, "listening");
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  if (process.argv.includes("--check")) {
    for (const path of ["/", "/api/health", "/mcp"])
      assert.deepEqual(await (await fetch(origin + path)).json(), {
        app: "notebook",
        path,
      });
    assert.deepEqual(
      await (await fetch(origin + "/canvas/api/health")).json(),
      { ok: true },
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${upstreamPort}/api/health`)).status,
      404,
    );
    const html = await (await fetch(origin + "/canvas/")).text();
    assert.match(html, /src="\/canvas\//u);
    const manifest = await (
      await fetch(origin + "/canvas/api/agent/mcp-manifest.json")
    ).json();
    assert.equal(manifest.launch.env.ANALOG_CANVAS_API_URL, origin + "/canvas");
    // Model TLS termination without requiring a local certificate: only the
    // loopback proxy's scheme header changes the public origin.
    const secureOrigin = origin.replace("http:", "https:");
    const secureManifest = await (
      await fetch(origin + "/canvas/api/agent/mcp-manifest.json", {
        headers: { "x-forwarded-proto": "https" },
      })
    ).json();
    assert.equal(
      secureManifest.launch.env.ANALOG_CANVAS_API_URL,
      secureOrigin + "/canvas",
    );
    const secureWrite = await fetch(origin + "/canvas/api/auth/profile", {
      method: "POST",
      headers: {
        origin: secureOrigin,
        "x-forwarded-proto": "https",
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Prefix proxy user" }),
    });
    assert.equal(secureWrite.status, 200);
    const created = await fetch(origin + "/canvas/api/agent/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        projectSessionId: "p:tab",
        projectId: "p",
        documentIds: ["doc"],
        scopes: ["circuit.snapshot"],
      }),
    });
    assert.equal(created.status, 200);
    const { session } = await created.json();
    const claimed = await fetch(origin + "/canvas/api/agent/claims", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ claimCode: session.claimCode }),
    });
    assert.equal(claimed.status, 200);
    const socket = new WebSocket(
      origin.replace("http:", "ws:") +
        `/canvas/api/agent/sessions/${session.sessionId}/editor`,
      ["icm-agent-session", session.editorSecret],
    );
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("WebSocket timeout")),
        5000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error("WebSocket failed"));
        },
        { once: true },
      );
    });
    assert.equal(socket.protocol, "icm-agent-session");
    socket.close();
    console.log(
      "Prefix proxy integration passed: notebook isolation, HTTP, assets, manifest, pairing and WebSocket upgrade.",
    );
    await close();
  } else {
    console.log(`Prefix proxy ready at ${origin}/canvas/`);
  }
} catch (error) {
  console.error(error);
  await close();
  process.exitCode = 1;
}
