// @vitest-environment jsdom
// The production notebook entry, through its test seam, over browser stores
// this test provides (jsdom has no IndexedDB; fake-indexeddb stands in) and
// a fixture editor that writes through the page's globals. It does not show
// the real editor's handlers, navigation, the back/forward cache or native
// IndexedDB timing (the browser cases of T163b do).
import { useEffect } from "react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppProps } from "../app/App";
import { mountNotebookEditor } from "../entries/notebook";
import type { createWebEditorServices } from "../services/web-editor-services";
import { TOKEN_KEY, type Identification } from "./session";

type Modules = {
  App: React.ComponentType<AppProps>;
  createWebEditorServices: typeof createWebEditorServices;
};
type Page = Window & typeof globalThis;

/** A Storage over a Map, in insertion order. */
class MemoryStorage {
  readonly items = new Map<string, string>();
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
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}

const SURFACES = [
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "BroadcastChannel",
  "fetch",
];
let saved: Map<string, PropertyDescriptor | undefined>;
let listeners: [
  EventTarget,
  string,
  EventListenerOrEventListenerObject | null,
][];
let nativeLocal: MemoryStorage;
let nativeSession: MemoryStorage;
let nativeDatabases: IDBFactory;
let localDenial: Error | null;
let localCalls: number;
let log: string[];
let root: HTMLElement;

function user(id: string): Identification {
  return {
    kind: "user",
    user: {
      id,
      displayName: id,
      provider: "notebook",
      role: "user",
      isAdmin: false,
    },
  };
}

beforeEach(() => {
  saved = new Map(
    SURFACES.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(window, name),
    ]),
  );
  // Every listener this test adds is removed afterwards: gates of earlier
  // tests must not hear later events.
  listeners = [];
  for (const target of [window, document] as EventTarget[]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation(
      (type, listener, options) => {
        listeners.push([target, type, listener]);
        add(type, listener, options);
      },
    );
  }
  nativeLocal = new MemoryStorage();
  nativeSession = new MemoryStorage();
  nativeDatabases = new IDBFactory();
  localDenial = null;
  localCalls = 0;
  // The browser's own stores, as accessors on the page.
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      localCalls += 1;
      if (localDenial) throw localDenial;
      return nativeLocal;
    },
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get: () => nativeSession,
  });
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    get: () => nativeDatabases,
  });
  log = [];
  performance.clearMarks();
  root = document.createElement("div");
  root.id = "root";
  const script = document.createElement("script");
  document.body.replaceChildren(root, script);
  document.body.removeAttribute("style");
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [target, type, listener] of listeners)
    target.removeEventListener(type, listener);
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(window, name, descriptor);
    else Reflect.deleteProperty(window, name);
  }
  document.body.replaceChildren();
});

/**
 * An editor that writes through the page's globals: a preference at mount,
 * and on the page being hidden a workspace-like record, with a second write
 * chained on the first one's completion at unmount.
 */
