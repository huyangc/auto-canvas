// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { ShelfWall } from "./shelf-wall";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

it("keeps the server limit in counts and duplicate failures after shelf mutations", async () => {
  const project = createEmptyProject("source", "Source");
  const summary = {
    id: "source",
    name: "Source",
    updatedAt: "2026-11-06T00:00:00Z",
    revision: 1,
    schemaVersion: project.schemaVersion,
    favorite: false,
  };
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === "PATCH")
      return Response.json({ project: { ...summary, favorite: true } });
    if (init?.method === "DELETE")
      return Response.json({ projects: [{ ...summary, favorite: true }] });
    if (init?.method === "POST")
      return Response.json({ error: "project-limit" }, { status: 409 });
    if (url === "/api/projects/source")
      return Response.json({
        project: { ...summary, projectText: serializeProject(project) },
      });
    return Response.json({
      projects: [summary, { ...summary, id: "other", name: "Other" }],
      limit: 37,
    });
  });
  vi.stubGlobal("fetch", transport);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(ShelfWall)));

  function count() {
    return container.querySelector('[data-testid="shelf-count"]')?.textContent;
  }
  async function click(selector: string) {
    const button = container.querySelector<HTMLButtonElement>(selector);
    expect(button).not.toBeNull();
    await act(async () => button!.click());
  }
  async function action(label: string) {
    await click('[data-testid="shelf-actions-source"]');
    const button = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === label);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }

  expect(count()).toContain("2 of 37 saved");
  await click('[data-testid="shelf-favorite-source"]');
  expect(count()).toContain("2 of 37 saved");
  // A keyboard activation of another tile's ••• fires no outside pointerdown:
  // the open "Really delete" must not carry over to that other Project.
  await click('[data-testid="shelf-actions-source"]');
  await click('[data-testid="shelf-delete-source"]');
  expect(
    container.querySelector(
      '[aria-label="Delete Source from your shelf"] .inline-confirm-danger',
    ),
  ).not.toBeNull();
  await click('[data-testid="shelf-actions-other"]');
  expect(
    container.querySelector(
      '[aria-label="Delete Other from your shelf"] .inline-confirm-danger',
    ),
  ).toBeNull();
  // Delete is one of the tile's ••• actions now, and still asks twice.
  await click('[data-testid="shelf-delete-other"]');
  await click(
    '[aria-label="Delete Other from your shelf"] .inline-confirm-danger',
  );
  expect(count()).toContain("1 of 37 saved");
  await action("Duplicate");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "37-Project limit",
  );
  expect(count()).toContain("1 of 37 saved");
});

it("toggles a favorite from the heart beside the name and filters the wall to favorites", async () => {
  const summary = (id: string, name: string) => ({
    id,
    name,
    updatedAt: "2026-11-06T00:00:00Z",
    revision: 1,
    schemaVersion: createEmptyProject(id, name).schemaVersion,
    favorite: false,
  });
  const projects = [summary("amp", "Amp"), summary("bias", "Bias")];
  const patches: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { favorite: boolean };
        patches.push([url, body]);
        return Response.json({
          project: { ...summary("amp", "Amp"), favorite: body.favorite },
        });
      }
      return Response.json({ projects, limit: 200 });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(ShelfWall)));

  const heart = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-testid="shelf-favorite-amp"]',
    )!;
  const tiles = () =>
    [
      ...container.querySelectorAll<HTMLElement>(
        "[data-testid^='shelf-tile-']",
      ),
    ].map((tile) => tile.dataset.testid);
  const press = async (element: HTMLElement) =>
    act(async () => element.click());
  const filterButton = (label: string) =>
    [
      ...container.querySelectorAll<HTMLButtonElement>(".shelf-filter button"),
    ].find((button) => button.textContent?.trim() === label)!;

  // The heart is the tile link's sibling, not interactive content inside it.
  expect(heart().closest("a")).toBeNull();
  expect(heart().getAttribute("aria-label")).toBe("Favorite Amp");
  expect(heart().getAttribute("aria-pressed")).toBe("false");
  expect(heart().textContent).toBe("♡");

  await press(heart());
  expect(patches).toEqual([["/api/projects/amp", { favorite: true }]]);
  expect(heart().getAttribute("aria-pressed")).toBe("true");
  expect(heart().textContent).toBe("♥");

  // The ••• menu no longer offers Favorite.
  await press(
    container.querySelector<HTMLElement>('[data-testid="shelf-actions-amp"]')!,
  );
  const items = [...container.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent,
  );
  expect(items).toContain("Rename");
  expect(items.some((item) => /favorite/iu.test(item ?? ""))).toBe(false);
  await press(
    container.querySelector<HTMLElement>('[data-testid="shelf-actions-amp"]')!,
  );

  expect(filterButton("All").getAttribute("aria-pressed")).toBe("true");
  await press(filterButton("♥ Favorites"));
  expect(filterButton("♥ Favorites").getAttribute("aria-pressed")).toBe("true");
  expect(tiles()).toEqual(["shelf-tile-amp"]);
  // The count still describes the whole shelf.
  expect(
    container.querySelector('[data-testid="shelf-count"]')?.textContent,
  ).toContain("2 of 200 saved");

  await press(heart());
  expect(patches[1]).toEqual(["/api/projects/amp", { favorite: false }]);
  expect(tiles()).toEqual([]);
  expect(
    container.querySelector('[data-testid="shelf-no-favorites"]')?.textContent,
  ).toBe("No favorites yet — click ♡ next to a circuit's name.");

  await press(filterButton("All"));
  expect(tiles().sort()).toEqual(["shelf-tile-amp", "shelf-tile-bias"]);
});

it("renames with a compact Save and Cancel under the name field", async () => {
  const summary = {
    id: "amp",
    name: "Amp",
    updatedAt: "2026-11-06T00:00:00Z",
    revision: 1,
    schemaVersion: createEmptyProject("amp", "Amp").schemaVersion,
    favorite: false,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      Response.json({ projects: [summary], limit: 200 }),
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(ShelfWall)));
  await act(async () =>
    container
      .querySelector<HTMLElement>('[data-testid="shelf-actions-amp"]')!
      .click(),
  );
  const rename = [
    ...container.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === "Rename")!;
  await act(async () => rename.click());
  const form = container.querySelector("form.shelf-rename-form")!;
  const buttons = [...form.querySelectorAll("button")].map((button) => [
    button.type,
    button.textContent,
  ]);
  expect(buttons).toEqual([
    ["submit", "Save"],
    ["button", "Cancel"],
  ]);
  await act(async () =>
    form.querySelectorAll<HTMLButtonElement>("button")[1]!.click(),
  );
  expect(container.querySelector("form.shelf-rename-form")).toBeNull();
});
