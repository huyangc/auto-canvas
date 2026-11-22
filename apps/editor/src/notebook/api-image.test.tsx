// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiImage } from "./api-image";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLElement;
let pending: Map<string, PromiseWithResolvers<Response>>;
let created: string[];
let revoked: string[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  pending = new Map();
  created = [];
  revoked = [];
  vi.stubGlobal("fetch", (input: string) => {
    const deferred = Promise.withResolvers<Response>();
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

it("renders nothing while loading, then the image from an object URL", async () => {
  await render(<ApiImage src="/canvas/api/a.png" alt="A" loading="lazy" />);
  expect(container.innerHTML).toBe("");
  await answer("/canvas/api/a.png", png());
  const image = container.querySelector("img")!;
  expect(image.getAttribute("src")).toBe("blob:test/1");
  expect(image.getAttribute("alt")).toBe("A");
  expect(image.getAttribute("loading")).toBe("lazy");
});

it("calls onError and renders nothing for a non-OK response", async () => {
  const onError = vi.fn();
  await render(<ApiImage src="/canvas/api/a.png" alt="A" onError={onError} />);
  await answer("/canvas/api/a.png", new Response("no", { status: 404 }));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(container.innerHTML).toBe("");
  expect(created).toEqual([]);
});

it("calls onError for a network error", async () => {
  const onError = vi.fn();
  await render(<ApiImage src="/canvas/api/a.png" alt="A" onError={onError} />);
  await answer("/canvas/api/a.png", new TypeError("Failed to fetch"));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(container.innerHTML).toBe("");
});

it("discards a result that arrives after src changed", async () => {
  await render(<ApiImage src="/canvas/api/a.png" alt="A" />);
  await render(<ApiImage src="/canvas/api/b.png" alt="B" />);
  await answer("/canvas/api/a.png", png());
  expect(container.innerHTML).toBe("");
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
  expect(container.innerHTML).toBe("");
});

it("revokes the URL it replaced and every URL on unmount", async () => {
  await render(<ApiImage src="/canvas/api/a.png" alt="A" />);
  await answer("/canvas/api/a.png", png());
  await render(<ApiImage src="/canvas/api/b.png" alt="B" />);
  expect(revoked).toEqual(["blob:test/1"]);
  expect(container.innerHTML).toBe("");
  await answer("/canvas/api/b.png", png());
  await act(async () => root!.unmount());
  root = undefined;
  expect(revoked).toEqual(["blob:test/1", "blob:test/2"]);
  expect(created).toEqual(["blob:test/1", "blob:test/2"]);
});
