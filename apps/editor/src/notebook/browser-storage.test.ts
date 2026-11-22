import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { finalizeBrowserRecoveryRecord } from "../document/browser-recovery-contract";
import {
  BROWSER_RECOVERY_DATABASE_NAME,
  createBrowserRecoveryStore,
  migrateLegacyProjectRecovery,
} from "../document/browser-recovery-store";
import { PROJECT_RECOVERY_KEY } from "../document/project-recovery";
import { createProjectWorkspaceStore } from "../document/project-workspace";
import {
  installNotebookStorage,
  namespacePrefix,
  NotebookStorageError,
  type CheckpointScheduler,
  type StorageSurface,
} from "./browser-storage";

// --- Fixtures ---------------------------------------------------------------

/** A Storage over a Map, in insertion order, with an optional quota. */
class MemoryStorage {
  readonly items = new Map<string, string>();
  constructor(private readonly quota = Infinity) {}
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (!this.items.has(key) && this.items.size >= this.quota)
      throw new DOMException("full", "QuotaExceededError");
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}

class FakeChannel {
  readonly #name: string;
  constructor(name: string) {
    this.#name = name;
  }
  get name() {
    return this.#name;
  }
}

function fakeLocks(snapshot: LockManagerSnapshot = {}) {
  const requests: unknown[][] = [];
  return {
    requests,
    snapshot,
    request(...args: unknown[]) {
      requests.push(args);
      return Promise.resolve("granted");
    },
    query: () => Promise.resolve(snapshot),
  };
}

interface Natives {
  localStorage?: unknown;
  sessionStorage?: unknown;
  indexedDB?: unknown;
  BroadcastChannel?: unknown;
  locks?: unknown;
  storage?: unknown;
}

/**
 * A page shaped as browsers shape theirs: own accessors for the Storage and
 * IndexedDB globals, a data property for BroadcastChannel, accessors on the
 * navigator's prototype. Getters record each call and can be denied.
 */
function fakePage(natives: Natives) {
  const calls: string[] = [];
  const denied = new Map<string, Error>();
  const page = {} as Record<string, unknown> & { navigator: object };
  const navigatorPrototype = {};
  const accessor = (target: object, name: keyof Natives) =>
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: true,
      get() {
        calls.push(name);
        const denial = denied.get(name);
        if (denial) throw denial;
        return natives[name];
      },
    });
  for (const name of ["localStorage", "sessionStorage", "indexedDB"] as const)
    if (name in natives) accessor(page, name);
  if ("BroadcastChannel" in natives)
    Object.defineProperty(page, "BroadcastChannel", {
      configurable: true,
      writable: true,
      value: natives.BroadcastChannel,
    });
  for (const name of ["locks", "storage"] as const)
    if (name in natives) accessor(navigatorPrototype, name);
  page.navigator = Object.create(navigatorPrototype) as object;
  return { page, calls, denied };
}

function install(
  page: object & { navigator?: object },
  scheduler?: CheckpointScheduler,
) {
  const locked: StorageSurface[] = [];
  const storage = installNotebookStorage(page, {
    onLockedAccess: (surface) => locked.push(surface),
    globalObject: page,
    ...(scheduler ? { scheduler } : {}),
  });
  return { storage, locked };
}

/** A user's view of shared natives: a page of their own, committed. */
function userView(
  natives: Natives,
  id: string,
  scheduler?: CheckpointScheduler,
) {
  const { page, calls, denied } = fakePage(natives);
  const { storage, locked } = install(page, scheduler);
  expect(storage.failure).toBeNull();
  storage.setNamespace(namespacePrefix(id));
  const view = page as unknown as {
    localStorage: Storage;
    sessionStorage: Storage;
    indexedDB: IDBFactory;
    BroadcastChannel: typeof BroadcastChannel;
    navigator: { locks: LockManager; storage: StorageManager };
  };
  return { view, page, storage, calls, denied, locked };
}

const flush = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
};

/** A scheduler whose checkpoints run only when the test steps them. */
function controlled() {
  const queue: (() => void)[] = [];
  return {
    scheduler: ((callback) => void queue.push(callback)) as CheckpointScheduler,
    step(times = 1) {
      for (let index = 0; index < times; index += 1) queue.shift()?.();
    },
  };
}

