import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeSessionEvents, startNotebookGate } from "./gate";
import type { GateScreen } from "./screens";
import { createScopedFetch } from "./scoped-fetch";
import { TOKEN_KEY, type Identification, type TokenRead } from "./session";

const ORIGIN = "https://notebook.example";
const ALICE: Identification = {
  kind: "user",
  user: {
    id: "alice",
    displayName: "Alice",
    provider: "notebook",
    role: "user",
    isAdmin: false,
  },
};
const BOB: Identification = {
  kind: "user",
  user: { ...ALICE.user, id: "bob", displayName: "Bob" },
} as Identification;

const flush = async () => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

interface HarnessOptions {
  /** settleStorage stays pending until the test settles it. */
  manualSettle?: boolean;
  /** Effects that throw when called. */
  throwing?: readonly string[];
}

/** The gate over fake effects that record what happened, in order. */
function harness(initial: TokenRead, options: HarnessOptions = {}) {
  let stored = initial;
  const log: string[] = [];
  const identifications: {
    token: string;
    settle: (result: Identification) => void;
    fail: (error: Error) => void;
  }[] = [];
  const loads: {
    resolve: (modules: { name: string }) => void;
    reject: (error: Error) => void;
  }[] = [];
  const screens: { screen: GateScreen; retry: (() => void) | undefined }[] = [];
  const nativeCalls: Request[] = [];
  const fetches: (typeof fetch)[] = [];
  const settles: (() => void)[] = [];
  let onChange: (() => void) | null = null;
  let onConceal: (() => void) | null = null;
  let onUnauthorized: (() => void) | null = null;
  const step = (name: string, entry = name) => {
    log.push(entry);
    if (options.throwing?.includes(name)) throw new Error(`${name} failed`);
  };

  startNotebookGate<{ name: string }>({
    subscribe: (listener, conceal) => {
      log.push("subscribe");
      onChange = listener;
      onConceal = conceal;
    },
    readToken: () => {
      log.push("read");
      return stored;
    },
    identify: (token) => {
      log.push(`identify ${token}`);
      return new Promise((settle, fail) =>
        identifications.push({ token, settle, fail }),
      );
    },
    loadApp: () => {
      log.push("load");
      return new Promise((resolve, reject) => loads.push({ resolve, reject }));
    },
    installStorage: (userId) => step("installStorage", `storage ${userId}`),
    installFetch: (token, unauthorized) => {
      log.push(`install ${token}`);
      onUnauthorized = unauthorized;
      const scoped = createScopedFetch({
        native: (async (request: Request) => {
          nativeCalls.push(request);
          return new Response("{}");
        }) as typeof fetch,
        token,
        origin: ORIGIN,
        apiPrefix: "/canvas/api/",
        onUnauthorized: unauthorized,
      });
      fetches.push(scoped.fetch);
      return () => {
        step("revoke", `revoke ${token}`);
        scoped.revoke();
      };
    },
    mountApp: (modules, token) => {
      log.push(`mount ${modules.name} ${token}`);
      if (modules.name === "broken") throw new Error("render failed");
      return () => step("unmount", `unmount ${token}`);
    },
    flushPage: () => step("flush"),
    purgeOutsideRoot: () => step("purge"),
    conceal: () => step("conceal"),
    reveal: () => step("reveal"),
    settleStorage: () => {
      step("settle");
      return options.manualSettle
        ? new Promise<void>((resolve) => settles.push(resolve))
        : Promise.resolve();
    },
    showScreen: (screen, retry) => {
      log.push(`screen ${screen}`);
      screens.push({ screen, retry });
      if (
        options.throwing?.includes("showScreen") &&
        screen === "account-changed"
      )
        throw new Error("screen failed");
    },
    reload: () => log.push("reload"),
  });

  return {
    log,
    screens,
    nativeCalls,
    fetches,
    identifications,
    loads,
    settles,
    set(next: TokenRead) {
      stored = next;
    },
    event() {
      onChange!();
    },
    conceal() {
      onConceal!();
    },
    unauthorized() {
      onUnauthorized!();
    },
    screen: () => screens.at(-1)!,
    count: (prefix: string) =>
      log.filter((entry) => entry.startsWith(prefix)).length,
    async identify(index: number, result: Identification) {
      identifications[index]!.settle(result);
      await flush();
    },
    async load(index: number, name = "editor") {
      loads[index]!.resolve({ name });
      await flush();
    },
  };
}

