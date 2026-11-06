import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Pool } from "pg";
import { WebSocketServer, type WebSocket as NodeWebSocket } from "ws";
import { AgentSessionDO } from "./agent-session-do.js";
import {
  EDITOR_PROTOCOL,
  routeAgentSessionRequest,
  type AgentSessionNamespaceLike,
  type AgentSessionEnv,
  type DurableStateLike,
} from "./agent-session-runtime.js";
import { RelayStorage } from "./storage.js";

type Session = Pick<
  AgentSessionDO,
  "fetch" | "alarm" | "webSocketMessage" | "webSocketClose"
>;
type SessionFactory = (
  state: DurableStateLike,
  env: AgentSessionEnv,
) => Session;
interface Upgrade {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  upgraded: boolean;
}

/** Per-object input gate. Whole handlers deliberately do not share a queue. */
class RelayObject implements DurableStateLike {
  readonly storage: RelayStorage;
  private readonly blockers = new Set<Promise<void>>();
  private readonly events = new Set<Promise<unknown>>();
  private readonly sockets = new Map<
    WebSocket,
    { raw: NodeWebSocket; tags: string[] }
  >();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private session!: Session;
  private stopped = false;
  private failure: unknown;

  constructor(
    db: Pool,
    name: string,
    env: AgentSessionEnv,
    factory: SessionFactory,
    readonly openWebSocket: () => Promise<{
      socket: WebSocket;
      response: Response;
    } | null>,
  ) {
    this.storage = new RelayStorage(db, name, (time) => this.arm(time));
    this.blockConcurrencyWhile(async () => {
      await this.storage.load();
      this.session = factory(this, env);
    });
  }

  blockConcurrencyWhile(callback: () => Promise<void>): void {
    const blocker = callback();
    this.blockers.add(blocker);
    void blocker.then(
      () => this.blockers.delete(blocker),
      (error: unknown) => {
        this.failure = error;
        this.blockers.delete(blocker);
      },
    );
  }

  private async deliver<T>(
    event: (session: Session) => Promise<T>,
  ): Promise<T> {
    while (this.blockers.size) await Promise.all(this.blockers);
    if (this.failure) throw this.failure;
    if (this.stopped) throw new Error("Agent relay is closed");
    const running = event(this.session);
    this.events.add(running);
    try {
      return await running;
    } finally {
      this.events.delete(running);
    }
  }

  async fetch(input: string | Request, init?: RequestInit): Promise<Response> {
    const response = await this.deliver((session) =>
      session.fetch(new Request(input, init)),
    );
    await this.storage.flush();
    return response;
  }

  acceptWebSocket(socket: WebSocket, tags: string[] = []): void {
    const raw = rawSockets.get(socket);
    if (!raw) throw new Error("Unknown Agent socket");
    this.sockets.set(socket, { raw, tags });
    raw.on("message", (data, binary) => {
      const bytes = Buffer.isBuffer(data)
        ? data
        : Buffer.concat(Array.isArray(data) ? data : [Buffer.from(data)]);
      void this.deliver((session) =>
        session.webSocketMessage(
          socket,
          binary ? Uint8Array.from(bytes).buffer : bytes.toString(),
        ),
      ).catch((error: unknown) => this.socketFailure(raw, error));
    });
    raw.on("close", () => {
      this.sockets.delete(socket);
      if (!this.stopped)
        void this.deliver((session) => session.webSocketClose(socket)).catch(
          (error: unknown) => this.socketFailure(raw, error),
        );
    });
  }

  getWebSockets(tag?: string): WebSocket[] {
    return [...this.sockets]
      .filter(([, value]) => tag === undefined || value.tags.includes(tag))
      .map(([socket]) => socket);
  }

  /** A facade keeps the class's synchronous send API behind the output gate. */
  wrap(raw: NodeWebSocket): WebSocket {
    let outputs = Promise.resolve();
    const output = (send: () => void) => {
      const persisted = this.storage.flush();
      outputs = outputs.then(() => persisted).then(send);
      void outputs.catch((error: unknown) => this.socketFailure(raw, error));
    };
    const socket = {
      get readyState() {
        return raw.readyState;
      },
      send: (data: string) =>
        output(() => {
          if (raw.readyState === 1) raw.send(data);
        }),
      close: (code?: number, reason?: string) =>
        output(() => raw.close(code, reason)),
    } as WebSocket;
    rawSockets.set(socket, raw);
    return socket;
  }

  private socketFailure(raw: NodeWebSocket, error: unknown): void {
    console.error("Agent socket event failed", error);
    raw.terminate();
  }