function watch(promise: Promise<void>) {
  const state = { resolved: false };
  void promise.then(() => (state.resolved = true));
  return state;
}

function event(target: EventTarget, type: string): Promise<Event> {
  return new Promise((resolve) =>
    target.addEventListener(type, resolve, { once: true }),
  );
}

function openDatabase(
  factory: IDBFactory,
  name: string,
  version = 1,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("items"))
        request.result.createObjectStore("items");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(database: IDBDatabase, key: string, value: unknown) {
  const transaction = database.transaction("items", "readwrite");
  transaction.objectStore("items").put(value, key);
  return {
    transaction,
    done: new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    }),
  };
}

async function readAll(factory: IDBFactory, name: string) {
  const database = await openDatabase(factory, name);
  const keys = await new Promise<IDBValidKey[]>((resolve) => {
    const request = database
      .transaction("items")
      .objectStore("items")
      .getAllKeys();
    request.onsuccess = () => resolve(request.result);
  });
  database.close();
  return keys;
}

afterEach(() => {
  vi.useRealTimers();
});

// --- Namespace -------------------------------------------------------------

describe("namespacePrefix", () => {
  it.each([
    ["alice", "nb1:alice:"],
    ["Alice", "nb1:Alice:"],
    ["a_b-c", "nb1:a_b-c:"],
    ["a:b", "nb1:a.003ab:"],
    [".003a", "nb1:.002e003a:"],
    ["a.b", "nb1:a.002eb:"],
    ["a b", "nb1:a.0020b:"],
    ["é", "nb1:.00e9:"],
    ["😀", "nb1:.d83d.de00:"],
    ["\ud800", "nb1:.d800:"],
  ])("encodes %j as %j", (id, prefix) => {
    expect(namespacePrefix(id)).toBe(prefix);
  });

  it("is injective and prefix-free over generated ids", () => {
    const alphabet = [
      "a",
      "Z",
      "0",
      "_",
      "-",
      ".",
      ":",
      " ",
      "é",
      "\ud83d",
      "\ude00",
      "0",
      "3",
    ];
    const ids = new Set<string>();
    // Every string of length 1–3 over the alphabet, and some longer ones.
    const grow = (stem: string, depth: number) => {
      if (stem) ids.add(stem);
      if (depth === 0) return;
      for (const unit of alphabet) grow(stem + unit, depth - 1);
    };
    grow("", 3);
    for (let index = 0; index < 200; index += 1)
      ids.add(
        Array.from(
          { length: 4 + (index % 9) },
          (_, position) =>
            alphabet[(index * 7 + position * 3) % alphabet.length],
        ).join(""),
      );
    const prefixes = new Map<string, string>();
    for (const id of ids) {
      const prefix = namespacePrefix(id);
      expect(prefixes.get(prefix), `${id} collides`).toBeUndefined();
      prefixes.set(prefix, id);
      expect(prefix.slice(4, -1)).not.toContain(":");
    }
    const all = [...prefixes.keys()].sort();
    // Sorted, a prefix would sit directly before a string that extends it.
    for (let index = 1; index < all.length; index += 1)
      expect(all[index]!.startsWith(all[index - 1]!)).toBe(false);
  });

  it("keeps a 200-unit id within 1005 characters", () => {
    expect(namespacePrefix("é".repeat(200))).toHaveLength(1005);
  });
});

// --- Install -----------------------------------------------------------------