const token = (value: string): TokenRead => ({ kind: "token", token: value });

beforeEach(() => {
  vi.stubGlobal("document", { baseURI: `${ORIGIN}/canvas/` });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a run", () => {
  it("subscribes before the first token read and shows Loading first", () => {
    const gate = harness(token("alice"));
    expect(gate.log.slice(0, 4)).toEqual([
      "subscribe",
      "screen loading",
      "read",
      "identify alice",
    ]);
  });

  it("shows the signed-out screen without a token, loading nothing", () => {
    const gate = harness({ kind: "none" });
    expect(gate.screen().screen).toBe("signed-out");
    expect(gate.count("identify")).toBe(0);
    expect(gate.count("load")).toBe(0);
  });

  it("shows the error screen when storage is unreadable, loading nothing", () => {
    const gate = harness({ kind: "unreadable" });
    expect(gate.screen().screen).toBe("error");
    expect(gate.count("identify")).toBe(0);
    expect(gate.count("load")).toBe(0);
  });

  it("shows the signed-out screen when the server rejects the token", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, { kind: "signed-out" });
    expect(gate.screen().screen).toBe("signed-out");
    expect(gate.count("load")).toBe(0);
    expect(gate.count("install")).toBe(0);
  });

  it("shows the error screen with a working Retry when identification fails", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, { kind: "error" });
    expect(gate.screen().screen).toBe("error");
    expect(gate.count("load")).toBe(0);
    gate.screen().retry!();
    expect(gate.count("identify")).toBe(2);
    await gate.identify(1, ALICE);
    await gate.load(0);
    expect(gate.log.slice(-2)).toEqual(["install alice", "mount editor alice"]);
  });

  it("treats a rejected identification as an error", async () => {
    const gate = harness(token("alice"));
    gate.identifications[0]!.fail(new Error("boom"));
    await flush();
    expect(gate.screen().screen).toBe("error");
  });

  it("loads, re-reads, binds storage to the user, installs the fetch and mounts, in that order", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, ALICE);
    await gate.load(0);
    expect(gate.log).toEqual([
      "subscribe",
      "screen loading",
      "read",
      "identify alice",
      "load",
      "read",
      "storage alice",
      "install alice",
      "mount editor alice",
    ]);
    await gate.fetches[0]!("/canvas/api/projects");
    expect(gate.nativeCalls[0]!.headers.get("Authorization")).toBe(
      "Bearer alice",
    );
  });

  it("revokes the fetch and stops for good when mounting throws", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, ALICE);
    await gate.load(0, "broken");
    expect(gate.log.slice(-4)).toEqual([
      "install alice",
      "mount broken alice",
      "revoke alice",
      "screen error",
    ]);
    // No Retry: a document installs a fetch only once.
    expect(gate.screen().retry).toBeUndefined();
    await expect(gate.fetches[0]!("/canvas/api/projects")).rejects.toThrow();
    expect(gate.nativeCalls).toHaveLength(0);
    gate.set(token("bob"));
    gate.event();
    await flush();
    expect(gate.count("identify")).toBe(1);
    expect(gate.count("reload")).toBe(0);
  });

  it("asks for a reload, without Retry, when the editor modules fail to load", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, ALICE);
    gate.loads[0]!.reject(new Error("chunk missing"));
    await flush();
    expect(gate.screen().screen).toBe("error");
    // The same document may never load those modules again.
    expect(gate.screen().retry).toBeUndefined();
    expect(gate.count("install")).toBe(0);
    expect(gate.count("mount")).toBe(0);
    expect(gate.count("reload")).toBe(0);
  });
});

