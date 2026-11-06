import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { decodeCanvasPackage } from "./features/netlist-export/rnl-canvas-package";

/**
 * The static shell worker is plain script, not a module, so it is evaluated
 * here against a stub scope and driven through its own fetch listener. What
 * it decides to keep matters more than most caching: asset names carry a
 * content hash, so anything stored under one is stored under a promise that
 * the name will never mean anything else.
 */
type Listener = (event: {
  request: Request;
  respondWith(value: Promise<Response>): void;
  waitUntil(value: Promise<unknown>): void;
}) => void;

function loadWorker(
  fetchImpl: typeof fetch,
  openGate = Promise.resolve(),
  failStorage = false,
  base = "/",
) {
  const opened: string[] = [];
  const deleted: string[] = [];
  const existing = [
    "icm-static-shell-/canvas/:old",
    "icm-static-shell-/:notebook",
    "icm-static-shell-/other/:old",
    // A shell named before caches were scoped by path.
    "icm-static-shell-legacy-build",
  ];
  const listeners = new Map<string, Listener>();
  const stored = new Map<string, Response>();
  const cache = {
    match: (request: Request | URL) =>
      Promise.resolve(
        stored
          .get(
            new URL(request instanceof URL ? request.href : request.url)
              .pathname,
          )
          ?.clone(),
      ),
    put: (request: Request | URL, response: Response) => {
      if (failStorage) return Promise.reject(new Error("quota"));
      stored.set(
        new URL(request instanceof URL ? request.href : request.url).pathname,
        response,
      );
      return Promise.resolve();
    },
    addAll: () => Promise.resolve(),
  };
  const scope = {
    addEventListener: (name: string, listener: Listener) =>
      listeners.set(name, listener),
    registration: { scope: `https://analog-canvas.test${base}` },
  };
  const caches = {
    open: (name: string) => {
      opened.push(name);
      return openGate.then(() => cache);
    },
    keys: () => Promise.resolve(existing),
    match: (request: Request) => cache.match(request),
    delete: (name: string) => {
      deleted.push(name);
      return Promise.resolve(true);
    },
  };
  const source = readFileSync(
    resolve(process.cwd(), "apps/editor/public/sw.js"),
    "utf8",
  );
  new Function("self", "caches", "fetch", source)(scope, caches, fetchImpl);
  return { listeners, stored, opened, deleted };
}

async function requestScript(
  response: Response,
  destination: "script" | "worker" = "script",
): Promise<{ stored: Map<string, Response>; served: Response }> {
  const { listeners, stored } = loadWorker((() =>
    Promise.resolve(response)) as unknown as typeof fetch);
  const request = new Request("https://analog-canvas.test/assets/App-abc.js");
  Object.defineProperty(request, "destination", { value: destination });
  let served: Promise<Response> | null = null;
  const pending: Promise<unknown>[] = [];
  listeners.get("fetch")!({
    request,
    respondWith: (value) => {
      served = value;
    },
    waitUntil: (value) => {
      pending.push(value);
    },
  });
  const result = await served!;
  await Promise.all(pending);
  return { stored, served: result };
}