describe("installNotebookStorage", () => {
  const allNatives = (): Natives => ({
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    indexedDB: new IDBFactory(),
    BroadcastChannel: FakeChannel,
    locks: fakeLocks(),
    storage: { estimate: () => Promise.resolve({ usage: 1, quota: 2 }) },
  });

  it("calls no storage getter when it installs", () => {
    const { page, calls } = fakePage(allNatives());
    const { storage } = install(page);
    expect(storage.failure).toBeNull();
    expect(calls).toEqual([]);
  });

  it("installs own accessors, a data property for the channel, and accessors on the navigator", () => {
    const { page } = fakePage(allNatives());
    install(page);
    for (const name of ["localStorage", "sessionStorage", "indexedDB"]) {
      const descriptor = Object.getOwnPropertyDescriptor(page, name)!;
      expect(typeof descriptor.get).toBe("function");
    }
    const channel = Object.getOwnPropertyDescriptor(page, "BroadcastChannel")!;
    expect(channel.get).toBeUndefined();
    expect(typeof channel.value).toBe("function");
    expect(channel.value).not.toBe(FakeChannel);
    for (const name of ["locks", "storage"])
      expect(
        typeof Object.getOwnPropertyDescriptor(page.navigator, name)!.get,
      ).toBe("function");
  });

  it("leaves absent stores absent", () => {
    const { page } = fakePage({ localStorage: new MemoryStorage() });
    const { storage } = install(page);
    storage.setNamespace(namespacePrefix("alice"));
    for (const name of ["sessionStorage", "indexedDB", "BroadcastChannel"])
      expect(name in page).toBe(false);
    expect("locks" in page.navigator).toBe(false);
    expect("storage" in page.navigator).toBe(false);
  });

  it("refuses every store before the namespace is set, and reports it", () => {
    const { page, calls } = fakePage(allNatives());
    const { storage, locked } = install(page);
    const view = page as unknown as Record<string, unknown> & {
      navigator: Record<string, unknown>;
    };
    const attempts: [StorageSurface, () => unknown][] = [
      ["localStorage", () => view.localStorage],
      ["sessionStorage", () => view.sessionStorage],
      ["indexedDB", () => view.indexedDB],
      [
        "BroadcastChannel",
        () => new (view.BroadcastChannel as typeof BroadcastChannel)("x"),
      ],
      ["navigator.locks", () => view.navigator.locks],
      ["navigator.storage", () => view.navigator.storage],
    ];
    for (const [surface, attempt] of attempts) {
      let thrown: unknown;
      try {
        attempt();
      } catch (error) {
        thrown = error;
      }
      expect(thrown, surface).toBeInstanceOf(DOMException);
      expect((thrown as DOMException).name).toBe("SecurityError");
      expect(locked.at(-1)).toBe(surface);
    }
    expect(locked).toHaveLength(attempts.length);
    // The native getters were never reached.
    expect(calls).toEqual([]);
    expect(storage.failure).toBeNull();
  });

  it("rethrows a denied store's own error at each use after the commit", () => {
    const natives = allNatives();
    const { view, denied } = userView(natives, "alice");
    const denial = new DOMException("denied", "SecurityError");
    denied.set("sessionStorage", denial);
    for (let index = 0; index < 2; index += 1) {
      let thrown: unknown;
      try {
        void view.sessionStorage;
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(denial);
    }
    denied.delete("sessionStorage");
    expect(view.sessionStorage.getItem("x")).toBeNull();
  });

  it("passes a method's failure through unchanged, apart from a denied getter", () => {
    const failing = new MemoryStorage();
    const error = new Error("broken store");
    failing.getItem = () => {
      throw error;
    };
    const { view } = userView({ localStorage: failing }, "alice");
    const facade = view.localStorage;
    expect(() => facade.getItem("x")).toThrow(error);
  });

  it("keeps a null store null", () => {
    const { view } = userView({ localStorage: null, indexedDB: null }, "alice");
    expect(view.localStorage).toBeNull();
    expect(view.indexedDB).toBeNull();
  });

  it("returns the same facade for the same native store", () => {
    const { view } = userView(allNatives(), "alice");
    expect(view.localStorage).toBe(view.localStorage);
    expect(view.indexedDB).toBe(view.indexedDB);
  });

  it("gives the token read the browser's own storage", () => {
    const natives = allNatives();
    (natives.localStorage as MemoryStorage).setItem(
      "silicon_notebook_token",
      "t",
    );
    const { page, calls } = fakePage(natives);
    const { storage } = install(page);
    expect(
      storage.native("localStorage")!.getItem("silicon_notebook_token"),
    ).toBe("t");
    expect(calls).toEqual(["localStorage"]);
    expect(
      install(fakePage({}).page).storage.native("localStorage"),
    ).toBeUndefined();
  });
});

describe("a store that cannot be replaced", () => {
  it("is a terminal failure on a frozen page with a usable store", () => {
    const { page, calls } = fakePage({ localStorage: new MemoryStorage() });
    Object.freeze(page);
    const { storage } = install(page);
    expect(storage.failure).toBeInstanceOf(NotebookStorageError);
    expect(calls).toEqual([]);
    expect(() => storage.setNamespace(namespacePrefix("alice"))).toThrow(
      NotebookStorageError,
    );
  });

  it("is a terminal failure on a frozen page whose store is denied now and usable later", () => {
    const { page, denied, calls } = fakePage({
      localStorage: new MemoryStorage(),
    });
    denied.set("localStorage", new DOMException("denied", "SecurityError"));
    Object.freeze(page);
    const { storage } = install(page);
    denied.clear();
    expect(storage.failure).toBeInstanceOf(NotebookStorageError);
    expect(calls).toEqual([]);
  });

  it("is a terminal failure when the page claims to define the facade but does not", () => {
    const { page } = fakePage({ localStorage: new MemoryStorage() });
    const proxy = new Proxy(page, { defineProperty: () => true });
    const { storage } = install(proxy);
    expect(storage.failure).toBeInstanceOf(NotebookStorageError);
    expect(storage.failure!.message).toMatch(/localStorage/u);
  });

  it("is a terminal failure when the page is not the editor's global object", () => {
    const { page } = fakePage({ localStorage: new MemoryStorage() });
    const storage = installNotebookStorage(page, { onLockedAccess: () => {} });
    expect(storage.failure).toBeInstanceOf(NotebookStorageError);
  });

  it("is not a failure for an absent store on a frozen page", () => {
    const { page } = fakePage({});
    Object.freeze(page);
    expect(install(page).storage.failure).toBeNull();
  });
});

describe("setNamespace", () => {
  it("can be called once", () => {
    const { page } = fakePage({ localStorage: new MemoryStorage() });
    const { storage } = install(page);
    storage.setNamespace(namespacePrefix("alice"));
    expect(() => storage.setNamespace(namespacePrefix("bob"))).toThrow(
      NotebookStorageError,
    );
    (page.localStorage as Storage).setItem("k", "v");
  });

  it("throws, leaving every store locked, when a facade was replaced after the install", () => {
    const native = new MemoryStorage();
    const { page } = fakePage({
      localStorage: native,
      sessionStorage: new MemoryStorage(),
    });
    const { storage, locked } = install(page);
    Object.defineProperty(page, "localStorage", {
      configurable: true,
      get: () => native,
    });
    expect(() => storage.setNamespace(namespacePrefix("alice"))).toThrow(
      NotebookStorageError,
    );
    expect(
      () => (page as unknown as { sessionStorage: Storage }).sessionStorage,
    ).toThrow(DOMException);
    expect(locked).toEqual(["sessionStorage"]);
  });
});

// --- Facades -----------------------------------------------------------------

describe("the Storage facade", () => {
  function shared() {
    const native = new MemoryStorage();
    native.setItem("icm.editor-mode.v1", "legacy");
    const alice = userView({ localStorage: native }, "alice").view.localStorage;
    const bob = userView({ localStorage: native }, "bob").view.localStorage;
    return { native, alice, bob };
  }

  it("keeps Alice's, Bob's and unprefixed keys apart", () => {
    const { native, alice, bob } = shared();
    alice.setItem("icm.editor-mode.v1", "draw");
    expect(bob.getItem("icm.editor-mode.v1")).toBeNull();
    expect(alice.getItem("icm.editor-mode.v1")).toBe("draw");
    expect(native.getItem("nb1:alice:icm.editor-mode.v1")).toBe("draw");
    expect(native.getItem("icm.editor-mode.v1")).toBe("legacy");
    bob.setItem("n", 5 as unknown as string);
    expect(native.getItem("nb1:bob:n")).toBe("5");
    bob.removeItem("icm.editor-mode.v1");
    alice.removeItem("n");
    expect(native.getItem("nb1:alice:icm.editor-mode.v1")).toBe("draw");
    expect(native.getItem("nb1:bob:n")).toBe("5");
  });

  it("scopes length, key and clear to the user", () => {
    const { native, alice, bob } = shared();
    alice.setItem("a", "1");
    alice.setItem("b", "2");
    bob.setItem("c", "3");
    expect(alice.length).toBe(2);
    expect([alice.key(0), alice.key(1), alice.key(2)]).toEqual([
      "a",
      "b",
      null,
    ]);
    expect(bob.length).toBe(1);
    expect(bob.key(0)).toBe("c");
    alice.clear();
    expect(alice.length).toBe(0);
    expect([...native.items.keys()]).toEqual([
      "icm.editor-mode.v1",
      "nb1:bob:c",
    ]);
  });

  it("lets a quota error through", () => {
    const native = new MemoryStorage(1);
    const { view } = userView({ localStorage: native }, "alice");
    view.localStorage.setItem("a", "1");
    let thrown: unknown;
    try {
      view.localStorage.setItem("b", "2");
    } catch (error) {
      thrown = error;
    }
    expect((thrown as DOMException).name).toBe("QuotaExceededError");
  });

  it("is frozen: no named properties", () => {
    const { alice } = shared();
    expect(Object.isFrozen(alice)).toBe(true);
    expect(() => {
      (alice as unknown as Record<string, string>).theme = "dark";
    }).toThrow(TypeError);
  });
});

describe("the IndexedDB facade", () => {
  it("opens and deletes prefixed databases, lists only the user's, and compares natively", async () => {
    const native = new IDBFactory();
    const legacy = await openDatabase(native, "analog-canvas-recovery");
    legacy.close();
    const alice = userView({ indexedDB: native }, "alice").view.indexedDB;
    const bob = userView({ indexedDB: native }, "bob").view.indexedDB;
    (await openDatabase(alice, "analog-canvas-recovery")).close();
    (await openDatabase(alice, "analog-canvas-workspaces")).close();
    (await openDatabase(bob, "analog-canvas-recovery")).close();
    expect((await native.databases()).map(({ name }) => name).sort()).toEqual([
      "analog-canvas-recovery",
      "nb1:alice:analog-canvas-recovery",
      "nb1:alice:analog-canvas-workspaces",
      "nb1:bob:analog-canvas-recovery",
    ]);
    expect((await alice.databases()).map(({ name }) => name).sort()).toEqual([
      "analog-canvas-recovery",
      "analog-canvas-workspaces",
    ]);
    await new Promise((resolve) => {
      alice.deleteDatabase("analog-canvas-recovery").onsuccess = resolve;
    });
    expect((await native.databases()).map(({ name }) => name).sort()).toEqual([
      "analog-canvas-recovery",
      "nb1:alice:analog-canvas-workspaces",
      "nb1:bob:analog-canvas-recovery",
    ]);
    expect(alice.cmp(1, 2)).toBe(-1);
  });

  it("offers databases() only when the browser does", () => {
    const native = new IDBFactory();
    const withoutList = Object.create(native) as IDBFactory & {
      databases?: unknown;
    };
    Object.defineProperty(withoutList, "databases", { value: undefined });
    const { view } = userView({ indexedDB: withoutList }, "alice");
    expect(view.indexedDB.databases).toBeUndefined();
  });
});

describe("the editor's real stores through the facades", () => {
  const project = createEmptyProject("project-alpha", "Alpha Amp");
  let counter = 0;
  function record(workingCopyId: string, minute: number) {
    counter += 1;
    return finalizeBrowserRecoveryRecord({
      recordId: `record-${counter}`,
      workingCopyId,
      generation: "latest",
      projectId: project.id,
      projectName: project.name,
      projectSchemaVersion: CURRENT_PROJECT_FILE_VERSION,
      topDocumentId: project.topDocumentId,
      documentRevisions: { [project.topDocumentId]: 1 },
      source: "new",
      updatedAt: `2026-08-14T10:${String(minute).padStart(2, "0")}:00.000Z`,
      projectText: serializeProject(project),
    });
  }
  const copies = async (store: ReturnType<typeof createBrowserRecoveryStore>) =>
    (await store.readAll()).sessions
      .map(({ workingCopyId }) => workingCopyId)
      .sort();

  it("keeps recovery retention to the user's own records", async () => {
    const native = new IDBFactory();
    const alice = createBrowserRecoveryStore({
      idbFactory: userView({ indexedDB: native }, "alice").view.indexedDB,
    });
    const bob = createBrowserRecoveryStore({
      idbFactory: userView({ indexedDB: native }, "bob").view.indexedDB,
    });
    expect((await alice.writeRecord(record("alice-copy", 1))).status).toBe(
      "stored",
    );
    expect((await bob.writeRecord(record("bob-old", 2))).status).toBe("stored");
    // A newer copy of the same Project: the older closed copy is evicted.
    const outcome = await bob.writeRecord(record("bob-new", 3));
    expect(outcome.status).toBe("stored");
    expect(await copies(bob)).toEqual(["bob-new"]);
    expect(await copies(alice)).toEqual(["alice-copy"]);

    // Control: in one shared database the same writes evict Alice's copy.
    const sharedStore = createBrowserRecoveryStore({
      idbFactory: new IDBFactory(),
    });
    await sharedStore.writeRecord(record("alice-copy", 1));
    await sharedStore.writeRecord(record("bob-old", 2));
    await sharedStore.writeRecord(record("bob-new", 3));
    expect(await copies(sharedStore)).toEqual(["bob-new"]);
    for (const store of [alice, bob, sharedStore]) store.close();
    expect((await native.databases()).map(({ name }) => name).sort()).toEqual([
      `nb1:alice:${BROWSER_RECOVERY_DATABASE_NAME}`,
      `nb1:bob:${BROWSER_RECOVERY_DATABASE_NAME}`,
    ]);
  });

  it("never offers Bob a window Alice left", async () => {
    const native = new IDBFactory();
    const alice = createProjectWorkspaceStore(
      userView({ indexedDB: native }, "alice").view.indexedDB,
    );
    const bob = createProjectWorkspaceStore(
      userView({ indexedDB: native }, "bob").view.indexedDB,
    );
    const workspace = (windowId: string) => ({
      version: 1 as const,
      windowId,
      url: "/canvas/editor",
      savedAt: 1,
      activeId: "tab",
      tabs: [{ id: "tab", session: { text: "x" } }],
    });
    await alice.write(workspace("alice-window"));
    expect(await bob.latestElsewhere("bob-window")).toBeNull();
    expect((await alice.latestElsewhere("other"))?.windowId).toBe(
      "alice-window",
    );
    await bob.write(workspace("bob-window-2"));
    expect((await bob.latestElsewhere("bob-window"))?.windowId).toBe(
      "bob-window-2",
    );
    alice.close();
    bob.close();
  });

  it("sees no legacy recovery slot, and leaves it alone", async () => {
    const nativeLocal = new MemoryStorage();
    const legacy = serializeProject(project);
    nativeLocal.setItem(PROJECT_RECOVERY_KEY, legacy);
    const { view } = userView(
      { localStorage: nativeLocal, indexedDB: new IDBFactory() },
      "alice",
    );
    const store = createBrowserRecoveryStore({ idbFactory: view.indexedDB });
    const outcome = await migrateLegacyProjectRecovery({
      store,
      getLegacyStorage: () => view.localStorage,
    });
    expect(outcome).toEqual({ status: "not-needed" });
    expect(nativeLocal.getItem(PROJECT_RECOVERY_KEY)).toBe(legacy);
    expect((await store.readAll()).sessions).toEqual([]);
    store.close();
  });
});

describe("locks, channels and navigator.storage", () => {
  it("prefixes lock requests and shows only the user's locks, stripped", async () => {
    const locks = fakeLocks({
      held: [
        { name: "nb1:alice:analog-canvas-window:w1", mode: "exclusive" },
        { name: "nb1:bob:analog-canvas-window:w2", mode: "exclusive" },
        { name: "analog-canvas-window:w3", mode: "exclusive" },
      ],
      pending: [{ name: "nb1:alice:x", mode: "shared" }],
    });
    const { view } = userView({ locks }, "alice");
    const callback = () => undefined;
    await view.navigator.locks.request("analog-canvas-window:w1", callback);
    await view.navigator.locks.request("y", { ifAvailable: true }, callback);
    expect(locks.requests).toEqual([
      ["nb1:alice:analog-canvas-window:w1", callback],
      ["nb1:alice:y", { ifAvailable: true }, callback],
    ]);
    expect(await view.navigator.locks.query()).toEqual({
      held: [{ name: "analog-canvas-window:w1", mode: "exclusive" }],
      pending: [{ name: "x", mode: "shared" }],
    });
  });

  it("prefixes channel names and shows them stripped", () => {
    const { view } = userView({ BroadcastChannel: FakeChannel }, "alice");
    const channel = new view.BroadcastChannel("sync");
    expect(channel).toBeInstanceOf(FakeChannel);
    expect(channel.name).toBe("sync");
    expect((channel as unknown as { name: string }).name).toBe("sync");
    expect(
      Object.getOwnPropertyDescriptor(FakeChannel.prototype, "name")!.get!.call(
        channel,
      ),
    ).toBe("nb1:alice:sync");
  });

  it("refuses the origin private file system and passes the rest of navigator.storage", async () => {
    const native = {
      estimate: () => Promise.resolve({ usage: 1, quota: 2 }),
      persisted: () => Promise.resolve(true),
      getDirectory: () => Promise.resolve("root"),
    };
    const { view } = userView({ storage: native }, "alice");
    await expect(view.navigator.storage.getDirectory()).rejects.toMatchObject({
      name: "SecurityError",
    });
    await expect(view.navigator.storage.estimate()).resolves.toEqual({
      usage: 1,
      quota: 2,
    });
    await expect(view.navigator.storage.persisted()).resolves.toBe(true);
    expect(view.navigator.storage.persist).toBeUndefined();
  });
});

// --- Drain ---------------------------------------------------------------------

describe("settle", () => {
  async function setup() {
    const native = new IDBFactory();
    const clock = controlled();
    const user = userView({ indexedDB: native }, "alice", clock.scheduler);
    const database = await openDatabase(user.view.indexedDB, "drain");
    return { native, clock, ...user, database };
  }

  it("resolves after two idle checkpoints", async () => {
    const { storage, clock, database } = await setup();
    const state = watch(storage.settle(60_000));
    clock.step();
    await flush();
    expect(state.resolved).toBe(false);
    clock.step();
    await flush();
    expect(state.resolved).toBe(true);
    database.close();
  });

  it("waits for a transaction opened between the first and second checkpoint", async () => {
    const { storage, clock, database, native } = await setup();
    const state = watch(storage.settle(60_000));
    clock.step();
    const { done } = put(database, "k", 1);
    clock.step();
    await flush();
    // A drain that trusted a single idle checkpoint would be done already.
    expect(state.resolved).toBe(false);
    clock.step(3);
    await flush();
    expect(state.resolved).toBe(false);
    await done;
    clock.step(3);
    await flush();
    expect(state.resolved).toBe(true);
    database.close();
    expect(await readAll(native, "nb1:alice:drain")).toEqual(["k"]);
  });

  it("restarts the idle streak after activity that began and ended between checkpoints", async () => {
    const { storage, clock, database } = await setup();
    const state = watch(storage.settle(60_000));
    clock.step();
    await put(database, "k", 1).done;
    clock.step();
    await flush();
    expect(state.resolved).toBe(false);
    clock.step();
    await flush();
    expect(state.resolved).toBe(false);
    clock.step();
    await flush();
    expect(state.resolved).toBe(true);
    database.close();
  });

  it("gives up at the deadline with a request that never finishes", async () => {
    const native = new IDBFactory();
    const { view, storage } = userView({ indexedDB: native }, "alice");
    const holder = await openDatabase(view.indexedDB, "held", 1);
    const blocked = view.indexedDB.open("held", 2);
    await event(blocked, "blocked");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const state = watch(storage.settle(3000));
    await vi.advanceTimersByTimeAsync(2999);
    expect(state.resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.resolved).toBe(true);
    vi.useRealTimers();
    holder.close();
    (
      await new Promise<IDBDatabase>((resolve) => {
        blocked.onsuccess = () => resolve(blocked.result);
      })
    ).close();
  });

  it("waits for a blocked open until it is released", async () => {
    const { storage, clock, view } = await setup();
    const holder = await openDatabase(view.indexedDB, "held", 1);
    const blocked = view.indexedDB.open("held", 2);
    await event(blocked, "blocked");
    const state = watch(storage.settle(60_000));
    clock.step(4);
    await flush();
    expect(state.resolved).toBe(false);
    const opened = event(blocked, "success");
    holder.close();
    await opened;
    clock.step(3);
    await flush();
    expect(state.resolved).toBe(true);
    blocked.result.close();
  });

  it("counts an aborted upgrade until the open request's error", async () => {
    const { storage, clock, view, database } = await setup();
    const request = view.indexedDB.open("aborted", 1);
    request.onupgradeneeded = () => request.transaction!.abort();
    const state = watch(storage.settle(60_000));
    clock.step(4);
    await flush();
    expect(state.resolved).toBe(false);
    await event(request, "error");
    clock.step(3);
    await flush();
    expect(state.resolved).toBe(true);
    database.close();
  });

  it("counts a transaction with a handled request error until it completes", async () => {
    const { storage, clock, database } = await setup();
    await put(database, "k", 1).done;
    const transaction = database.transaction("items", "readwrite");
    const request = transaction.objectStore("items").add(2, "k");
    const state = watch(storage.settle(60_000));
    const atError = new Promise<boolean>((resolve) => {
      request.onerror = (failure) => {
        failure.preventDefault();
        // Once the error has reached the transaction, before it completes:
        // the request failed but the transaction goes on, still counted.
        void flush().then(async () => {
          clock.step(4);
          await flush();
          resolve(state.resolved);
        });
      };
    });
    const completed = event(transaction, "complete");
    expect(await atError).toBe(false);
    await completed;
    clock.step(3);
    await flush();
    expect(state.resolved).toBe(true);
    database.close();
  });

  it("counts a transaction that errs and then aborts once", async () => {
    const { storage, clock, database } = await setup();
    await put(database, "k", 1).done;
    const transaction = database.transaction("items", "readwrite");
    transaction.objectStore("items").add(2, "k");
    const errored = event(transaction, "error");
    const aborted = event(transaction, "abort");
    await errored;
    await aborted;
    const state = watch(storage.settle(60_000));
    clock.step(2);
    await flush();
    // A double count would leave the drain waiting for ever.
    expect(state.resolved).toBe(true);
    database.close();
  });

  it("tracks transactions of a cached connection and of a new one", async () => {
    const { storage, clock, database, view } = await setup();
    const second = await openDatabase(view.indexedDB, "drain-2");
    const state = watch(storage.settle(60_000));
    const first = put(database, "a", 1);
    const other = put(second, "b", 2);
    clock.step(4);
    await flush();
    expect(state.resolved).toBe(false);
    await first.done;
    clock.step(1);
    await other.done;
    clock.step(1);
    await flush();
    expect(state.resolved).toBe(false);
    clock.step(2);
    await flush();
    expect(state.resolved).toBe(true);
    database.close();
    second.close();
  });

  it("tracks a connection reopened without an upgrade", async () => {
    const native = new IDBFactory();
    const seeded = await openDatabase(native, "nb1:alice:seeded", 1);
    seeded.close();
    const clock = controlled();
    const { view, storage } = userView(
      { indexedDB: native },
      "alice",
      clock.scheduler,
    );
    const request = view.indexedDB.open("seeded", 1);
    let upgraded = false;
    request.onupgradeneeded = () => (upgraded = true);
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    expect(upgraded).toBe(false);
    const { done } = put(database, "k", 1);
    const state = watch(storage.settle(60_000));
    clock.step(4);
    await flush();
    expect(state.resolved).toBe(false);
    await done;
    clock.step(3);
    await flush();
    expect(state.resolved).toBe(true);
    database.close();
  });

  it("still runs the application's own handlers", async () => {
    const { view } = await setup();
    const calls: string[] = [];
    const request = view.indexedDB.open("handlers", 1);
    request.onupgradeneeded = () => {
      calls.push("upgradeneeded");
      request.result.createObjectStore("items");
    };
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => {
        calls.push("success");
        resolve(request.result);
      };
    });
    const transaction = database.transaction("items", "readwrite");
    transaction.objectStore("items").put(1, "k");
    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => {
        calls.push("complete");
        resolve();
      };
    });
    expect(calls).toEqual(["upgradeneeded", "success", "complete"]);
    database.close();
  });

  it("waits, with the real scheduler, for a write chained after another's completion", async () => {
    const native = new IDBFactory();
    const { view, storage } = userView({ indexedDB: native }, "alice");
    const database = await openDatabase(view.indexedDB, "queue");
    let queue = Promise.resolve();
    queue = queue.then(() => put(database, "first", 1).done);
    queue = queue.then(() => put(database, "second", 2).done);
    await storage.settle(3000);
    database.close();
    expect((await readAll(native, "nb1:alice:queue")).sort()).toEqual([
      "first",
      "second",
    ]);
    await queue;
  });
});