describe("a token change before the mount", () => {
  it("mounts only Bob's editor when Alice's load resolves after Bob's run", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, ALICE);
    expect(gate.loads).toHaveLength(1);
    gate.set(token("bob"));
    gate.event();
    await gate.identify(1, BOB);
    await gate.load(1, "bob-editor");
    await gate.load(0, "alice-editor");
    expect(gate.log.filter((entry) => /^(install|mount)/u.test(entry))).toEqual(
      ["install bob", "mount bob-editor bob"],
    );
    await gate.fetches[0]!("/canvas/api/projects");
    expect(gate.nativeCalls).toHaveLength(1);
    expect(gate.nativeCalls[0]!.headers.get("Authorization")).toBe(
      "Bearer bob",
    );
    expect(gate.count("storage")).toBe(1);
    expect(gate.log).toContain("storage bob");
    // A later change ends the page as after any mount.
    gate.set(token("carol"));
    gate.event();
    await flush();
    expect(gate.log.slice(-8)).toEqual([
      "revoke bob",
      "flush",
      "unmount bob",
      "purge",
      "reveal",
      "screen account-changed",
      "settle",
      "reload",
    ]);
  });

  it("shows the signed-out screen when the new token is gone, installing nothing", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, ALICE);
    gate.set({ kind: "none" });
    gate.event();
    expect(gate.screen().screen).toBe("signed-out");
    await gate.load(0);
    expect(gate.count("install")).toBe(0);
    expect(gate.count("mount")).toBe(0);
    expect(gate.screen().screen).toBe("signed-out");
  });

  it("re-reads before the commit even when no event is delivered", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, ALICE);
    gate.set(token("bob"));
    await gate.load(0, "alice-editor");
    expect(gate.count("install")).toBe(0);
    expect(gate.count("mount")).toBe(0);
    expect(gate.identifications.map(({ token }) => token)).toEqual([
      "alice",
      "bob",
    ]);
    await gate.identify(1, BOB);
    await gate.load(1, "bob-editor");
    expect(gate.log.filter((entry) => /^(install|mount)/u.test(entry))).toEqual(
      ["install bob", "mount bob-editor bob"],
    );
  });

  it("ignores a stale load rejection", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, ALICE);
    gate.set(token("bob"));
    gate.event();
    gate.loads[0]!.reject(new Error("late"));
    await flush();
    expect(gate.screen().screen).toBe("loading");
    await gate.identify(1, BOB);
    await gate.load(1);
    expect(gate.count("mount")).toBe(1);
  });

  it("ignores a stale identification", async () => {
    const gate = harness(token("alice"));
    gate.set(token("bob"));
    gate.event();
    await gate.identify(0, ALICE);
    expect(gate.count("load")).toBe(0);
    await gate.identify(1, BOB);
    await gate.load(0);
    expect(gate.log.filter((entry) => /^(install|mount)/u.test(entry))).toEqual(
      ["install bob", "mount editor bob"],
    );
  });

  it("starts a run when a token appears on the signed-out screen", async () => {
    const gate = harness({ kind: "none" });
    gate.event();
    expect(gate.count("identify")).toBe(0);
    gate.set(token("alice"));
    gate.event();
    expect(gate.count("identify")).toBe(1);
  });
});

