// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiImage } from "./api-image";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLElement;
let pending: Map<string, PromiseWithResolvers<Response>>;
let requested: string[];
let created: string[];
let revoked: string[];

/** A stand-in for the browser's IntersectionObserver, driven by the test. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** The observed element comes near the viewport (or not). */
  async report(isIntersecting: boolean) {
    await act(async () =>
      this.callback(
        this.observed.map(
          (target) => ({ target, isIntersecting }) as IntersectionObserverEntry,
        ),
        this as unknown as IntersectionObserver,
      ),
    );
  }
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  pending = new Map();
  requested = [];
  created = [];
  revoked = [];
  FakeObserver.instances = [];
  // jsdom has none; tests that want one install FakeObserver.
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("fetch", (input: string) => {
    const deferred = Promise.withResolvers<Response>();
    requested.push(input);
    pending.set(input, deferred);
    return deferred.promise;
  });
  let next = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:test/${(next += 1)}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    revoked.push(url);
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(element: React.ReactElement) {
  root ??= createRoot(container);
  await act(async () => root!.render(element));
}

async function answer(src: string, response: Response | Error) {
  await act(async () => {
    const deferred = pending.get(src)!;
    if (response instanceof Error) deferred.reject(response);
    else deferred.resolve(response);
  });
}

const png = () =>
  new Response(new Blob(["png"], { type: "image/png" }), { status: 200 });

/** One <img> with no source holds the image's place. */
function expectPlaceholder(): HTMLImageElement {
  expect(container.children).toHaveLength(1);
  const image = container.querySelector("img")!;
  expect(image).not.toBeNull();
  expect(image.hasAttribute("src")).toBe(false);
  expect(image.getAttribute("alt")).toBe("");
  expect(image.getAttribute("aria-hidden")).toBe("true");
  return image;
}

it("gives the placeholder the image's own attributes", async () => {
  await render(
    <ApiImage
      src="/canvas/api/a.png"
      alt="A"
      className="preview"
      width={300}
      height={200}
    />,
  );
  const image = expectPlaceholder();
  expect(image.getAttribute("class")).toBe("preview");
  expect(image.getAttribute("width")).toBe("300");
  expect(image.getAttribute("height")).toBe("200");
});

it("defers a lazy image's fetch until it is near the viewport", async () => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  await render(<ApiImage src="/canvas/api/a.png" alt="A" loading="lazy" />);
  const placeholder = expectPlaceholder();
  expect(requested).toEqual([]);
  expect(FakeObserver.instances).toHaveLength(1);
  const [observer] = FakeObserver.instances;
  expect(observer!.observed).toEqual([placeholder]);
  expect(observer!.options?.rootMargin).toBe("100% 0px");
  await observer!.report(false);
  expect(requested).toEqual([]);
  await observer!.report(true);
  expect(requested).toEqual(["/canvas/api/a.png"]);
  expect(observer!.disconnected).toBe(true);
  // A second report after the fetch started requests nothing more.
  await observer!.report(true);
  expect(requested).toEqual(["/canvas/api/a.png"]);
  await answer("/canvas/api/a.png", png());
  expect(container.querySelector("img")!.getAttribute("src")).toBe(
    "blob:test/1",
  );
});

it("never fetches a lazy image unmounted before it came near the viewport", async () => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  await render(<ApiImage src="/canvas/api/a.png" alt="A" loading="lazy" />);
  const [observer] = FakeObserver.instances;
  await act(async () => root!.unmount());
  root = undefined;
  expect(observer!.disconnected).toBe(true);
  await observer!.report(true);
  expect(requested).toEqual([]);
});

it("fetches an eager image at once even where IntersectionObserver exists", async () => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  await render(<ApiImage src="/canvas/api/a.png" alt="A" />);
  expect(requested).toEqual(["/canvas/api/a.png"]);
  expect(FakeObserver.instances).toEqual([]);
});

it("fetches a lazy image at once without IntersectionObserver", async () => {
  await render(<ApiImage src="/canvas/api/a.png" alt="A" loading="lazy" />);
  expect(requested).toEqual(["/canvas/api/a.png"]);
});

it("renders a placeholder while loading, then the image from an object URL", async () => {
  await render(<ApiImage src="/canvas/api/a.png" alt="A" loading="lazy" />);
  expectPlaceholder();
  await answer("/canvas/api/a.png", png());
  const image = container.querySelector("img")!;
  expect(image.getAttribute("src")).toBe("blob:test/1");
  expect(image.getAttribute("alt")).toBe("A");
  expect(image.getAttribute("loading")).toBe("lazy");
});

it("calls onError and keeps the placeholder for a non-OK response", async () => {
  const onError = vi.fn();
  await render(<ApiImage src="/canvas/api/a.png" alt="A" onError={onError} />);
  await answer("/canvas/api/a.png", new Response("no", { status: 404 }));
  expect(onError).toHaveBeenCalledTimes(1);
  expectPlaceholder();
  expect(created).toEqual([]);
});

it("calls onError for a network error", async () => {
  const onError = vi.fn();
  await render(<ApiImage src="/canvas/api/a.png" alt="A" onError={onError} />);
  await answer("/canvas/api/a.png", new TypeError("Failed to fetch"));
  expect(onError).toHaveBeenCalledTimes(1);
  expectPlaceholder();
});

it("discards a result that arrives after src changed", async () => {
  await render(<ApiImage src="/canvas/api/a.png" alt="A" />);
  await render(<ApiImage src="/canvas/api/b.png" alt="B" />);
  await answer("/canvas/api/a.png", png());
  expectPlaceholder();
  // A response for an old src is not even read into an object URL.
  expect(created).toEqual([]);
  await answer("/canvas/api/b.png", png());
  expect(container.querySelector("img")!.getAttribute("src")).toBe(
    "blob:test/1",
  );
});

it("revokes the URL of a body that finished after src changed", async () => {
  await render(<ApiImage src="/canvas/api/a.png" alt="A" />);
  const body = Promise.withResolvers<Blob>();
  await answer("/canvas/api/a.png", {
    ok: true,
    status: 200,
    blob: () => body.promise,
  } as unknown as Response);
  await render(<ApiImage src="/canvas/api/b.png" alt="B" />);
  await act(async () => body.resolve(new Blob(["png"])));
  expect(created).toEqual(["blob:test/1"]);
  expect(revoked).toEqual(["blob:test/1"]);
  expectPlaceholder();
});

it("revokes the URL it replaced and every URL on unmount", async () => {
  await render(<ApiImage src="/canvas/api/a.png" alt="A" />);
  await answer("/canvas/api/a.png", png());
  await render(<ApiImage src="/canvas/api/b.png" alt="B" />);
  expect(revoked).toEqual(["blob:test/1"]);
  expectPlaceholder();
  await answer("/canvas/api/b.png", png());
  await act(async () => root!.unmount());
  root = undefined;
  expect(revoked).toEqual(["blob:test/1", "blob:test/2"]);
  expect(created).toEqual(["blob:test/1", "blob:test/2"]);
});
