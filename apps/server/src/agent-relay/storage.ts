import { deserialize, serialize } from "node:v8";
import type { Pool } from "pg";
import type { DurableStorageLike } from "./agent-session-runtime.js";

/**
 * The input gate loads the whole object before events start. Cache operations
 * complete in microtasks, without yielding to Node's next I/O event. Durable
 * writes run in issue order; the host's output gate waits for flush().
 */
export class RelayStorage implements DurableStorageLike {
  private readonly values = new Map<string, Buffer>();
  private writes: Promise<void> = Promise.resolve();
  alarmTime: number | null = null;
  alarmVersion = 0;

  constructor(
    private readonly db: Pool,
    private readonly name: string,
    private readonly alarmChanged: (
      time: number | null,
      loaded?: boolean,
    ) => void,
  ) {}

  async load(): Promise<void> {
    const values = await this.db.query<{ key: string; value: Buffer }>(
      "SELECT key, value FROM agent_relay_storage WHERE object_name = $1",
      [this.name],
    );
    for (const row of values.rows) this.values.set(row.key, row.value);
    const alarms = await this.db.query<{ scheduled_time: string }>(
      "SELECT scheduled_time FROM agent_relay_alarms WHERE object_name = $1",
      [this.name],
    );
    this.alarmTime = alarms.rows[0]
      ? Number(alarms.rows[0].scheduled_time)
      : null;
    this.alarmChanged(this.alarmTime, true);
  }

  get isEmpty(): boolean {
    return this.values.size === 0;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value === undefined
      ? undefined
      : (deserialize(Buffer.from(value)) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    const bytes = serialize(value);
    this.values.set(key, bytes);
    this.enqueue(async () => {
      await this.db.query(
        `INSERT INTO agent_relay_storage(object_name, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (object_name, key) DO UPDATE SET value = EXCLUDED.value`,
        [this.name, key, bytes],
      );
    });
  }

  async deleteAll(): Promise<void> {
    this.values.clear();
    // Like DO storage, deleting keys does not delete the separately held alarm.
    this.enqueue(async () => {
      await this.db.query(
        "DELETE FROM agent_relay_storage WHERE object_name = $1",
        [this.name],
      );
    });
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    if (!Number.isSafeInteger(scheduledTime) || scheduledTime < 0)
      throw new Error("Invalid Agent alarm time");
    this.alarmTime = scheduledTime;
    this.alarmVersion++;
    this.enqueue(async () => {
      await this.db.query(
        `INSERT INTO agent_relay_alarms(object_name, scheduled_time) VALUES ($1, $2)
         ON CONFLICT (object_name) DO UPDATE SET scheduled_time = EXCLUDED.scheduled_time`,
        [this.name, scheduledTime],
      );
      if (this.alarmTime === scheduledTime) this.alarmChanged(scheduledTime);
    });
  }

  /** Consume only this timer's alarm, preserving a concurrently scheduled one. */
  consumeAlarm(time: number, version: number): void {
    if (this.alarmTime !== time || this.alarmVersion !== version) return;
    this.alarmTime = null;
    this.enqueue(async () => {
      await this.db.query(
        "DELETE FROM agent_relay_alarms WHERE object_name = $1 AND scheduled_time = $2",
        [this.name, time],
      );
    });
  }

  private enqueue(write: () => Promise<void>): void {
    this.writes = this.writes.then(write);
    // Keep a failed output gate rejected, without an unhandled rejection while
    // an event is still waiting for an editor response.
    void this.writes.catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.writes;
  }
}