describe("after the mount", () => {
  async function mounted(options: HarnessOptions = {}) {
    const gate = harness(token("alice"), options);
    await gate.identify(0, ALICE);
    await gate.load(0);
    return gate;
  }
  const ending = [
    "revoke alice",
    "flush",
    "unmount alice",
    "purge",
    "reveal",
    "screen account-changed",
    "settle",
  ];

  it("does nothing on an event with the same token", async () => {
    const gate = await mounted();
    const before = gate.log.length;
    gate.event();
    gate.event();
    expect(gate.log.slice(before)).toEqual(["read", "read"]);
  });

  for (const [name, next] of [
    ["changed", token("bob")],
    ["missing", { kind: "none" }],
    ["unreadable", { kind: "unreadable" }],
  ] as const)
    it(`revokes, flushes, unmounts, shows the screen, settles and reloads once for a ${name} token`, async () => {
      const gate = await mounted();
      gate.set(next);
      gate.event();
      expect(gate.log.slice(-ending.length)).toEqual(ending);
      gate.event();
      gate.unauthorized();
      await flush();
      expect(gate.log.slice(-ending.length - 1)).toEqual([...ending, "reload"]);
      expect(gate.count("reload")).toBe(1);
      expect(gate.count("revoke")).toBe(1);
      await expect(gate.fetches[0]!("/canvas/api/projects")).rejects.toThrow();
      expect(gate.nativeCalls).toHaveLength(0);
    });

  it("ends the page on a 401 even with the same token", async () => {
    const gate = await mounted();
    gate.unauthorized();
    expect(gate.log.slice(-ending.length)).toEqual(ending);
    gate.unauthorized();
    gate.set(token("bob"));
    gate.event();
    await flush();
    expect(gate.count("reload")).toBe(1);
  });

  it("reloads only once the storage has settled, and nothing restarts meanwhile", async () => {
    const gate = harness(token("alice"), { manualSettle: true });
    await gate.identify(0, { kind: "error" });
    const retry = gate.screen().retry!;
    retry();
    await gate.identify(1, ALICE);
    await gate.load(0);
    gate.set(token("bob"));
    gate.event();
    expect(gate.log.slice(-ending.length)).toEqual(ending);
    const before = gate.log.length;
    // While the writes settle: another change, a late 401, a Retry.
    gate.event();
    gate.unauthorized();
    retry();
    await flush();
    expect(gate.log.length).toBe(before);
    expect(gate.count("reload")).toBe(0);
    gate.settles[0]!();
    await flush();
    expect(gate.log.slice(before)).toEqual(["reload"]);
    expect(gate.count("identify")).toBe(2);
    expect(gate.count("mount")).toBe(1);
  });

  for (const failing of [
    "revoke",
    "flush",
    "unmount",
    "purge",
    "reveal",
    "showScreen",
    "settle",
  ])
    it(`still runs every later step and reloads once when ${failing} throws`, async () => {
      const gate = await mounted({ throwing: [failing] });
      gate.set(token("bob"));
      gate.event();
      await flush();
      expect(gate.log.slice(-ending.length - 1)).toEqual([...ending, "reload"]);
      gate.event();
      gate.unauthorized();
      await flush();
      expect(gate.count("reload")).toBe(1);
    });

  it("ignores a Retry clicked after an account change", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, { kind: "error" });
    const staleRetry = gate.screen().retry!;
    gate.screen().retry!();
    await gate.identify(1, ALICE);
    await gate.load(0);
    gate.set(token("bob"));
    gate.event();
    await flush();
    const before = gate.log.length;
    staleRetry();
    await flush();
    expect(gate.log.length).toBe(before);
    expect(gate.count("install")).toBe(1);
  });

  it("ignores a Retry while mounted", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, { kind: "error" });
    const retry = gate.screen().retry!;
    retry();
    await gate.identify(1, ALICE);
    await gate.load(0);
    const before = gate.log.length;
    retry();
    expect(gate.log.length).toBe(before);
  });
});

describe("binding storage to the user", () => {
  it("binds Bob's storage only, once, when Alice's run is superseded before its commit", async () => {
    const gate = harness(token("alice"));
    await gate.identify(0, ALICE);
    gate.set(token("bob"));
    gate.event();
    await gate.identify(1, BOB);
    await gate.load(0, "alice-editor");
    await gate.load(1, "bob-editor");
    expect(
      gate.log.filter((entry) => /^(storage|install|mount)/u.test(entry)),
    ).toEqual(["storage bob", "install bob", "mount bob-editor bob"]);
  });

  it("ends for good without a fetch, a mount or a Retry when the storage cannot be bound", async () => {
    const gate = harness(token("alice"), { throwing: ["installStorage"] });
    await gate.identify(0, ALICE);
    await gate.load(0);
    expect(gate.log.slice(-2)).toEqual(["storage alice", "screen error"]);
    expect(gate.screen().retry).toBeUndefined();
    expect(gate.count("install")).toBe(0);
    expect(gate.count("mount")).toBe(0);
    const before = gate.log.length;
    gate.set(token("bob"));
    gate.event();
    await flush();
    expect(gate.log.length).toBe(before);
  });
});