function fixtureModules(ready: () => void): Modules {
  function FixtureApp() {
    useEffect(() => {
      localStorage.setItem("icm.editor-mode.v1", "draw");
      let database: IDBDatabase | null = null;
      let last: Promise<void> = Promise.resolve();
      const write = (key: string) =>
        new Promise<void>((resolve) => {
          const transaction = database!.transaction("items", "readwrite");
          transaction.objectStore("items").put(key, key);
          transaction.oncomplete = () => {
            log.push(`complete ${key}`);
            resolve();
          };
          transaction.onabort = () => resolve();
        });
      const request = indexedDB.open("analog-canvas-workspaces", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("items");
      request.onsuccess = () => {
        database = request.result;
        ready();
      };
      const menu = document.createElement("div");
      menu.setAttribute("data-testid", "fixture-menu");
      document.body.append(menu);
      const onPageHide = () => {
        log.push("pagehide");
        last = write("pagehide");
      };
      window.addEventListener("pagehide", onPageHide);
      return () => {
        window.removeEventListener("pagehide", onPageHide);
        log.push("unmount");
        last = last.then(() => write("unmount"));
      };
    }, []);
    return <p data-testid="fixture-editor">editor</p>;
  }
  return {
    App: FixtureApp as unknown as Modules["App"],
    createWebEditorServices: (() => ({
      capabilities: {},
    })) as unknown as Modules["createWebEditorServices"],
  };
}

async function start(
  options: { identify?: (token: string) => Promise<Identification> } = {},
) {
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  const loadModules = vi.fn(() =>
    Promise.resolve(fixtureModules(resolveReady)),
  );
  const identify = vi.fn(
    options.identify ??
      ((token: string) => Promise.resolve(user(token.replace(/-token$/u, "")))),
  );
  const reload = vi.fn(() => log.push("reload"));
  mountNotebookEditor({ page: window as Page, identify, loadModules, reload });
  return { ready, loadModules, identify, reload };
}

async function databaseKeys(name: string): Promise<IDBValidKey[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = nativeDatabases.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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

const changeToken = (value: string) => {
  nativeLocal.setItem(TOKEN_KEY, value);
  window.dispatchEvent(new StorageEvent("storage", { key: TOKEN_KEY }));
};

describe("an account change in the notebook entry", () => {
  it("reads the token natively, stores the outgoing user's writes in their namespace, then reloads once", async () => {
    nativeLocal.setItem(TOKEN_KEY, "alice-token");
    const { ready, identify, reload } = await start();
    await ready;
    expect(identify).toHaveBeenCalledWith("alice-token");
    expect(root.querySelector('[data-testid="fixture-editor"]')).not.toBeNull();
    expect(
      performance.getEntriesByName("auto-canvas:notebook-commit"),
    ).toHaveLength(1);
    expect(nativeLocal.getItem("nb1:alice:icm.editor-mode.v1")).toBe("draw");
    expect(nativeLocal.getItem("icm.editor-mode.v1")).toBeNull();

    changeToken("bob-token");
    // At once: the editor is gone, the screen shown, the reload not yet.
    expect(
      root.querySelector('[data-testid="notebook-account-changed"]'),
    ).not.toBeNull();
    expect(root.querySelector('[data-testid="fixture-editor"]')).toBeNull();
    expect(
      [...document.body.children].map((child) => child.tagName.toLowerCase()),
    ).toEqual(["div", "script"]);
    expect(reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(log).toEqual([
      "pagehide",
      "unmount",
      "complete pagehide",
      "complete unmount",
      "reload",
    ]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(
      performance.getEntriesByName("auto-canvas:notebook-reload"),
    ).toHaveLength(1);
    expect(identify).toHaveBeenCalledTimes(1);
    expect(
      (await databaseKeys("nb1:alice:analog-canvas-workspaces")).sort(),
    ).toEqual(["pagehide", "unmount"]);
    const names = (await nativeDatabases.databases()).map(({ name }) => name);
    expect(names.filter((name) => name?.startsWith("nb1:bob:"))).toEqual([]);
    expect(names).not.toContain("analog-canvas-workspaces");
    // Nothing later restarts the page.
    changeToken("carol-token");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("storage before sign-in", () => {
  it("refuses the editor's stores until the commit, logging each use", async () => {
    nativeLocal.setItem(TOKEN_KEY, "alice-token");
    let finish!: (identity: Identification) => void;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ready } = await start({
      identify: () => new Promise((resolve) => (finish = resolve)),
    });
    expect(() => window.sessionStorage).toThrow(DOMException);
    expect(() => indexedDB).toThrow(/not available/u);
    expect(errors.mock.calls).toEqual([
      ["auto-canvas: browser storage used before sign-in: sessionStorage"],
      ["auto-canvas: browser storage used before sign-in: indexedDB"],
    ]);
    finish(user("alice"));
    await ready;
    expect(window.sessionStorage.getItem("x")).toBeNull();
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it("shows the error screen with Retry when the browser denies the token's storage, and mounts after Retry", async () => {
    nativeLocal.setItem(TOKEN_KEY, "alice-token");
    localDenial = new DOMException("denied", "SecurityError");
    const { ready, identify } = await start();
    const screen = root.querySelector('[data-testid="notebook-error"]')!;
    expect(screen.querySelector("button")!.textContent).toBe("Retry");
    expect(identify).not.toHaveBeenCalled();
    localDenial = null;
    screen.querySelector("button")!.click();
    await ready;
    expect(root.querySelector('[data-testid="fixture-editor"]')).not.toBeNull();
  });
});

describe("a store that cannot be bound to the user", () => {
  for (const [name, deniedAtInstall] of [
    ["usable", false],
    ["denied at install, usable afterwards", true],
  ] as const)
    it(`stops before the gate with a Reload screen (store ${name})`, () => {
      let calls = 0;
      let denied = deniedAtInstall;
      const page = Object.freeze({
        document,
        navigator: {},
        get localStorage() {
          calls += 1;
          if (denied) throw new DOMException("denied", "SecurityError");
          return nativeLocal;
        },
      });
      const loadModules = vi.fn();
      const identify = vi.fn();
      const reload = vi.fn();
      mountNotebookEditor({
        page: page as unknown as Page,
        identify,
        loadModules,
        reload,
      });
      denied = false;
      const screen = root.querySelector('[data-testid="notebook-error"]')!;
      expect(screen.textContent).toMatch(/Reload the page/u);
      expect(identify).not.toHaveBeenCalled();
      expect(loadModules).not.toHaveBeenCalled();
      expect(calls).toBe(0);
      expect(localCalls).toBe(0);
      const button = screen.querySelector("button")!;
      expect(button.textContent).toBe("Reload");
      button.click();
      expect(reload).toHaveBeenCalledTimes(1);
    });
});

describe("the back/forward cache", () => {
  const pagehide = () =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
  const pageshow = () =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );

  for (const [previous, priority] of [
    ["", ""],
    ["flex", ""],
    ["grid", "important"],
  ] as const)
    it(`conceals the body and restores its display ${JSON.stringify(previous)} ${priority}`, async () => {
      if (previous)
        document.body.style.setProperty("display", previous, priority);
      nativeLocal.setItem(TOKEN_KEY, "alice-token");
      const { ready, reload } = await start();
      await ready;
      pagehide();
      expect(document.body.style.getPropertyValue("display")).toBe("none");
      expect(document.body.style.getPropertyPriority("display")).toBe(
        "important",
      );
      pageshow();
      expect(document.body.style.getPropertyValue("display")).toBe(previous);
      expect(document.body.style.getPropertyPriority("display")).toBe(priority);
      expect(
        root.querySelector('[data-testid="fixture-editor"]'),
      ).not.toBeNull();
      expect(reload).not.toHaveBeenCalled();
    });

  it("replaces a concealed editor by the account-changed screen before revealing", async () => {
    nativeLocal.setItem(TOKEN_KEY, "alice-token");
    const { ready, reload } = await start();
    await ready;
    pagehide();
    log.length = 0;
    nativeLocal.setItem(TOKEN_KEY, "bob-token");
    pageshow();
    expect(document.body.style.getPropertyValue("display")).toBe("");
    expect(
      root.querySelector('[data-testid="notebook-account-changed"]'),
    ).not.toBeNull();
    expect(root.querySelector('[data-testid="fixture-editor"]')).toBeNull();
    expect(log.slice(0, 2)).toEqual(["pagehide", "unmount"]);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });
});

it.each([true, false])(
  "mounts the notebook analytics route with admin=%s",
  async (isAdmin) => {
    vi.stubEnv("BASE_URL", "/canvas/");
    const previous = location.pathname;
    try {
      history.replaceState(null, "", "/canvas/analytics");
      nativeLocal.setItem(TOKEN_KEY, "alice-token");
      const native = vi.fn<typeof fetch>(
        async () => new Response(null, { status: 503 }),
      );
      window.fetch = native;
      const { loadModules } = await start({
        identify: async () => ({
          kind: "user",
          user: {
            id: "alice",
            displayName: "Alice",
            role: isAdmin ? "admin" : "user",
            isAdmin,
            provider: "notebook",
          },
        }),
      });
      await vi.waitFor(() =>
        expect(root.textContent).toContain(
          isAdmin ? "User Analytics" : "Administrator access required",
        ),
      );
      expect(loadModules).not.toHaveBeenCalled();
      if (isAdmin) {
        await vi.waitFor(() => expect(native).toHaveBeenCalled());
        const request = native.mock.calls[0]?.[0];
        if (!(request instanceof Request))
          throw Error("Expected a scoped API request");
        expect(request.headers.get("Authorization")).toBe("Bearer alice-token");
        expect(new URL(request.url).pathname).toBe(
          "/canvas/api/admin/analytics/overview",
        );
      } else expect(native).not.toHaveBeenCalled();
    } finally {
      history.replaceState(null, "", previous);
      vi.unstubAllEnvs();
    }
  },
);
