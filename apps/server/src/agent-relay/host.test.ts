import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import pg from "pg";
import { WebSocket as ClientSocket } from "ws";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../app.js";
import { migrate } from "../migrate.js";
import { AgentRelayHost } from "./host.js";
import { RelayStorage } from "./storage.js";
import { EDITOR_PROTOCOL, SESSION_STATE_KEY } from "./agent-session-runtime.js";
import {
  emptyAgentProject,
  liveAgentEditor,
} from "../../../editor/src/agent/live-agent-editor.test-support.js";

const url =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const schema = `relay_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: url });
const db = new pg.Pool({
  connectionString: url,
  options: `-c search_path=${schema}`,
});
// These tests intercept only pg's promise API; the callback overload is unused.
const sql: {
  query(text: string, values?: unknown[]): Promise<pg.QueryResult>;
} = db;
const hosts: AgentRelayHost[] = [];
const servers: Server[] = [];
const clients: ClientSocket[] = [];
function host(
  ...args: ConstructorParameters<typeof AgentRelayHost> extends [
    unknown,
    ...infer T,
  ]
    ? T
    : never
) {
  const relay = new AgentRelayHost(db, ...args);
  hosts.push(relay);
  return relay;
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(db);
});
beforeEach(async () => {
  await db.query("TRUNCATE agent_relay_storage, agent_relay_alarms");
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await Promise.all(hosts.splice(0).map((relay) => relay.close()));
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

it("round-trips structured-clone values, isolates objects and orders writes behind the cache", async () => {
  const name = randomUUID();
  const storage = new RelayStorage(db, name, () => undefined);
  await storage.load();
  const source = {
    bytes: new Uint8Array([1, 2, 255]),
    buffer: new Uint8Array([3, 4]).buffer,
    map: new Map([["a", new Date(1234)]]),
  };
  await storage.put("binary", source);
  source.bytes[0] = 9;
  const first = (await storage.get<typeof source>("binary"))!;
  expect(first.bytes).toEqual(new Uint8Array([1, 2, 255]));
  first.bytes[1] = 9;
  expect((await storage.get<typeof source>("binary"))!.bytes).toEqual(
    new Uint8Array([1, 2, 255]),
  );
  await storage.put("order", 1);
  await storage.deleteAll();
  await storage.put("binary", {
    ...source,
    bytes: new Uint8Array([1, 2, 255]),
  });
  await storage.put("order", 2);
  expect(await storage.get("order")).toBe(2);
  await storage.flush();
  const restarted = new RelayStorage(db, name, () => undefined);
  await restarted.load();
  expect(await restarted.get("binary")).toEqual({
    ...source,
    bytes: new Uint8Array([1, 2, 255]),
  });
  expect(await restarted.get("order")).toBe(2);
  const other = new RelayStorage(db, randomUUID(), () => undefined);
  await other.load();
  expect(await other.get("binary")).toBeUndefined();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("blocks new events only during blockConcurrencyWhile and gates HTTP output on persisted writes", async () => {
  const blocked = deferred();
  const wrote = deferred();
  const releaseWrite = deferred();
  const delivered: string[] = [];
  const relay = host(undefined, (state) => {
    state.blockConcurrencyWhile!(async () => {
      await blocked.promise;
    });
    return {
      async fetch(request) {
        delivered.push(new URL(request.url).pathname);
        await state.storage.put("saved", 42);
        return Response.json({ ok: true });
      },
      async alarm() {},
      async webSocketMessage() {},
      async webSocketClose() {},
    };
  });
  const query = sql.query.bind(sql);
  const interceptQuery = (...args: Parameters<typeof sql.query>) => {
    if (String(args[0]).includes("INSERT INTO agent_relay_storage")) {
      wrote.resolve();
      return releaseWrite.promise.then(() => query(...args));
    }
    return query(...args);
  };
  vi.spyOn(sql, "query").mockImplementation(interceptQuery);
  const object = relay.getByName(randomUUID());
  let returned = false;
  const response = object.fetch("http://internal/a").then(() => {
    returned = true;
  });
  await vi.waitFor(() => expect(delivered).toEqual([]));
  blocked.resolve();
  await wrote.promise;
  expect(delivered).toEqual(["/a"]);
  expect(returned).toBe(false);
  expect(await object.storage.get("saved")).toBe(42);
  releaseWrite.resolve();
  await response;
  expect(returned).toBe(true);
});

it("persists and re-arms an untouched object's alarm on a new host", async () => {
  const name = randomUUID();
  const first = host();
  const object = first.getByName(name);
  // Wait for the object's initial cache load through its public fetch.
  await object.fetch("http://internal/missing");
  await object.storage.put("survives", new Uint8Array([5, 6]));
  const alarmTime = Date.now() + 150;
  await object.storage.setAlarm(alarmTime);
  await object.storage.flush();
  expect(
    (
      await db.query(
        "SELECT scheduled_time FROM agent_relay_alarms WHERE object_name=$1",
        [name],
      )
    ).rows[0].scheduled_time,
  ).toBe(String(alarmTime));
  await first.close();
  const fired = deferred();
  let calls = 0;
  const second = host(undefined, (state) => ({
    async fetch() {
      return new Response();
    },
    async alarm() {
      if (++calls === 1) {
        // Re-scheduling the same time is a new alarm, not the old delivery.
        await state.storage.setAlarm!(alarmTime);
        return;
      }
      expect(await state.storage.get("survives")).toEqual(
        new Uint8Array([5, 6]),
      );
      await state.storage.put("fired", true);
      fired.resolve();
    },
    async webSocketMessage() {},
    async webSocketClose() {},
  }));
  await second.start();
  await fired.promise;
  expect(calls).toBe(2);
  await vi.waitFor(async () =>
    expect(
      (
        await db.query(
          "SELECT * FROM agent_relay_alarms WHERE object_name=$1",
          [name],
        )
      ).rows,
    ).toEqual([]),
  );
  expect(await second.getByName(name).storage.get("fired")).toBe(true);
});

async function listening(relay: AgentRelayHost) {
  const app = createApp({ db, agentRelay: relay });
  const server = serve({
    fetch: app.fetch,
    // Do not replace global Request/Response in Vitest's shared registry.
    overrideGlobalObjects: false,
    port: 0,
    hostname: "127.0.0.1",
  }) as Server;
  servers.push(server);
  relay.attach(server);
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing server port");
  const origin = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, token?: string) =>
    fetch(origin + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  return { origin, post };
}

async function paired(relay: AgentRelayHost) {
  const server = await listening(relay);
  const created = await server.post("/api/agent/sessions", {
    projectSessionId: "p:tab",
    projectId: "p",
    documentIds: ["doc"],
    scopes: ["circuit.snapshot"],
  });
  expect(created.status).toBe(200);
  const { session } = await created.json();
  const claimed = await server.post("/api/agent/claims", {
    claimCode: session.claimCode,
  });
  expect(claimed.status).toBe(200);
  const claim = await claimed.json();
  const client = new ClientSocket(
    server.origin.replace("http:", "ws:") +
      `/api/agent/sessions/${session.sessionId}/editor`,
    [EDITOR_PROTOCOL, session.editorSecret],
    { origin: server.origin },
  );
  clients.push(client);
  await once(client, "open");
  expect(client.protocol).toBe(EDITOR_PROTOCOL);
  return { ...server, session, claim, client };
}

it("pairs through app + real ws and resolves a fetch awaiting its editor reply without timeout", async () => {
  const relay = host();
  const { post, session, claim, client } = await paired(relay);
  const project = emptyAgentProject();
  project.id = "p";
  project.documents[0]!.id = "doc";
  project.topDocumentId = "doc";
  const editor = liveAgentEditor({ project });
  const forwarded: string[] = [];
  client.on("message", (data) => {
    const envelope = JSON.parse(String(data));
    if (envelope.kind !== "circuit-request") return;
    forwarded.push(envelope.requestId);
    void Promise.resolve(editor.service.handle(envelope.payload)).then(
      (payload) =>
        client.send(
          JSON.stringify({ ...envelope, kind: "circuit-response", payload }),
        ),
    );
  });
  const response = await post(
    `/api/agent/sessions/${session.sessionId}/circuit`,
    {
      apiVersion: "3.0",
      requestId: "wait-graph",
      operation: "snapshot",
      documentId: "doc",
    },
    claim.agentToken,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true });
  expect(forwarded).toEqual(["wait-graph"]);
  expect(
    await relay.getByName(session.sessionId).storage.get(SESSION_STATE_KEY),
  ).toBeDefined();
  const closed = once(client, "close");
  client.close();
  await closed;
  await vi.waitFor(() =>
    expect(relay.getByName(session.sessionId).getWebSockets()).toEqual([]),
  );
}, 5000);

it("restores a paired session after restart, reports offline and accepts a reconnected editor", async () => {
  const first = host();
  const { session, claim } = await paired(first);
  await first.close();
  const second = host();
  await second.start();
  const { origin, post } = await listening(second);
  const response = await post(
    `/api/agent/sessions/${session.sessionId}/circuit`,
    {
      apiVersion: "3.0",
      requestId: "offline",
      operation: "snapshot",
      documentId: "doc",
    },
    claim.agentToken,
  );
  expect(await response.json()).toMatchObject({
    error: { code: "EDITOR_OFFLINE" },
  });
  const client = new ClientSocket(
    origin.replace("http:", "ws:") +
      `/api/agent/sessions/${session.sessionId}/editor`,
    [EDITOR_PROTOCOL, session.editorSecret],
    { origin },
  );
  clients.push(client);
  await once(client, "open");
  expect(client.readyState).toBe(ClientSocket.OPEN);
});

it("keeps origin and bearer checks and rejects retired simulation routes", async () => {
  const relay = host();
  const { origin, post, session, claim } = await paired(relay);
  const denied = await fetch(origin + "/api/agent/sessions", {
    method: "POST",
    headers: { origin: "http://other" },
    body: "{}",
  });
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({
    error: { code: "UNAUTHORIZED_ORIGIN" },
  });
  const path = `/api/agent/sessions/${session.sessionId}`;
  expect((await fetch(origin + path + "/status")).status).toBe(401);
  for (const resource of ["simulation", "artifact-status", "artifacts/file"]) {
    expect(
      (
        await fetch(origin + path + "/" + resource, {
          headers: { authorization: `Bearer ${claim.agentToken}` },
        })
      ).status,
    ).toBe(404);
    expect(
      (await post(path + "/" + resource, {}, claim.agentToken)).status,
    ).toBe(404);
  }
});

it("does not release a successful HTTP response when persistence fails", async () => {
  const relay = host(undefined, (state) => ({
    async fetch() {
      await state.storage.put("key", "unpersisted");
      return Response.json({ ok: true });
    },
    async alarm() {},
    async webSocketMessage() {},
    async webSocketClose() {},
  }));
  const object = relay.getByName(randomUUID());
  const query = sql.query.bind(sql);
  const interceptQuery = (...args: Parameters<typeof sql.query>) => {
    if (String(args[0]).includes("INSERT INTO agent_relay_storage"))
      return Promise.reject(new Error("Disk unavailable"));
    return query(...args);
  };
  vi.spyOn(sql, "query").mockImplementation(interceptQuery);
  await expect(object.fetch("http://internal/write")).rejects.toThrow(
    "Disk unavailable",
  );
  await expect(relay.close()).rejects.toThrow("Disk unavailable");
});

it("holds WebSocket messages behind the write output gate", async () => {
  const wrote = deferred();
  const release = deferred();
  const relay = host(undefined, (state) => ({
    async fetch() {
      const opened = await state.openWebSocket!();
      if (!opened) return new Response(null, { status: 426 });
      state.acceptWebSocket!(opened.socket, ["editor"]);
      return opened.response;
    },
    async webSocketMessage(socket) {
      await state.storage.put("message", "saved");
      socket.send("persisted");
    },
    async alarm() {},
    async webSocketClose() {},
  }));
  const { origin } = await listening(relay);
  const client = new ClientSocket(
    origin.replace("http:", "ws:") +
      `/api/agent/sessions/${randomUUID()}/editor`,
    [EDITOR_PROTOCOL, "secret"],
    { origin },
  );
  clients.push(client);
  await once(client, "open");
  const received: string[] = [];
  client.on("message", (data) => received.push(String(data)));
  const query = sql.query.bind(sql);
  const interceptQuery = (...args: Parameters<typeof sql.query>) => {
    if (String(args[0]).includes("INSERT INTO agent_relay_storage")) {
      wrote.resolve();
      return release.promise.then(() => query(...args));
    }
    return query(...args);
  };
  vi.spyOn(sql, "query").mockImplementation(interceptQuery);
  client.send("save");
  await wrote.promise;
  expect(received).toEqual([]);
  const message = once(client, "message");
  release.resolve();
  await message;
  expect(received).toEqual(["persisted"]);
});

it("admits simultaneous requests for one object without forwarding an identical pending request twice", async () => {
  const relay = host();
  const { post, session, claim, client } = await paired(relay);
  const project = emptyAgentProject();
  project.id = "p";
  project.documents[0]!.id = "doc";
  project.topDocumentId = "doc";
  const editor = liveAgentEditor({ project });
  const forwarded = deferred();
  const seen: string[] = [];
  let reply!: () => void;
  client.on("message", (data) => {
    const envelope = JSON.parse(String(data));
    if (envelope.kind !== "circuit-request") return;
    seen.push(envelope.requestId);
    reply = () =>
      client.send(
        JSON.stringify({
          ...envelope,
          kind: "circuit-response",
          payload: editor.service.handle(envelope.payload),
        }),
      );
    forwarded.resolve();
  });
  const path = `/api/agent/sessions/${session.sessionId}/circuit`;
  const body = {
    apiVersion: "3.0",
    requestId: "simultaneous",
    operation: "snapshot",
    documentId: "doc",
  };
  const first = post(path, body, claim.agentToken);
  await forwarded.promise;
  const second = await post(path, body, claim.agentToken);
  expect(second.status).toBe(409);
  expect(await second.json()).toMatchObject({
    error: { code: "REQUEST_IN_PROGRESS" },
  });
  // Both exact and changed reuse must be delivered while the original HTTP
  // call awaits the editor, and must preserve the request ledger boundary.
  const conflict = await post(
    path,
    { ...body, includeSourceSpans: false },
    claim.agentToken,
  );
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({
    error: { code: "REQUEST_ID_REUSED" },
  });
  reply();
  const response = await first;
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true });
  expect(seen).toEqual(["simultaneous"]);
}, 5000);
