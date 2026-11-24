import { expect, type BrowserContext, type Page } from "@playwright/test";

export interface StorageEventRecord {
  seq: number;
  time: number;
  doc: string;
  op: string;
  name: string;
  phase: "before" | "after";
  path?: string;
  navigation?: string;
  area?: "session" | "local";
  txId?: number | undefined;
  store?: string;
  revision?: number | undefined;
  concealed?: boolean;
  canvas?: boolean;
  changed?: boolean;
  outside?: number;
}

// Serialized by Playwright. Keep native captures and their consumers in the
// same closure. Child frames share the tab's sessionStorage and must not
// generate trace writes in response to the top document's trace writes.
function installRecorder() {
  if (window !== window.top || !/^https?:$/u.test(location.protocol)) return;
  const local = window.localStorage;
  const session = window.sessionStorage;
  const factory = window.indexedDB;
  const locks = navigator.locks;
  const storage = Storage.prototype;
  const { getItem, setItem, removeItem, key, clear } = storage;
  const length = Object.getOwnPropertyDescriptor(storage, "length")!;
  const { open, databases, deleteDatabase } = IDBFactory.prototype;
  const { transaction } = IDBDatabase.prototype;
  const {
    get,
    getAll,
    getAllKeys,
    put,
    delete: del,
  } = IDBObjectStore.prototype;
  const { request, query } = LockManager.prototype;
  const doc = crypto.randomUUID();
  const traceKey = "__notebookE2eTrace";
  const read = (area: Storage, name: string): string | null =>
    Reflect.apply(getItem, area, [name]);
  const write = (area: Storage, name: string, value: string) =>
    Reflect.apply(setItem, area, [name, value]);
  const raw = {
    doc,
    local,
    session,
    factory,
    locks,
    getItem,
    setItem,
    removeItem,
    key,
    clear,
    length: length.get!,
    open,
    databases,
    deleteDatabase,
    transaction,
    get,
    getAll,
    getAllKeys,
    put,
    del,
    request,
    query,
    read,
    write,
    remove: (area: Storage, name: string) =>
      Reflect.apply(removeItem, area, [name]),
    list: (): Promise<IDBDatabaseInfo[]> =>
      Reflect.apply(databases, factory, []),
    openDB: (name: string, version?: number): IDBOpenDBRequest =>
      Reflect.apply(
        open,
        factory,
        version === undefined ? [name] : [name, version],
      ),
    tx: (
      db: IDBDatabase,
      store: string,
      mode: IDBTransactionMode = "readonly",
    ): IDBTransaction => Reflect.apply(transaction, db, [store, mode]),
    all: (store: IDBObjectStore): IDBRequest =>
      Reflect.apply(getAll, store, []),
    trace: (): StorageEventRecord[] =>
      (read(session, traceKey) ?? "")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    observeRestore() {
      const observe = (op: string) =>
        record(op, "persisted", {
          concealed: concealed(),
          canvas: !!document.querySelector("[data-testid=schematic-canvas]"),
          changed: !!document.querySelector(
            "#root [data-testid=notebook-account-changed]",
          ),
          outside: document.querySelectorAll("body > :not(script):not(#root)")
            .length,
        });
      window.addEventListener("pagehide", (e) => {
        if (e.persisted) observe("late-pagehide");
      });
      window.addEventListener("pageshow", (e) => {
        if (e.persisted) observe("late-pageshow");
      });
    },
  };
  Object.defineProperty(window, "__nb", { value: raw });
  let phase: StorageEventRecord["phase"] = "before";
  let seq = 0;
  let restoring = false;
  const concealed = () =>
    document.body?.style.display === "none" &&
    document.body.style.getPropertyPriority("display") === "important";
  function record(
    op: string,
    name: string,
    details: Partial<StorageEventRecord> = {},
  ) {
    const event = {
      seq: ++seq,
      doc,
      time: performance.now(),
      op,
      name,
      phase,
      ...details,
    };
    write(
      session,
      traceKey,
      (read(session, traceKey) ?? "") + JSON.stringify(event) + "\n",
    );
  }
  for (const op of [
    "getItem",
    "setItem",
    "removeItem",
    "key",
    "clear",
  ] as const) {
    const original = storage[op];
    Object.defineProperty(storage, op, {
      value: function (this: Storage, ...args: unknown[]) {
        const name = String(args[0] ?? "");
        const recheck =
          restoring && op === "getItem" && name === "silicon_notebook_token";
        record(op, name, {
          area: this === local ? "local" : "session",
          ...(recheck && { concealed: concealed() }),
        });
        if (recheck) restoring = false;
        return Reflect.apply(original, this, args);
      },
    });
  }
  Object.defineProperty(storage, "length", {
    ...length,
    get() {
      record("length", "");
      return Reflect.apply(length.get!, this, []);
    },
  });
  for (const op of ["open", "deleteDatabase", "databases"] as const) {
    const original = IDBFactory.prototype[op];
    Object.defineProperty(IDBFactory.prototype, op, {
      value: function (this: IDBFactory, ...args: unknown[]) {
        record(op, String(args[0] ?? ""));
        return Reflect.apply(original, this, args);
      },
    });
  }
  let nextTx = 0;
  const transactions = new WeakMap<IDBTransaction, number>();
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = Reflect.apply(transaction, this, args) as IDBTransaction;
    const txId = ++nextTx;
    transactions.set(tx, txId);
    record("transaction", this.name, { txId });
    for (const op of ["complete", "abort"])
      tx.addEventListener(op, () => record(op, this.name, { txId }));
    return tx;
  };
  for (const op of ["get", "getAll", "getAllKeys", "delete", "put"] as const) {
    const original = IDBObjectStore.prototype[op];
    Object.defineProperty(IDBObjectStore.prototype, op, {
      value: function (this: IDBObjectStore, ...args: unknown[]) {
        const tx = this.transaction;
        const details = { txId: transactions.get(tx), store: this.name };
        const value = args[0] as {
          documentRevisions?: Record<string, number>;
          topDocumentId: string;
          tabs?: { session: { projectText: string } }[];
        };
        if (op === "put" && this.name === "windows") {
          for (const tab of value.tabs ?? []) {
            const project = JSON.parse(tab.session.projectText);
            record(op, tx.db.name, {
              ...details,
              revision: project.documents.find(
                (d: { id: string }) => d.id === project.topDocumentId,
              )?.revision,
            });
          }
        } else
          record(op, tx.db.name, {
            ...details,
            ...(op === "put" && {
              revision: value.documentRevisions?.[value.topDocumentId],
            }),
          });
        return Reflect.apply(original, this, args);
      },
    });
  }
  for (const op of ["request", "query"] as const) {
    const original = LockManager.prototype[op];
    Object.defineProperty(LockManager.prototype, op, {
      value: function (this: LockManager, ...args: unknown[]) {
        record(op, String(args[0] ?? ""));
        return Reflect.apply(original, this, args);
      },
    });
  }
  for (const name of [
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "storage",
    "locks",
  ] as const) {
    const target = name === "storage" || name === "locks" ? navigator : window;
    const descriptor =
      Object.getOwnPropertyDescriptor(target, name) ??
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), name);
    if (descriptor?.get)
      Object.defineProperty(target, name, {
        ...descriptor,
        get() {
          record("getter", name);
          return Reflect.apply(descriptor.get!, this, []);
        },
      });
  }
  const Channel = window.BroadcastChannel;
  window.BroadcastChannel = class extends Channel {
    constructor(name: string) {
      super(name);
      record("channel", name);
    }
  };
  const error = console.error;
  console.error = function (...args) {
    if (
      String(args[0]).startsWith(
        "auto-canvas: browser storage used before sign-in:",
      )
    )
      record("locked", String(args[0]));
    Reflect.apply(error, console, args);
  };
  const mark = performance.mark;
  performance.mark = function (name, options) {
    record("mark", name);
    if (name === "auto-canvas:notebook-commit") phase = "after";
    return Reflect.apply(mark, this, [name, options]);
  };
  window.addEventListener("storage", (e) => record("storage", e.key ?? ""));
  document.addEventListener("visibilitychange", () =>
    record("visibilitychange", document.visibilityState),
  );
  for (const op of ["pagehide", "pageshow"] as const)
    window.addEventListener(op, (e) => {
      record(op, String(e.persisted), {
        path: location.pathname,
        navigation: (
          performance.getEntriesByType(
            "navigation",
          )[0] as PerformanceNavigationTiming
        )?.type,
      });
      if (op === "pagehide" && e.persisted) restoring = true;
    });
  return raw;
}

