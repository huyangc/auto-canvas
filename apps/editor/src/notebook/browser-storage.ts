/**
 * The notebook build's per-user browser storage. The entry replaces the
 * page's storage globals (`localStorage`, `sessionStorage`, `indexedDB`,
 * `BroadcastChannel`, `navigator.locks`, `navigator.storage`) with facades
 * before any editor module loads. Until the gate fixes the user's namespace
 * every facade refuses use; afterwards each one reaches the browser's own
 * store under names prefixed with that user's namespace, and shows only
 * those names. See docs/specs/server.md ("The editor in notebook mode") for
 * the boundary: this separates the editor's own data per user, it is not a
 * defence against other code of the origin.
 */

/** A store the browser offers could not be bound to the user. */
export class NotebookStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotebookStorageError";
  }
}

const KEPT = /^[A-Za-z0-9_-]$/u;

/**
 * The namespace of a notebook user id: `nb1:` + the id with every UTF-16
 * code unit other than `A–Z a–z 0–9 _ -` written as `.` and four lowercase
 * hex digits + `:`. Total, deterministic and injective; it holds no `:`
 * between its ends, so no user's prefix is a prefix of another's. Pure: the
 * browser cases derive expected names from it.
 */
export function namespacePrefix(id: string): string {
  let encoded = "";
  for (let index = 0; index < id.length; index += 1) {
    const unit = id.charAt(index);
    encoded += KEPT.test(unit)
      ? unit
      : `.${id.charCodeAt(index).toString(16).padStart(4, "0")}`;
  }
  return `nb1:${encoded}:`;
}

export type StorageSurface =
  | "localStorage"
  | "sessionStorage"
  | "indexedDB"
  | "BroadcastChannel"
  | "navigator.locks"
  | "navigator.storage";

/** Schedules one drain checkpoint; the default is `setTimeout(callback, 0)`. */
export type CheckpointScheduler = (callback: () => void) => void;

export interface NotebookStorageOptions {
  /** Called on any use of a facade before the namespace is fixed. */
  onLockedAccess: (surface: StorageSurface) => void;
  /** The global object the editor's code runs in; `globalThis` by default. */
  globalObject?: object;
  /** Replaces the drain's checkpoint scheduler (tests). */
  scheduler?: CheckpointScheduler;
}

export interface NotebookStorage {
  /** Set when a store the browser offers could not be replaced: terminal. */
  readonly failure: NotebookStorageError | null;
  /**
   * The browser's own store, looked up now (the native getter may throw);
   * `undefined` when the page has no such store.
   */
  native(surface: "localStorage" | "sessionStorage"): Storage | undefined;
  /** Fixes the namespace once and unlocks the facades; throws otherwise. */
  setNamespace(prefix: string): void;
  /**
   * Resolves once IndexedDB requests and transactions started through the
   * facades have been finished for two checkpoints in a row with no
   * activity in between, or after `deadlineMs`. Never rejects.
   */
  settle(deadlineMs: number): Promise<void>;
}

interface Surface {
  name: StorageSurface;
  property: string;
  /** Where the facade is installed: the page or its navigator. */
  target: object;
  /** The browser's value, looked up at each use. */
  nativeValue: () => unknown;
  /** What `Object.getOwnPropertyDescriptor(target, property)` must show. */
  installed: (descriptor: PropertyDescriptor | undefined) => boolean;
}

type FacadeFactory = (native: unknown) => unknown;

function findDescriptor(
  object: object,
  property: string,
): PropertyDescriptor | undefined {
  for (
    let current: object | null = object;
    current !== null;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor) return descriptor;
  }
  return undefined;
}

function securityError(message: string): DOMException {
  return new DOMException(message, "SecurityError");
}

/**
 * Replaces the page's storage globals by locked per-user facades. Calls no
 * storage getter and never throws: a present store whose global cannot be
 * replaced (or does not read back as replaced) is reported as `failure`,
 * after which the page must not start the editor.
 */