describe("the back/forward cache", () => {
  async function mounted() {
    const gate = harness(token("alice"));
    await gate.identify(0, ALICE);
    await gate.load(0);
    return gate;
  }

  it("conceals a mounted page and reveals it when the session is unchanged", async () => {
    const gate = await mounted();
    gate.conceal();
    expect(gate.log.at(-1)).toBe("conceal");
    gate.event();
    expect(gate.log.slice(-2)).toEqual(["read", "reveal"]);
    // Revealed once: a later event with the same token does nothing more.
    gate.event();
    expect(gate.log.at(-1)).toBe("read");
    expect(gate.count("unmount")).toBe(0);
    expect(gate.count("reload")).toBe(0);
  });

  it("ends a concealed page whose session changed, revealing only after the unmount", async () => {
    const gate = await mounted();
    gate.conceal();
    gate.set(token("bob"));
    gate.event();
    await flush();
    const unmount = gate.log.indexOf("unmount alice");
    const reveal = gate.log.indexOf("reveal");
    expect(unmount).toBeGreaterThan(gate.log.indexOf("conceal"));
    expect(reveal).toBeGreaterThan(unmount);
    expect(gate.count("reveal")).toBe(1);
    expect(gate.count("reload")).toBe(1);
  });

  it("does not conceal a page with no editor mounted", async () => {
    const gate = harness(token("alice"));
    gate.conceal();
    await gate.identify(0, { kind: "error" });
    gate.conceal();
    expect(gate.count("conceal")).toBe(0);
  });

  it("does not conceal a page that has ended", async () => {
    const gate = await mounted();
    gate.set(token("bob"));
    gate.event();
    gate.conceal();
    expect(gate.count("conceal")).toBe(0);
  });
});

describe("observeSessionEvents", () => {
  function page(visibility: DocumentVisibilityState = "visible") {
    const target = new EventTarget();
    const document = Object.assign(new EventTarget(), {
      visibilityState: visibility,
    });
    return Object.assign(target, { document }) as unknown as Window & {
      document: EventTarget & { visibilityState: DocumentVisibilityState };
    };
  }
  const storage = (key: string | null) =>
    Object.assign(new Event("storage"), { key });
  const pageshow = (persisted: boolean) =>
    Object.assign(new Event("pageshow"), { persisted });
  const pagehide = (persisted: boolean) =>
    Object.assign(new Event("pagehide"), { persisted });

  it("reports the token key, a cleared storage, focus, a visible page and a restored page", () => {
    const window = page();
    const onChange = vi.fn();
    observeSessionEvents(window, onChange);
    window.dispatchEvent(storage(TOKEN_KEY));
    window.dispatchEvent(storage(null));
    window.dispatchEvent(new Event("focus"));
    window.document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(pageshow(true));
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it("ignores other keys, a hidden page and an ordinary page load", () => {
    const window = page("hidden");
    const onChange = vi.fn();
    observeSessionEvents(window, onChange);
    window.dispatchEvent(storage("theme"));
    window.document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(pageshow(false));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports a page entering the back/forward cache, not an ordinary or synthetic page hide", () => {
    const window = page();
    const onChange = vi.fn();
    const onConceal = vi.fn();
    observeSessionEvents(window, onChange, onConceal);
    window.dispatchEvent(pagehide(false));
    expect(onConceal).not.toHaveBeenCalled();
    window.dispatchEvent(pagehide(true));
    expect(onConceal).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
