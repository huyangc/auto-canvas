// @vitest-environment node
// serve() replaces the global Request and Response; this annotation gives the
// file its own module registry so the replacement cannot leak elsewhere.
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { builtInSymbols } from "@icm/symbols";
import { deviceDescriptor } from "@icm/devices";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { startServer } from "./server-main.js";

const url =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const schema = `server_main_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: url });
const createDb = vi.fn(
  () =>
    new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` }),
);
let stub: Server;
let notebookApi: string;

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  stub = createServer((request, response) => {
    response.shouldKeepAlive = false;
    if (request.headers.authorization !== "Bearer alice-token") {
      response.writeHead(401);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ id: "alice", display_name: "Alice", role: "user" }),
    );
  });
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");
  notebookApi = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});
afterAll(async () => {
  stub.closeAllConnections();
  await new Promise((resolve) => stub.close(resolve));
  try {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
  }
});

const quiet = () => undefined;
const listen = { PORT: "0", HOST: "127.0.0.1" };

describe("startServer", () => {
  it.each([
    [{ AUTO_CANVAS_AUTH: "" }, "AUTO_CANVAS_AUTH"],
    [{ AUTO_CANVAS_AUTH: "Notebook" }, "AUTO_CANVAS_AUTH"],
    [{ AUTO_CANVAS_AUTH: "notebook" }, "AUTO_CANVAS_NOTEBOOK_API"],
    [{ AUTO_CANVAS_BASE_PATH: "/@notebook/canvas" }, "AUTO_CANVAS_BASE_PATH"],
  ])("rejects %j before connecting to the database", async (env, variable) => {
    const neverCalled = vi.fn(createDb);
    await expect(
      startServer({ env, argv: [], createDb: neverCalled, log: quiet }),
    ).rejects.toThrow(variable);
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("migrates and returns null for --migrate without constructing a relay", async () => {
    vi.stubEnv("AUTO_CANVAS_AGENT_IDLE_MS", "nonsense");
    try {
      expect(
        await startServer({
          env: {},
          argv: ["node", "cli.js", "--migrate"],
          createDb,
          log: quiet,
        }),
      ).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
    const applied = await admin.query(
      `SELECT name FROM ${schema}.schema_migrations ORDER BY name`,
    );
    expect(applied.rows.map((row) => row.name)).toEqual([
      "001-single-user.sql",
      "002-component-library.sql",
      "003-agent-relay.sql",
    ]);
  });

  it("serves notebook mode only under the /@notebook mount and releases its port", async () => {
    const log = vi.fn();
    const server = await startServer({
      env: {
        ...listen,
        AUTO_CANVAS_AUTH: "notebook",
        AUTO_CANVAS_NOTEBOOK_API: notebookApi,
        AUTO_CANVAS_BASE_PATH: "/canvas",
      },
      argv: [],
      createDb,
      log,
    });
    expect(server).not.toBeNull();
    const { port } = server!.address;
    expect(log).toHaveBeenCalledWith(
      `Auto Canvas server listening on 127.0.0.1:${port}`,
    );
    const origin = `http://127.0.0.1:${port}`;
    const alice = { Authorization: "Bearer alice-token" };
    try {
      const saved = await fetch(`${origin}/@notebook/canvas/api/projects`, {
        method: "POST",
        headers: { ...alice, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Mounted",
          projectText: serializeProject(createEmptyProject("mount", "Mounted")),
        }),
      });
      expect(saved.status).toBe(201);
      const listed = await (
        await fetch(`${origin}/@notebook/canvas/api/projects`, {
          headers: alice,
        })
      ).json();
      expect(listed.projects.map((p: { name: string }) => p.name)).toEqual([
        "Mounted",
      ]);

      const component = `${origin}/@notebook/canvas/api/components/mounted-part`;
      const definition = {
        symbol: {
          ...builtInSymbols.find((item) => item.id === "resistor")!,
          name: "Mounted part",
        },
        electrical: deviceDescriptor("resistor"),
      };
      expect(
        (
          await fetch(component, {
            method: "PUT",
            headers: alice,
            body: JSON.stringify({ definition, revision: 0 }),
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(component, {
            method: "PATCH",
            headers: alice,
            body: JSON.stringify({ revision: 1, action: "delete" }),
          })
        ).status,
      ).toBe(200);
      const ids = async (path: string) =>
        (
          await (await fetch(origin + path, { headers: alice })).json()
        ).entries.map((entry: { id: string }) => entry.id);
      expect(
        await ids("/@notebook/canvas/api/components?status=deleted"),
      ).toEqual(["mounted-part"]);
      expect(await ids("/@notebook/canvas/api/components")).toEqual([]);

      for (const path of ["/canvas/api/health", "/api/health", "/@notebook"])
        expect((await fetch(origin + path)).status, path).toBe(404);
      expect(
        await (await fetch(`${origin}/@notebook/canvas/api/health`)).json(),
      ).toEqual({ ok: true });

      const socket = connect(port, "127.0.0.1");
      socket.write(
        "GET /@notebook/canvas/api/agent/sessions/x/editor HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
      let reply = "";
      socket.on("data", (chunk: Buffer) => (reply += chunk.toString()));
      await once(socket, "close");
      expect(reply.startsWith("HTTP/1.1 404")).toBe(true);
    } finally {
      await server!.close();
    }
    await server!.close();
    const probe = createNetServer();
    probe.listen(port, "127.0.0.1");
    await once(probe, "listening");
    await new Promise((resolve) => probe.close(resolve));
  });

  it("starts local mode and serves health as before", async () => {
    const server = await startServer({
      env: listen,
      argv: [],
      createDb,
      log: quiet,
    });
    try {
      const response = await fetch(
        `http://127.0.0.1:${server!.address.port}/api/health`,
      );
      expect(await response.json()).toEqual({ ok: true });
      expect(
        (
          await fetch(
            `http://127.0.0.1:${server!.address.port}/@notebook/api/health`,
          )
        ).status,
      ).toBe(404);
    } finally {
      await server!.close();
    }
  });
});