describe("static shell cache policy", () => {
  it("confines prefixed fetches, cache storage and activation to its scope", async () => {
    const { listeners, stored, opened, deleted } = loadWorker(
      (async () => new Response("asset")) as typeof fetch,
      Promise.resolve(),
      false,
      "/canvas/",
    );
    for (const path of [
      "/canvas/api/components/x/preview.svg",
      "/api/health",
      "/assets/notebook.js",
    ]) {
      let responded = false;
      const request = new Request(`https://analog-canvas.test${path}`);
      Object.defineProperty(request, "destination", { value: "image" });
      listeners.get("fetch")!({
        request,
        respondWith: () => {
          responded = true;
        },
        waitUntil: () => undefined,
      });
      expect(responded, path).toBe(false);
    }
    const request = new Request(
      "https://analog-canvas.test/canvas/assets/analog-canvas-extensions-abc.rnl",
    );
    let served!: Promise<Response>;
    const pending: Promise<unknown>[] = [];
    listeners.get("fetch")!({
      request,
      respondWith: (value) => {
        served = value;
      },
      waitUntil: (value) => {
        pending.push(value);
      },
    });
    expect(await (await served).text()).toBe("asset");
    await Promise.all(pending);
    expect(stored.has("/canvas/assets/analog-canvas-extensions-abc.rnl")).toBe(
      true,
    );
    expect(
      opened.every((key) => key.startsWith("icm-static-shell-/canvas/:")),
    ).toBe(true);
    listeners.get("activate")!({
      request,
      respondWith: () => undefined,
      waitUntil: (value) => {
        pending.push(value);
      },
    });
    await Promise.all(pending);
    expect(deleted).toEqual(["icm-static-shell-/canvas/:old"]);
  });

  it("removes the legacy unscoped shell only when the root worker activates", async () => {
    const pending: Promise<unknown>[] = [];
    const { listeners, deleted } = loadWorker(
      () => Promise.resolve(new Response("ok")),
      Promise.resolve(),
      false,
      "/",
    );
    listeners.get("activate")!({
      request: new Request("https://analog-canvas.test/"),
      respondWith: () => undefined,
      waitUntil: (value) => {
        pending.push(value);
      },
    });
    await Promise.all(pending);
    // The root worker drops its own old shell and the legacy name, never a
    // prefixed deployment's caches.
    expect(deleted.sort()).toEqual([
      "icm-static-shell-/:notebook",
      "icm-static-shell-legacy-build",
    ]);
  });

  it("refreshes a rejected Canvas package on reload and keeps a verified offline fallback", async () => {
    const valid = new Uint8Array(
      readFileSync(
        resolve(
          "apps/editor/src/features/netlist-export/analog-canvas-extensions-0.2.rnl",
        ),
      ),
    );
    let network: Uint8Array<ArrayBuffer> | null = new Uint8Array([
      ...valid,
      10,
    ]);
    const { listeners } = loadWorker((async () => {
      if (!network) throw new Error("offline");
      return new Response(network);
    }) as typeof fetch);
    const loadPackage = async () => {
      const request = new Request(
        "https://analog-canvas.test/assets/analog-canvas-extensions-abc.rnl",
        { cache: "reload" },
      );
      let served!: Promise<Response>;
      const pending: Promise<unknown>[] = [];
      listeners.get("fetch")!({
        request,
        respondWith: (value) => {
          served = value;
        },
        waitUntil: (value) => {
          pending.push(value);
        },
      });
      const response = await served;
      await Promise.all(pending);
      return decodeCanvasPackage(
        new Uint8Array(await response.arrayBuffer()),
        "0.2",
      );
    };
    await expect(loadPackage()).rejects.toThrow(
      /Canvas package SHA-256 mismatch/u,
    );
    network = valid;
    await expect(loadPackage()).resolves.toContain(
      '@PACKAGE(name="analog-canvas-extensions", version="0.2")',
    );
    network = null;
    await expect(loadPackage()).resolves.toContain(
      '@PACKAGE(name="analog-canvas-extensions", version="0.2")',
    );
  });

  it.each(["script", "navigate"])(
    "caches %s even when the browser consumes the body before storage opens",
    async (kind) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { listeners, stored } = loadWorker(
        (async () =>
          new Response("payload", {
            headers: {
              "content-type":
                kind === "script" ? "text/javascript" : "text/html",
            },
          })) as typeof fetch,
        gate,
      );
      const request = new Request(
        `https://analog-canvas.test/${kind === "script" ? "assets/App-abc.js" : "editor"}`,
      );
      Object.defineProperty(
        request,
        kind === "script" ? "destination" : "mode",
        { value: kind },
      );
      let served!: Promise<Response>;
      const pending: Promise<unknown>[] = [];
      listeners.get("fetch")!({
        request,
        respondWith: (value) => {
          served = value;
        },
        waitUntil: (value) => {
          pending.push(value);
        },
      });
      expect(await (await served).text()).toBe("payload");
      expect(stored.size).toBe(0);
      release();
      await Promise.all(pending);
      expect(pending).toHaveLength(1);
      expect(
        await stored
          .get(kind === "script" ? "/assets/App-abc.js" : "/")!
          .text(),
      ).toBe("payload");
    },
  );

  it("serves a valid response when storage fails without rejecting background work", async () => {
    const { listeners, stored } = loadWorker(
      (async () =>
        new Response("ok", {
          headers: { "content-type": "text/javascript" },
        })) as typeof fetch,
      Promise.resolve(),
      true,
    );
    const request = new Request("https://analog-canvas.test/assets/App-abc.js");
    Object.defineProperty(request, "destination", { value: "script" });
    let served!: Promise<Response>;
    const pending: Promise<unknown>[] = [];
    listeners.get("fetch")!({
      request,
      respondWith: (value) => {
        served = value;
      },
      waitUntil: (value) => {
        pending.push(value);
      },
    });
    expect(await (await served).text()).toBe("ok");
    await expect(Promise.all(pending)).resolves.toEqual([undefined]);
    expect(stored.size).toBe(0);
  });

  it.each(["script", "worker"] as const)(
    "keeps a %s that really is JavaScript",
    async (destination) => {
      const { stored } = await requestScript(
        new Response("export const a = 1;", {
          headers: { "content-type": "text/javascript" },
        }),
        destination,
      );
      expect(stored.has("/assets/App-abc.js")).toBe(true);
    },
  );

  it.each(["script", "worker"] as const)(
    "refuses to keep the app shell under a %s name",
    async (destination) => {
      // A single-page-application fallback answers a missing asset with the
      // shell at 200. Cached as a script, that name stays broken for as long as
      // the cache lives — long after the deploy that caused it.
      const { stored, served } = await requestScript(
        new Response("<!doctype html><html></html>", {
          headers: { "content-type": "text/html" },
        }),
        destination,
      );
      expect(stored.has("/assets/App-abc.js")).toBe(false);
      // The response is still passed through; only storing it is refused.
      expect(await served.text()).toContain("doctype");
    },
  );

  it("keeps nothing from a failed request", async () => {
    const { stored } = await requestScript(
      new Response("Not found: /assets/App-abc.js", {
        status: 404,
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(stored.has("/assets/App-abc.js")).toBe(false);
  });

  it("leaves Gallery preview APIs to their HTTP cache policy", () => {
    const { listeners, stored } = loadWorker((() =>
      Promise.reject(
        new Error("the service worker must not fetch an API itself"),
      )) as typeof fetch);
    const request = new Request(
      "https://analog-canvas.test/api/gallery/entry-1/preview.svg?v=2",
    );
    Object.defineProperty(request, "destination", { value: "image" });
    let responded = false;
    listeners.get("fetch")!({
      request,
      respondWith: () => {
        responded = true;
      },
      waitUntil: () => undefined,
    });
    expect(responded).toBe(false);
    expect(stored.size).toBe(0);
  });

  it.each([
    ["font", "/assets/DejaVuSans-abc.ttf"],
    ["Canvas package", "/assets/analog-canvas-extensions-abc.rnl"],
    ["RNL runtime", "/assets/rnl_runtime_wasm-abc.wasm"],
  ])("keeps a %s read with fetch()", async (_name, path) => {
    const fetched = (path: string) => {
      const { listeners, stored } = loadWorker(
        (async () =>
          new Response("ttf", {
            headers: { "content-type": "font/ttf" },
          })) as unknown as typeof fetch,
      );
      // A plain fetch() has no destination.
      const request = new Request(`https://analog-canvas.test${path}`);
      let served: Promise<Response> | null = null;
      const pending: Promise<unknown>[] = [];
      listeners.get("fetch")!({
        request,
        respondWith: (value) => {
          served = value;
        },
        waitUntil: (value) => {
          pending.push(value);
        },
      });
      return { stored, served, pending };
    };
    const asset = fetched(path);
    await asset.served;
    await Promise.all(asset.pending);
    expect(asset.stored.has(path)).toBe(true);
    // Any other plain fetch stays the page's own.
    expect(fetched("/assets/catalog-abc.json").served).toBeNull();
    expect(fetched("/assets/analog-canvas-extensions.rnl").served).toBeNull();
    expect(fetched("/private/user-package.rnl").served).toBeNull();
  });

  it("does not store an explicitly no-store static response", async () => {
    const { stored } = await requestScript(
      new Response("export const dynamic = true;", {
        headers: {
          "content-type": "text/javascript",
          "cache-control": "no-store",
        },
      }),
    );
    expect(stored.has("/assets/App-abc.js")).toBe(false);
  });
});
