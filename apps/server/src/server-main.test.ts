// @vitest-environment node
// serve() replaces the global Request and Response; this annotation gives the
// file its own module registry so the replacement cannot leak elsewhere.
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, request as httpRequest, type Server } from "node:http";
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

  it("releases the database pool when the port is taken", async () => {
    const blocker = createNetServer();
    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");
    const { port } = blocker.address() as AddressInfo;
    const pools: pg.Pool[] = [];
    const tracked = () => {
      const pool = createDb();
      pools.push(pool);
      return pool;
    };
    try {
      await expect(
        startServer({
          env: { PORT: String(port), HOST: "127.0.0.1" },
          argv: [],
          createDb: tracked,
          log: quiet,
        }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
      expect(pools).toHaveLength(1);
      expect(pools[0]!.ended).toBe(true);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it("releases the relay and the pool when the editor root is missing", async () => {
    const pools: pg.Pool[] = [];
    const tracked = () => {
      const pool = createDb();
      pools.push(pool);
      return pool;
    };
    await expect(
      startServer({
        env: { ...listen, EDITOR_ROOT: `/nonexistent-${randomUUID()}` },
        argv: [],
        createDb: tracked,
        log: quiet,
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(pools).toHaveLength(1);
    expect(pools[0]!.ended).toBe(true);
  });

  it("releases the pool when the migration fails", async () => {
    const pools: pg.Pool[] = [];
    const failing = () => {
      const pool = createDb();
      vi.spyOn(pool, "connect").mockRejectedValue(new Error("connect refused"));
      pools.push(pool);
      return pool;
    };
    await expect(
      startServer({ env: listen, argv: [], createDb: failing, log: quiet }),
    ).rejects.toThrow("connect refused");
    expect(pools).toHaveLength(1);
    expect(pools[0]!.ended).toBe(true);
  });

  it("survives upgrade requests whose peer resets at once in notebook mode", async () => {
    const server = await startServer({
      env: {
        ...listen,
        AUTO_CANVAS_AUTH: "notebook",
        AUTO_CANVAS_NOTEBOOK_API: notebookApi,
      },
      argv: [],
      createDb,
      log: quiet,
    });
    const { port } = server!.address;
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        const socket = connect(port, "127.0.0.1");
        socket.on("error", () => undefined);
        await once(socket, "connect");
        socket.write(
          "GET /@notebook/api/agent/sessions/x/editor HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
        );
        // An RST rather than a FIN: the reply is written to a reset peer.
        socket.resetAndDestroy();
      }
      const health = await fetch(
        `http://127.0.0.1:${port}/@notebook/api/health`,
      );
      expect(await health.json()).toEqual({ ok: true });
    } finally {
      await server!.close();
    }
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
      "004-standalone-accounts.sql",
      "005-account-agent-pairings.sql",
      "006-account-administration.sql",
      "007-group-shared-libraries.sql",
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
      // The slashless base redirects to the address the browser knows. The
      // mount is private between notebook's proxy and this server, so it must
      // not appear in a Location header (notebook's own rule forwards the bare
      // entry with its slash, so this request only arrives by hand).
      const bare = await fetch(`${origin}/@notebook/canvas?x=1`, {
        redirect: "manual",
      });
      expect(bare.status).toBe(308);
      expect(bare.headers.get("location")).toBe("/canvas/?x=1");

      // A method Fetch cannot construct still gets the API's 404, not a 500.
      const traced = await new Promise<{
        status: number;
        cache: string | undefined;
        body: string;
      }>((resolve, reject) => {
        const trace = httpRequest(
          {
            host: "127.0.0.1",
            port,
            path: "/@notebook/canvas/api/projects",
            method: "TRACE",
          },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => (body += chunk));
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                cache: response.headers["cache-control"],
                body,
              }),
            );
          },
        );
        trace.on("error", reject);
        trace.end();
      });
      expect(traced).toEqual({
        status: 404,
        cache: "private, no-store",
        body: JSON.stringify({ error: "Not found" }),
      });

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

  it("closes although a refused upgrade's peer keeps its side open", async () => {
    const server = await startServer({
      env: {
        ...listen,
        AUTO_CANVAS_AUTH: "notebook",
        AUTO_CANVAS_NOTEBOOK_API: notebookApi,
      },
      argv: [],
      createDb,
      log: quiet,
    });
    const socket = connect({
      port: server!.address.port,
      host: "127.0.0.1",
      allowHalfOpen: true,
    });
    socket.on("error", () => undefined);
    socket.write(
      "GET /@notebook/api/agent/sessions/x/editor HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    // The peer reads the reply but never ends its own side.
    socket.resume();
    await once(socket, "end");
    const closed = await Promise.race([
      server!.close().then(() => "closed"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 3000)),
    ]);
    socket.destroy();
    expect(closed).toBe("closed");
  });

  describe("--grant-admin", () => {
    const account = async (username: string) =>
      (
        await admin.query(
          `SELECT role, disabled FROM ${schema}.standalone_accounts WHERE username=$1`,
          [username],
        )
      ).rows[0];

    it("makes a registered account an enabled administrator, idempotently", async () => {
      const server = await startServer({
        env: listen,
        argv: [],
        createDb,
        log: quiet,
      });
      try {
        for (const username of ["G12345678", "h12345678"]) {
          const registered = await fetch(
            `http://127.0.0.1:${server!.address.port}/api/auth/register`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ username, password: "passphrase" }),
            },
          );
          expect(registered.status).toBe(201);
        }
      } finally {
        await server!.close();
      }
      expect(await account("g12345678")).toEqual({
        role: "user",
        disabled: false,
      });
      await admin.query(
        `UPDATE ${schema}.standalone_accounts SET disabled=true WHERE username='g12345678'`,
      );
      for (let run = 0; run < 2; run++) {
        const pools: pg.Pool[] = [];
        const log = vi.fn();
        expect(
          await startServer({
            env: {},
            argv: ["node", "cli.js", "--grant-admin", "G12345678"],
            createDb: () => {
              const pool = createDb();
              pools.push(pool);
              return pool;
            },
            log,
          }),
        ).toBeNull();
        expect(pools).toHaveLength(1);
        expect(pools[0]!.ended).toBe(true);
        expect(log).toHaveBeenCalledWith(
          "Granted the administrator role to g12345678",
        );
        expect(await account("g12345678")).toEqual({
          role: "admin",
          disabled: false,
        });
      }
      expect(await account("h12345678")).toEqual({
        role: "user",
        disabled: false,
      });
    });

    it("refuses an unknown username without naming any account", async () => {
      const pools: pg.Pool[] = [];
      const failure = await startServer({
        env: {},
        argv: ["node", "cli.js", "--grant-admin", "z99999999"],
        createDb: () => {
          const pool = createDb();
          pools.push(pool);
          return pool;
        },
        log: quiet,
      }).catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe(
        "--grant-admin: no account has that username",
      );
      expect(pools[0]!.ended).toBe(true);
    });

    it.each([
      [{}, ["--grant-admin"], "needs one username"],
      [{}, ["--grant-admin", "--migrate"], "exclude each other"],
      [{}, ["--grant-admin", "not-a-name"], "needs one username"],
      [{}, ["--grant-admin", "a1234567"], "needs one username"],
      [
        {},
        ["--grant-admin", "a12345678", "--grant-admin", "b12345678"],
        "needs one username",
      ],
      [
        {},
        ["--grant-admin", "a12345678", "--migrate"],
        "--grant-admin and --migrate exclude each other",
      ],
      [
        {},
        ["--grant-admin", "a12345678", "--require-canvas-database"],
        "--grant-admin and --require-canvas-database exclude each other",
      ],
      [
        {},
        ["--init-empty-database", "--grant-admin", "a12345678"],
        "--grant-admin and --init-empty-database exclude each other",
      ],
      [
        { AUTO_CANVAS_AUTH: "local" },
        ["--grant-admin", "a12345678"],
        "--grant-admin requires AUTO_CANVAS_AUTH=accounts",
      ],
      [
        {
          AUTO_CANVAS_AUTH: "notebook",
          AUTO_CANVAS_NOTEBOOK_API: "http://127.0.0.1:9",
        },
        ["--grant-admin", "a12345678"],
        "--grant-admin requires AUTO_CANVAS_AUTH=accounts",
      ],
    ])(
      "refuses %j %j before connecting to the database",
      async (env, flags, message) => {
        const neverCalled = vi.fn(() => createDb());
        await expect(
          startServer({
            env,
            argv: ["node", "cli.js", ...flags],
            createDb: neverCalled,
            log: quiet,
          }),
        ).rejects.toThrow(message);
        expect(neverCalled).not.toHaveBeenCalled();
      },
    );
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
