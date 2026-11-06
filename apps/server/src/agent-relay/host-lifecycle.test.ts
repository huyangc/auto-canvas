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
import { EDITOR_PROTOCOL } from "./agent-session-runtime.js";

const url =
  process.env.AUTO_CANVAS_TEST_DATABASE_URL ?? "postgresql:///auto_canvas_test";
const schema = `relay_lifecycle_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: url });
const db = new pg.Pool({
  connectionString: url,
  options: `-c search_path=${schema}`,
});
const hosts: AgentRelayHost[] = [];
const servers: Server[] = [];
const clients: ClientSocket[] = [];

function host(factory?: ConstructorParameters<typeof AgentRelayHost>[2]) {
  const relay = new AgentRelayHost(db, undefined, factory);
  hosts.push(relay);
  return relay;
}

// Registry retention is the resource contract under test; no production API
// needs to expose the host's implementation detail for diagnostics.
function registry(relay: AgentRelayHost) {
  return (relay as unknown as { objects: Map<string, unknown> }).objects;
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
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

async function listening(relay: AgentRelayHost) {
  const app = createApp({ db, agentRelay: relay });
  const server = serve({
    fetch: app.fetch,
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
  return { origin, server };
}

async function paired(origin: string) {
  const created = await fetch(origin + "/api/agent/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectSessionId: "p:tab",
      projectId: "p",
      documentIds: ["doc"],
      scopes: ["circuit.snapshot"],
    }),
  });
  expect(created.status).toBe(200);
  const { session } = await created.json();
  const claimed = await fetch(origin + "/api/agent/claims", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimCode: session.claimCode }),
  });
  expect(claimed.status).toBe(200);
  const claim = await claimed.json();
  return { session, claim };
}

it("closes an open HTTP SSE stream and its keepalive, releases the pool and resumes persisted state", async () => {
  const pool = new pg.Pool({
    connectionString: url,
    options: `-c search_path=${schema}`,
  });
  const first = new AgentRelayHost(pool);
  hosts.push(first);
  const { origin, server } = await listening(first);
  const { session, claim } = await paired(origin);
  const intervals = vi.spyOn(globalThis, "setInterval");
  const cleared = vi.spyOn(globalThis, "clearInterval");
  const abort = new AbortController();
  try {
    const response = await fetch(
      `${origin}/api/agent/sessions/${session.sessionId}/events`,
      {
        headers: { authorization: `Bearer ${claim.agentToken}` },
        signal: abort.signal,
      },
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      ": connected",
    );
    const keepalive = intervals.mock.results.at(-1)!.value;
    let ended = false;
    const draining = (async () => {
      while (!(await reader.read()).done) {
        /* Drain until shutdown. */
      }
      ended = true;
    })();
    void draining.catch(() => undefined);
    await first.close();
    await vi.waitFor(() => expect(ended).toBe(true));
    await draining;
    expect(cleared).toHaveBeenCalledWith(keepalive);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    const second = host();
    await second.start();
    const restarted = await listening(second);
    const status = await fetch(
      `${restarted.origin}/api/agent/sessions/${session.sessionId}/status`,
      { headers: { authorization: `Bearer ${claim.agentToken}` } },
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      ok: true,
      sessionId: session.sessionId,
      authorization: "active",
      editor: "detached",
    });
  } finally {
    abort.abort();
    await first.close();
    if (!pool.ended) await pool.end();
  }
});

it("does not retain objects for many unknown session ids", async () => {
  const relay = host();
  const { origin } = await listening(relay);
  await Promise.all(
    Array.from({ length: 40 }, async () => {
      const response = await fetch(
        `${origin}/api/agent/sessions/${randomUUID()}/status`,
        { headers: { authorization: "Bearer unknown" } },
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: "SESSION_NOT_FOUND" },
      });
    }),
  );
  await vi.waitFor(() => expect(registry(relay).size).toBe(0));
});

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("evicts an idle session and restores identical status from PostgreSQL", async () => {
  vi.stubEnv("AUTO_CANVAS_AGENT_IDLE_MS", "60");
  const relay = host();
  const { origin } = await listening(relay);
  const { session, claim } = await paired(origin);
  const status = () =>
    fetch(`${origin}/api/agent/sessions/${session.sessionId}/status`, {
      headers: { authorization: `Bearer ${claim.agentToken}` },
    }).then((response) => response.json());
  const first = registry(relay).get(session.sessionId);
  const before = await status();
  await vi.waitFor(() => expect(registry(relay).size).toBe(0));
  const after = await status();
  expect(after).toEqual({ ...before, observedAt: after.observedAt });
  expect(registry(relay).get(session.sessionId)).not.toBe(first);
});

it("pins a real editor socket until it closes", async () => {
  vi.stubEnv("AUTO_CANVAS_AGENT_IDLE_MS", "60");
  const relay = host();
  const { origin } = await listening(relay);
  const { session } = await paired(origin);
  const client = new ClientSocket(
    origin.replace("http:", "ws:") +
      `/api/agent/sessions/${session.sessionId}/editor`,
    [EDITOR_PROTOCOL, session.editorSecret],
    { origin },
  );
  clients.push(client);
  await once(client, "open");
  const object = registry(relay).get(session.sessionId);
  await pause(150);
  expect(registry(relay).get(session.sessionId)).toBe(object);
  const closed = once(client, "close");
  client.close();
  await closed;
  await vi.waitFor(() =>
    expect(registry(relay).has(session.sessionId)).toBe(false),
  );
});

it("pins an HTTP SSE subscriber until the client cancels it", async () => {
  vi.stubEnv("AUTO_CANVAS_AGENT_IDLE_MS", "60");
  const relay = host();
  const { origin } = await listening(relay);
  const { session, claim } = await paired(origin);
  const abort = new AbortController();
  try {
    const response = await fetch(
      `${origin}/api/agent/sessions/${session.sessionId}/events`,
      {
        headers: { authorization: `Bearer ${claim.agentToken}` },
        signal: abort.signal,
      },
    );
    const reader = response.body!.getReader();
    await reader.read();
    const object = registry(relay).get(session.sessionId);
    await pause(150);
    expect(registry(relay).get(session.sessionId)).toBe(object);
    abort.abort();
    await vi.waitFor(() =>
      expect(registry(relay).has(session.sessionId)).toBe(false),
    );
  } finally {
    abort.abort();
  }
});

it("pins an in-flight HTTP request and its output gate until writes persist", async () => {
  vi.stubEnv("AUTO_CANVAS_AGENT_IDLE_MS", "30");
  const entered = deferred();
  const release = deferred();
  const writing = deferred();
  const persist = deferred();
  const relay = host((state) => ({
    async fetch() {
      entered.resolve();
      await release.promise;
      await state.storage.put("state", "saved");
      return Response.json({ ok: true });
    },
    async alarm() {},
    async webSocketMessage() {},
    async webSocketClose() {},
  }));
  const sql: {
    query(text: string, values?: unknown[]): Promise<pg.QueryResult>;
  } = db;
  const query = sql.query.bind(sql);
  vi.spyOn(sql, "query").mockImplementation((...args) => {
    if (args[0].includes("INSERT INTO agent_relay_storage")) {
      writing.resolve();
      return persist.promise.then(() => query(...args));
    }
    return query(...args);
  });
  const { origin } = await listening(relay);
  const name = randomUUID();
  const request = fetch(`${origin}/api/agent/sessions/${name}/status`);
  try {
    await entered.promise;
    const object = registry(relay).get(name);
    await pause(80);
    expect(registry(relay).get(name)).toBe(object);
    release.resolve();
    await writing.promise;
    await pause(80);
    expect(registry(relay).get(name)).toBe(object);
    persist.resolve();
    expect(await (await request).json()).toEqual({ ok: true });
    await vi.waitFor(() => expect(registry(relay).has(name)).toBe(false));
    expect(
      (
        await db.query(
          "SELECT key FROM agent_relay_storage WHERE object_name=$1",
          [name],
        )
      ).rows,
    ).toEqual([{ key: "state" }]);
  } finally {
    release.resolve();
    persist.resolve();
    await request;
  }
});

it("pins a pending input blocker even without a request", async () => {
  vi.stubEnv("AUTO_CANVAS_AGENT_IDLE_MS", "30");
  const entered = deferred();
  const release = deferred();
  const relay = host((state) => {
    state.blockConcurrencyWhile!(async () => {
      entered.resolve();
      await release.promise;
    });
    return {
      async fetch() {
        return new Response();
      },
      async alarm() {},
      async webSocketMessage() {},
      async webSocketClose() {},
    };
  });
  const name = randomUUID();
  const object = relay.getByName(name);
  try {
    await entered.promise;
    await pause(80);
    expect(registry(relay).get(name)).toBe(object);
  } finally {
    release.resolve();
  }
  await vi.waitFor(() => expect(registry(relay).has(name)).toBe(false));
});

it("recreates an evicted object when its alarm fires and preserves same-time rescheduling", async () => {
  vi.stubEnv("AUTO_CANVAS_AGENT_IDLE_MS", "20");
  const time = Date.now() + 250;
  let created = 0;
  let fired = 0;
  const relay = host((state) => {
    created++;
    return {
      async fetch() {
        await state.storage.put("saved", new Uint8Array([4, 5]));
        await state.storage.setAlarm!(time);
        return new Response();
      },
      async alarm() {
        expect(await state.storage.get("saved")).toEqual(
          new Uint8Array([4, 5]),
        );
        fired++;
        if (fired === 1) await state.storage.setAlarm!(time);
        else await state.storage.put("fired", true);
      },
      async webSocketMessage() {},
      async webSocketClose() {},
    };
  });
  const name = randomUUID();
  await relay.getByName(name).fetch("http://internal/start");
  await vi.waitFor(() => expect(registry(relay).size).toBe(0));
  expect(fired).toBe(0);
  await vi.waitFor(() => expect(fired).toBe(2));
  expect(created).toBe(2);
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
});
