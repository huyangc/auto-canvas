// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VersionHistorySource } from "../components/version-history-dialog";

// The version-history dialog as the notebook build renders it: the preview
// cell of each row always holds one element.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLElement;
let preview: PromiseWithResolvers<Response>;

beforeEach(() => {
  vi.stubEnv("ICM_NOTEBOOK", "true");
  vi.stubGlobal("IntersectionObserver", undefined);
  preview = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", () => preview.promise);
  HTMLDialogElement.prototype.showModal ??= function showModal() {};
  HTMLDialogElement.prototype.close ??= function close() {};
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test/1");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderDialog() {
  vi.resetModules();
  const { VersionHistoryDialog } =
    await import("../components/version-history-dialog");
  const source = {
    currentLabel: "Current",
    loadVersions: async () => [
      {
        versionId: "v1",
        versionNo: 1,
        name: "First",
        author: "Ann",
        tags: [],
        createdAt: "2026-11-22T00:00:00.000Z",
      },
    ],
    previewUrl: (id: string) => `/canvas/api/versions/${id}/preview.png`,
  } as unknown as VersionHistorySource;
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <VersionHistoryDialog
        source={source}
        entryId="e1"
        entryName="Entry"
        onRestored={() => {}}
        onClose={() => {}}
      />,
    ),
  );
}

/** The first element of the version's row, the preview cell. */
async function previewCell() {
  let row: Element | null = null;
  await vi.waitFor(() => {
    row = container.querySelector('[data-testid="version-1"]');
    expect(row).not.toBeNull();
  });
  return row!.firstElementChild!;
}

it("holds the preview cell with an <img> while loading and after a failure", async () => {
  await renderDialog();
  const loading = await previewCell();
  expect(loading.tagName).toBe("IMG");
  expect(loading.hasAttribute("src")).toBe(false);
  await act(async () =>
    preview.resolve(new Response("missing", { status: 404 })),
  );
  const failed = await previewCell();
  expect(failed.tagName).toBe("IMG");
  expect(failed.hasAttribute("src")).toBe(false);
  expect(failed.nextElementSibling!.className).toBe("version-copy");
});

it("shows the fetched preview in the same cell", async () => {
  await renderDialog();
  await act(async () =>
    preview.resolve(new Response(new Blob(["png"]), { status: 200 })),
  );
  await vi.waitFor(async () =>
    expect((await previewCell()).getAttribute("src")).toBe("blob:test/1"),
  );
  const image = await previewCell();
  expect(image.getAttribute("alt")).toBe("Version 1 preview");
  expect(image.getAttribute("loading")).toBe("lazy");
});