declare global {
  interface Window {
    __nb: NonNullable<ReturnType<typeof installRecorder>>;
  }
}

export function instrumentStorage(context: BrowserContext) {
  return context.addInitScript(installRecorder);
}

export function prefix(user: { id: string }) {
  return `nb1:${user.id}:`;
}

export function trace(page: Page) {
  return page.evaluate(() => window.__nb.trace());
}
export function documentTrace(page: Page) {
  return page.evaluate(() =>
    window.__nb.trace().filter((e) => e.doc === window.__nb.doc),
  );
}

export function checkNamespace(
  events: StorageEventRecord[],
  user: { id: string },
) {
  const expected = prefix(user);
  expect(events.length).toBeGreaterThan(0);
  for (const event of events) {
    if (
      event.op === "getItem" &&
      event.area === "local" &&
      ["silicon_notebook_token", "theme"].includes(event.name)
    )
      continue;
    if (
      [
        "getItem",
        "setItem",
        "removeItem",
        "open",
        "deleteDatabase",
        "transaction",
        "request",
        "channel",
      ].includes(event.op) &&
      !event.name.startsWith(expected)
    )
      throw Error(`${event.op} outside namespace: ${event.name}`);
  }
}

export function seedDraw(page: Page, user: { id: string }) {
  return page.evaluate((p) => {
    const raw = window.__nb;
    raw.write(raw.local, p + "icm.editor-mode.v1", "draw");
    raw.write(raw.local, p + "icm.editor-mode-coach.v1", "seen");
  }, prefix(user));
}

export async function rawRecords<T>(
  page: Page,
  database: string,
  store: string,
): Promise<T[]> {
  return page.evaluate(
    async ([name, storeName]) => {
      const raw = window.__nb;
      if (!(await raw.list()).some((db) => db.name === name)) return [];
      return new Promise<T[]>((resolve, reject) => {
        const req = raw.openDB(name);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const all = raw.all(raw.tx(db, storeName).objectStore(storeName));
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
          db.close();
        };
      });
    },
    [database, store] as const,
  );
}