export function installNotebookStorage(
  page: object & { navigator?: object },
  options: NotebookStorageOptions,
): NotebookStorage {
  const globalObject = options.globalObject ?? globalThis;
  const scheduler: CheckpointScheduler =
    options.scheduler ?? ((callback) => void setTimeout(callback, 0));
  let prefix: string | null = null;
  let namespaceSet = false;
  const surfaces: Surface[] = [];
  const nativeLookups = new Map<string, () => unknown>();

  // --- Drain bookkeeping (IndexedDB requests and transactions) ---------
  let pending = 0;
  let activity = 0;
  const tracked = new WeakSet<object>();
  const wrappedConnections = new WeakSet<object>();

  /** Counts `target` until its first event of `terminal`, exactly once. */
  function track(target: EventTarget, terminal: readonly string[]): void {
    if (tracked.has(target)) return;
    tracked.add(target);
    pending += 1;
    activity += 1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      pending -= 1;
      activity += 1;
      for (const type of terminal) target.removeEventListener(type, finish);
    };
    for (const type of terminal) target.addEventListener(type, finish);
  }

  /** Tracks the transactions of a connection, before the application sees it. */
  function wrapConnection(connection: unknown): void {
    if (
      connection === null ||
      typeof connection !== "object" ||
      wrappedConnections.has(connection)
    )
      return;
    wrappedConnections.add(connection);
    const database = connection as IDBDatabase;
    const transaction = database.transaction as (
      this: IDBDatabase,
      ...args: unknown[]
    ) => IDBTransaction;
    if (typeof transaction !== "function") return;
    database.transaction = function (this: IDBDatabase, ...args: unknown[]) {
      const created = Reflect.apply(transaction, this, args) as IDBTransaction;
      track(created, ["complete", "abort"]);
      return created;
    } as IDBDatabase["transaction"];
  }

  function locked(surface: StorageSurface): never {
    try {
      options.onLockedAccess(surface);
    } catch {
      // Reporting must not change what the caller sees.
    }
    throw securityError(
      `${surface} is not available before the notebook session is confirmed`,
    );
  }

  const current = (): string => {
    // Facades exist only after the commit; never fall back to bare names.
    if (prefix === null)
      throw securityError("The storage namespace is not set");
    return prefix;
  };
  const withPrefix = (name: unknown) => current() + String(name);
  const owned = (name: unknown): name is string =>
    typeof name === "string" && name.startsWith(current());
  const strip = (name: string) => name.slice(current().length);

  // --- Facades ------------------------------------------------------------
  const storageFacade: FacadeFactory = (value) => {
    const native = value as Storage;
    const keys = (): string[] => {
      const result: string[] = [];
      const count = native.length;
      for (let index = 0; index < count; index += 1) {
        const key = native.key(index);
        if (owned(key)) result.push(strip(key));
      }
      return result;
    };
    return Object.freeze({
      getItem: (key: string) => native.getItem(withPrefix(key)),
      setItem: (key: string, item: string) =>
        native.setItem(withPrefix(key), String(item)),
      removeItem: (key: string) => native.removeItem(withPrefix(key)),
      key: (index: number) => keys()[index] ?? null,
      get length() {
        return keys().length;
      },
      clear: () => {
        for (const key of keys()) native.removeItem(withPrefix(key));
      },
    });
  };

  const indexedDBFacade: FacadeFactory = (value) => {
    const native = value as IDBFactory;
    const facade: Partial<IDBFactory> = {
      open: (name: string, version?: number) => {
        const request =
          version === undefined
            ? native.open(withPrefix(name))
            : native.open(withPrefix(name), version);
        // Before any application handler: these run first.
        const connect = () => wrapConnection(request.result);
        request.addEventListener("upgradeneeded", connect);
        request.addEventListener("success", connect);
        track(request, ["success", "error"]);
        return request;
      },
      deleteDatabase: (name: string) => {
        const request = native.deleteDatabase(withPrefix(name));
        track(request, ["success", "error"]);
        return request;
      },
      cmp: (first: unknown, second: unknown) => native.cmp(first, second),
    };
    if (typeof native.databases === "function")
      facade.databases = () =>
        native
          .databases()
          .then((list) =>
            list.flatMap((info) =>
              owned(info.name) ? [{ ...info, name: strip(info.name) }] : [],
            ),
          );
    return Object.freeze(facade);
  };

  const locksFacade: FacadeFactory = (value) => {
    const native = value as LockManager;
    const visible = (locks: LockInfo[] | undefined) =>
      locks?.flatMap((lock) =>
        owned(lock.name) ? [{ ...lock, name: strip(lock.name) }] : [],
      );
    return Object.freeze({
      request: (name: string, ...rest: unknown[]) =>
        Reflect.apply(native.request, native, [withPrefix(name), ...rest]),
      query: () =>
        native.query().then((snapshot) => {
          const result: LockManagerSnapshot = {};
          const held = visible(snapshot.held);
          const waiting = visible(snapshot.pending);
          if (held) result.held = held;
          if (waiting) result.pending = waiting;
          return result;
        }),
    });
  };

  const storageManagerFacade: FacadeFactory = (value) => {
    const native = value as StorageManager;
    const facade: Record<string, unknown> = {
      getDirectory: () =>
        Promise.reject(
          securityError("The origin private file system is not available"),
        ),
    };
    for (const method of ["estimate", "persist", "persisted"] as const)
      if (typeof native[method] === "function")
        facade[method] = () => native[method]();
    return Object.freeze(facade);
  };

  const channelFacade: FacadeFactory = (value) => {
    const Native = value as typeof BroadcastChannel;
    const nativeName =
      typeof Native.prototype === "object" && Native.prototype !== null
        ? findDescriptor(Native.prototype, "name")?.get
        : undefined;
    class NotebookBroadcastChannel extends Native {
      constructor(name: string) {
        if (prefix === null) locked("BroadcastChannel");
        super(withPrefix(name));
      }
    }
    if (nativeName)
      Object.defineProperty(NotebookBroadcastChannel.prototype, "name", {
        configurable: true,
        get(this: BroadcastChannel) {
          return strip(String(nativeName.call(this)));
        },
      });
    return NotebookBroadcastChannel;
  };

  /** One facade per native object, so repeated reads give the same object. */
  function memoised(factory: FacadeFactory): FacadeFactory {
    const cache = new WeakMap<object, unknown>();
    return (native) => {
      if (
        native === null ||
        (typeof native !== "object" && typeof native !== "function")
      )
        return native;
      let facade = cache.get(native as object);
      if (facade === undefined) {
        facade = factory(native);
        cache.set(native as object, facade);
      }
      return facade;
    };
  }

  // --- Install -----------------------------------------------------------
  function install(
    target: object,
    property: string,
    name: StorageSurface,
    factory: FacadeFactory,
  ): void {
    const descriptor = findDescriptor(target, property);
    // An absent store stays absent (e.g. `navigator.locks` off a secure context).
    if (!descriptor) return;
    const facadeOf = memoised(factory);
    const getter = descriptor.get;
    const nativeValue: () => unknown = getter
      ? () => getter.call(target)
      : () => descriptor.value;
    nativeLookups.set(name, nativeValue);
    if (!descriptor.get && name === "BroadcastChannel") {
      // A data property (as in browsers): the facade is the class itself.
      // A value that is no constructor is no channel API: left as it is.
      if (typeof descriptor.value !== "function") return;
      const facade = facadeOf(descriptor.value);
      Object.defineProperty(target, property, {
        configurable: true,
        enumerable: descriptor.enumerable ?? false,
        writable: descriptor.writable ?? true,
        value: facade,
      });
      surfaces.push({
        name,
        property,
        target,
        nativeValue,
        installed: (found) =>
          found !== undefined && !found.get && found.value === facade,
      });
      return;
    }
    const get = function () {
      if (prefix === null) locked(name);
      // A denied store throws as it would natively; null stays null.
      return facadeOf(nativeValue());
    };
    Object.defineProperty(target, property, {
      configurable: true,
      enumerable: descriptor.enumerable ?? false,
      get,
    });
    surfaces.push({
      name,
      property,
      target,
      nativeValue,
      installed: (found) => found !== undefined && found.get === get,
    });
  }

  function readBack(): NotebookStorageError | null {
    if (globalObject !== page)
      return new NotebookStorageError(
        "The page is not the editor's global object",
      );
    for (const surface of surfaces)
      if (
        !surface.installed(
          Object.getOwnPropertyDescriptor(surface.target, surface.property),
        )
      )
        return new NotebookStorageError(
          `${surface.name} could not be bound to the notebook user`,
        );
    return null;
  }

  let failure: NotebookStorageError | null = null;
  try {
    install(page, "localStorage", "localStorage", storageFacade);
    install(page, "sessionStorage", "sessionStorage", storageFacade);
    install(page, "indexedDB", "indexedDB", indexedDBFacade);
    install(page, "BroadcastChannel", "BroadcastChannel", channelFacade);
    const navigatorObject = page.navigator;
    if (navigatorObject !== null && typeof navigatorObject === "object") {
      install(navigatorObject, "locks", "navigator.locks", locksFacade);
      install(
        navigatorObject,
        "storage",
        "navigator.storage",
        storageManagerFacade,
      );
    }
    failure = readBack();
  } catch (error) {
    failure = new NotebookStorageError(
      `Browser storage could not be bound to the notebook user: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    failure,
    native(surface) {
      const lookup = nativeLookups.get(surface);
      return lookup ? (lookup() as Storage | undefined) : undefined;
    },
    setNamespace(next) {
      if (namespaceSet)
        throw new NotebookStorageError("The storage namespace is already set");
      namespaceSet = true;
      if (failure) throw failure;
      if (typeof next !== "string" || next === "")
        throw new NotebookStorageError("The storage namespace is empty");
      const mismatch = readBack();
      if (mismatch) throw mismatch;
      prefix = next;
    },
    settle(deadlineMs) {
      return new Promise<void>((resolve) => {
        let done = false;
        let streak = 0;
        let seen = activity;
        const timer = setTimeout(finish, deadlineMs);
        function finish() {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        }
        function checkpoint() {
          if (done) return;
          streak = pending === 0 && activity === seen ? streak + 1 : 0;
          seen = activity;
          if (streak >= 2) finish();
          else schedule();
        }
        function schedule() {
          try {
            scheduler(checkpoint);
          } catch {
            finish();
          }
        }
        schedule();
      });
    },
  };
}
