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
  private readonly streams = new Set<() => Promise<void>>();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private idleSince = Date.now();
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
    alarmChanged: (time: number | null, loaded?: boolean) => void,
    private readonly idleMs: number,
    private readonly evict: () => void,
  ) {
    this.storage = new RelayStorage(db, name, alarmChanged);
    this.blockConcurrencyWhile(async () => {
      await this.storage.load();
      this.session = factory(this, env);
    });
  }

  blockConcurrencyWhile(callback: () => Promise<void>): void {
    const blocker = callback();
    this.blockers.add(blocker);
    void blocker.then(
      () => {
        this.blockers.delete(blocker);
        this.activityChanged();
      },
      (error: unknown) => {
        this.failure = error;
        this.blockers.delete(blocker);
      },
    );
  }

  private async deliver<T>(
    event: (session: Session) => Promise<T>,
  ): Promise<T> {
    const running = (async () => {
      while (this.blockers.size) await Promise.all(this.blockers);
      if (this.failure) throw this.failure;
      if (this.stopped) throw new Error("Agent relay is closed");
      return event(this.session);
    })();
    this.events.add(running);
    this.activityChanged();
    try {
      return await running;
    } finally {
      this.events.delete(running);
      this.activityChanged();
    }
  }

  async fetch(input: string | Request, init?: RequestInit): Promise<Response> {
    return this.deliver(async (session) => {
      let response = await session.fetch(new Request(input, init));
      if (
        response.headers.get("content-type")?.split(";")[0]?.trim() ===
          "text/event-stream" &&
        response.body
      )
        response = this.trackStream(response);
      await this.storage.flush();
      return response;
    });
  }

  /** Own the source reader: the HTTP adapter locks the returned body. */
  private trackStream(response: Response): Response {
    const reader = response.body!.getReader();
    let finished = false;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const finish = () => {
      finished = true;
      this.streams.delete(stop);
      reader.releaseLock();
      this.activityChanged();
    };
    const cancel = async () => {
      if (finished) return;
      // Mark before awaiting: cancellation also resolves an outstanding pull.
      finished = true;
      try {
        await reader.cancel();
      } finally {
        finish();
      }
    };
    const stop = async () => {
      if (finished) return;
      const cancelled = cancel();
      controller.close();
      await cancelled;
    };
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      pull: async () => {
        try {
          const next = await reader.read();
          if (finished) return;
          if (next.done) {
            finish();
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          if (finished) return;
          finish();
          controller.error(error);
        }
      },
      cancel,
    });
    this.streams.add(stop);
    if (this.stopped) void stop();
    return new Response(body, response);
  }

  acceptWebSocket(socket: WebSocket, tags: string[] = []): void {
    const raw = rawSockets.get(socket);
    if (!raw) throw new Error("Unknown Agent socket");
    this.sockets.set(socket, { raw, tags });
    this.activityChanged();
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
      this.activityChanged();
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

  async alarm(time: number): Promise<void> {
    await this.deliver(async (session) => {
      if (this.storage.alarmTime !== time) return;
      const version = this.storage.alarmVersion;
      // A crash or failed output gate must leave the alarm available for retry.
      await session.alarm();
      this.storage.consumeAlarm(time, version);
      await this.storage.flush();
    });
  }

  private busy(): boolean {
    return (
      this.stopped ||
      !!this.failure ||
      this.events.size > 0 ||
      this.blockers.size > 0 ||
      this.sockets.size > 0 ||
      this.streams.size > 0
    );
  }

  private activityChanged(): void {
    this.idleSince = Date.now();
    clearTimeout(this.idleTimer);
    void this.checkIdle();
  }

  private async checkIdle(): Promise<void> {
    if (this.busy()) return;
    const writes = this.storage.flush();
    try {
      await writes;
    } catch {
      return; // Failed writes must never be discarded by eviction.
    }
    if (this.busy()) return;
    if (writes !== this.storage.flush()) return this.checkIdle();
    clearTimeout(this.idleTimer);
    const remaining = this.idleMs - (Date.now() - this.idleSince);
    if (this.storage.isEmpty || remaining <= 0) {
      this.stopped = true;
      this.evict();
    } else {
      this.idleTimer = setTimeout(
        () => void this.checkIdle(),
        Math.min(2_147_483_647, remaining),
      );
      this.idleTimer.unref();
    }
  }

  async close(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.idleTimer);
    // Startup may still be loading its cache or registering another blocker.
    while (this.blockers.size) await Promise.all(this.blockers);
    for (const [socket, { raw }] of this.sockets) {
      // Reject pending forwards before stopping their transport.
      await this.session.webSocketClose(socket);
      raw.terminate();
    }
    this.sockets.clear();
    await Promise.all([...this.streams].map((stop) => stop()));
    await Promise.allSettled(this.events);
    await this.storage.flush();
  }
}