  private arm(time: number | null): void {
    clearTimeout(this.timer);
    if (time === null || this.stopped) return;
    const version = this.storage.alarmVersion;
    this.timer = setTimeout(
      () => {
        if (
          this.storage.alarmTime !== time ||
          this.storage.alarmVersion !== version
        )
          return;
        if (Date.now() < time) {
          this.arm(time);
          return;
        }
        void this.deliver(async (session) => {
          // Keep the persisted alarm until the handler and its output gate succeed:
          // a process crash or handler failure must leave it available for retry.
          await session.alarm();
          this.storage.consumeAlarm(time, version);
          await this.storage.flush();
        }).catch((error: unknown) => {
          console.error("Agent alarm failed", error);
          if (!this.stopped)
            this.timer = setTimeout(() => this.arm(time), 1000);
        });
      },
      Math.min(2_147_483_647, Math.max(0, time - Date.now())),
    );
    this.timer.unref();
  }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    // Startup may still be loading its cache or registering another blocker.
    while (this.blockers.size) await Promise.all(this.blockers);
    for (const [socket, { raw }] of this.sockets) {
      // Reject pending forwards before stopping their transport.
      await this.session.webSocketClose(socket);
      raw.terminate();
    }
    this.sockets.clear();
    await Promise.allSettled(this.events);
    await this.storage.flush();
  }
}

const rawSockets = new WeakMap<WebSocket, NodeWebSocket>();

/** One Node process owns the live objects; PostgreSQL holds their restart state. */
export class AgentRelayHost implements AgentSessionNamespaceLike {
  private readonly objects = new Map<string, RelayObject>();
  private readonly upgrades = new AsyncLocalStorage<Upgrade>();
  private readonly wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) =>
      protocols.has(EDITOR_PROTOCOL) ? EDITOR_PROTOCOL : false,
  });
  private stopped = false;

  constructor(
    private readonly db: Pool,
    private readonly allowedOrigin = process.env.AGENT_ALLOWED_ORIGIN,
    private readonly factory: SessionFactory = (state, env) =>
      new AgentSessionDO(state, env),
  ) {}

  /** Re-arm even objects that no HTTP request has accessed since restart. */
  async start(): Promise<void> {
    const alarms = await this.db.query<{ object_name: string }>(
      "SELECT object_name FROM agent_relay_alarms",
    );
    for (const row of alarms.rows) this.getByName(row.object_name);
  }

  getByName(name: string): RelayObject {
    if (this.stopped) throw new Error("Agent relay is closed");
    let object = this.objects.get(name);
    if (!object) {
      object = new RelayObject(
        this.db,
        name,
        this.allowedOrigin ? { AGENT_ALLOWED_ORIGIN: this.allowedOrigin } : {},
        this.factory,
        async () => {
          const upgrade = this.upgrades.getStore();
          if (!upgrade || upgrade.upgraded) return null;
          await object!.storage.flush();
          return new Promise((resolve, reject) => {
            const closed = () =>
              reject(new Error("Agent upgrade socket closed"));
            upgrade.socket.once("close", closed);
            this.wss.handleUpgrade(
              upgrade.request,
              upgrade.socket,
              upgrade.head,
              (raw) => {
                upgrade.socket.off("close", closed);
                upgrade.upgraded = true;
                raw.on("error", (error) =>
                  console.error("Agent WebSocket error", error),
                );
                resolve({
                  socket: object!.wrap(raw),
                  response: new Response(null),
                });
              },
            );
          });
        },
      );
      this.objects.set(name, object);
    }
    return object;
  }

  async fetch(request: Request): Promise<Response> {
    return (
      (await routeAgentSessionRequest(request, {
        AGENT_SESSION: this,
        ...(this.allowedOrigin
          ? { AGENT_ALLOWED_ORIGIN: this.allowedOrigin }
          : {}),
      })) ?? new Response("Not found", { status: 404 })
    );
  }

  attach(server: {
    on(
      event: "upgrade",
      listener: (
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer,
      ) => void,
    ): unknown;
  }): void {
    server.on("upgrade", (request, socket, head) => {
      const upgrade = { request, socket, head, upgraded: false };
      void this.upgrades.run(upgrade, async () => {
        try {
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers))
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          const url = new URL(
            request.url ?? "/",
            `http://${request.headers.host ?? "localhost"}`,
          );
          const response =
            request.method === "GET" &&
            /^\/api\/agent\/sessions\/[^/]+\/editor$/u.test(url.pathname)
              ? await this.fetch(new Request(url, { headers }))
              : new Response("Not found", { status: 404 });
          if (!upgrade.upgraded) {
            const body = Buffer.from(await response.text());
            socket.end(
              `HTTP/1.1 ${response.status} ${response.statusText}\r\nConnection: close\r\nContent-Length: ${body.length}\r\nContent-Type: application/json\r\n\r\n${body}`,
            );
          }
        } catch (error) {
          console.error("Agent WebSocket upgrade failed", error);
          socket.destroy();
        }
      });
    });
  }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await Promise.all(
      [...this.objects.values()].map((object) => object.close()),
    );
    this.wss.close();
  }
}