const rawSockets = new WeakMap<WebSocket, NodeWebSocket>();

/** One Node process owns the live objects; PostgreSQL holds their restart state. */
export class AgentRelayHost implements AgentSessionNamespaceLike {
  private readonly objects = new Map<string, RelayObject>();
  private readonly alarms = new Map<
    string,
    { time: number; timer?: ReturnType<typeof setTimeout> }
  >();
  private readonly upgrades = new AsyncLocalStorage<Upgrade>();
  private readonly wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) =>
      protocols.has(EDITOR_PROTOCOL) ? EDITOR_PROTOCOL : false,
  });
  private stopped = false;
  private closing: Promise<void> | undefined;
  private readonly idleMs: number;

  constructor(
    private readonly db: Pool,
    private readonly allowedOrigin = process.env.AGENT_ALLOWED_ORIGIN,
    private readonly factory: SessionFactory = (state, env) =>
      new AgentSessionDO(state, env),
  ) {
    this.idleMs = Number(process.env.AUTO_CANVAS_AGENT_IDLE_MS ?? 300_000);
    if (!Number.isSafeInteger(this.idleMs) || this.idleMs < 0)
      throw new Error("Invalid AUTO_CANVAS_AGENT_IDLE_MS");
  }

  /** Re-arm even objects that no HTTP request has accessed since restart. */
  async start(): Promise<void> {
    const alarms = await this.db.query<{
      object_name: string;
      scheduled_time: string;
    }>("SELECT object_name, scheduled_time FROM agent_relay_alarms");
    for (const row of alarms.rows)
      this.arm(row.object_name, Number(row.scheduled_time), true);
  }

  /** Timers retain only the object name, so alarms do not pin a loaded cache. */
  private arm(name: string, time: number | null, loaded = false): void {
    if (this.stopped || (loaded && this.alarms.has(name))) return;
    clearTimeout(this.alarms.get(name)?.timer);
    this.alarms.delete(name);
    if (time === null) return;
    const alarm: { time: number; timer?: ReturnType<typeof setTimeout> } = {
      time,
    };
    const run = () => {
      if (this.stopped || this.alarms.get(name) !== alarm) return;
      if (Date.now() < time) {
        schedule(time - Date.now());
        return;
      }
      void this.getByName(name)
        .alarm(time)
        .then(
          () => {
            if (this.alarms.get(name) === alarm) this.alarms.delete(name);
          },
          (error: unknown) => {
            console.error("Agent alarm failed", error);
            if (!this.stopped && this.alarms.get(name) === alarm)
              schedule(1000);
          },
        );
    };
    const schedule = (delay: number) => {
      alarm.timer = setTimeout(
        run,
        Math.min(2_147_483_647, Math.max(0, delay)),
      );
      alarm.timer.unref();
    };
    this.alarms.set(name, alarm);
    schedule(time - Date.now());
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
        (time, loaded) => this.arm(name, time, loaded),
        this.idleMs,
        () => {
          if (this.objects.get(name) === object) this.objects.delete(name);
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

  close(): Promise<void> {
    // Repeated shutdown callers still wait for cleanup; the first caller owns
    // any persistence error, as before.
    if (this.closing) return this.closing.catch(() => undefined);
    return (this.closing ??= this.shutdown());
  }

  private async shutdown(): Promise<void> {
    this.stopped = true;
    for (const alarm of this.alarms.values()) clearTimeout(alarm.timer);
    this.alarms.clear();
    const results = await Promise.allSettled(
      [...this.objects.values()].map((object) => object.close()),
    );
    this.objects.clear();
    this.wss.close();
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}
