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
  // the open delete confirmation must not carry over to that other Project.
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

  // A keyboard switch (click, no outside pointerdown) to Favorites hides Bias,
  // so its open menu must close with it.
  await press(
    container.querySelector<HTMLElement>('[data-testid="shelf-actions-bias"]')!,
  );
  expect(container.querySelector('[role="menu"]')).not.toBeNull();
  expect(filterButton("All").getAttribute("aria-pressed")).toBe("true");
  await press(filterButton("♥ Favorites"));
  expect(container.querySelector('[role="menu"]')).toBeNull();
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

it("edits project names inline on click or menu Rename, saving on blur and reverting on Escape or blank", async () => {
  const project = createEmptyProject("amp", "Amp");
  const summary = {
    id: "amp",
    name: "Amp",
    updatedAt: "2026-11-06T00:00:00Z",
    revision: 1,
    schemaVersion: project.schemaVersion,
    favorite: false,
  };
  const savedNames: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      if (url === "/api/projects/amp" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { name: string };
        savedNames.push(body.name);
        return Response.json({
          project: { ...summary, name: body.name, revision: 2 },
        });
      }
      if (url === "/api/projects/amp")
        return Response.json({
          project: { ...summary, projectText: serializeProject(project) },
        });
      return Response.json({ projects: [summary], limit: 200 });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(ShelfWall)));

  // Menu Rename activates the in-place title input; Escape cancels and restores focus.
  await act(async () =>
    container
      .querySelector<HTMLElement>('[data-testid="shelf-actions-amp"]')!
      .click(),
  );
  const rename = [
    ...container.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === "Rename")!;
  await act(async () => rename.click());
  const menuInput = container.querySelector<HTMLInputElement>(
    'input.shelf-tile-name-input[aria-label="Project name"]',
  )!;
  expect(menuInput).not.toBeNull();
  expect(container.querySelector("form.shelf-rename-form")).toBeNull();
  await act(async () => {
    menuInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(container.querySelector("input.shelf-tile-name-input")).toBeNull();
  expect(document.activeElement).toBe(
    container.querySelector('button[aria-label="Rename Amp"]'),
  );

  // Clicking the title directly edits inline; blank blur reverts without saving.
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Rename Amp"]')!
      .click(),
  );
  const blankInput = container.querySelector<HTMLInputElement>(
    "input.shelf-tile-name-input",
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(blankInput, "   ");
    blankInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => blankInput.blur());
  expect(savedNames).toEqual([]);
  expect(
    container.querySelector('button[aria-label="Rename Amp"]'),
  ).not.toBeNull();

  // Clicking the title, typing a new name, and blurring saves automatically.
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Rename Amp"]')!
      .click(),
  );
  const editInput = container.querySelector<HTMLInputElement>(
    "input.shelf-tile-name-input",
  )!;
  await act(async () => {
    setter.call(editInput, "LNA Stage");
    editInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => editInput.blur());
  expect(savedNames).toEqual(["LNA Stage"]);
  expect(
    container.querySelector('button[aria-label="Rename LNA Stage"]'),
  ).not.toBeNull();
});

it("preserves the typed rename draft on save failure so the user can retry or edit", async () => {
  const project = createEmptyProject("amp", "Amp");
  const summary = {
    id: "amp",
    name: "Amp",
    updatedAt: "2026-11-06T00:00:00Z",
    revision: 1,
    schemaVersion: project.schemaVersion,
    favorite: false,
  };
  let attempts = 0;
  const onOpenProject = vi.fn();
  const onRenameProject = vi.fn(async (_id: string, name: string) => {
    attempts += 1;
    if (attempts === 1) throw new Error("Temporary network error");
    summary.name = name;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      Response.json({ projects: [{ ...summary }], limit: 200 }),
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(createElement(ShelfWall, { onOpenProject, onRenameProject })),
  );

  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Rename Amp"]')!
      .click(),
  );
  const input = container.querySelector<HTMLInputElement>(
    "input.shelf-tile-name-input",
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, "Draft OTA");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.blur());

  // Error surfaces while keeping the typed draft enabled and focused.
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Temporary network error",
  );
  const preserved = container.querySelector<HTMLInputElement>(
    "input.shelf-tile-name-input",
  )!;
  expect(preserved).not.toBeNull();
  expect(preserved.value).toBe("Draft OTA");
  expect(preserved.disabled).toBe(false);
  expect(document.activeElement).toBe(preserved);

  // Blurring without editing does not re-fire the same failing request.
  await act(async () => preserved.blur());
  expect(onRenameProject).toHaveBeenCalledTimes(1);

  // After leaving the failed draft unfocused, clicking a tile still opens it.
  const tile = container.querySelector<HTMLButtonElement>(
    '[data-testid="shelf-tile-amp"]',
  )!;
  await act(async () => {
    tile.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    tile.click();
  });
  expect(onOpenProject).toHaveBeenCalledWith("amp");

  // Pressing Enter explicitly retries and succeeds.
  await act(async () => {
    preserved.focus();
    preserved.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(onRenameProject).toHaveBeenCalledTimes(2);
  expect(onRenameProject).toHaveBeenLastCalledWith("amp", "Draft OTA");
  expect(container.querySelector("input.shelf-tile-name-input")).toBeNull();
  expect(
    container.querySelector('button[aria-label="Rename Draft OTA"]'),
  ).not.toBeNull();
});

it("dismisses an open quick-delete confirmation on Escape even after focus moves outside it", async () => {
  const project = createEmptyProject("amp", "Amp");
  const summary = {
    id: "amp",
    name: "Amp",
    updatedAt: "2026-11-06T00:00:00Z",
    revision: 1,
    schemaVersion: project.schemaVersion,
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
      .querySelector<HTMLButtonElement>(
        '[data-testid="shelf-quick-delete-amp"]',
      )!
      .click(),
  );
  expect(
    container.querySelector('.shelf-tile-footer[data-confirming="true"]'),
  ).not.toBeNull();

  // Tab away from the confirmation controls to the search box, then press Escape.
  const search = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search cloud projects"]',
  )!;
  search.focus();
  const escape = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    search.dispatchEvent(escape);
  });
  expect(escape.defaultPrevented).toBe(true);
  expect(
    container.querySelector('.shelf-tile-footer[data-confirming="true"]'),
  ).toBeNull();
});

async function startFavoriteToggle(inFavorites = false) {
  const summary = {
    id: "bias",
    name: "Bias",
    updatedAt: "2026-11-06T00:00:00Z",
    revision: 1,
    schemaVersion: createEmptyProject("bias", "Bias").schemaVersion,
    favorite: inFavorites,
  };
  let finishPatch!: (response: Response) => void;
  const patch = new Promise<Response>((resolve) => {
    finishPatch = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_url, init) =>
      init?.method === "PATCH"
        ? patch
        : Response.json({
            projects: [
              { ...summary, id: "amp", name: "Amp", favorite: false },
              summary,
            ],
            limit: 200,
          }),
    ),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(ShelfWall)));

  const heart = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-testid="shelf-favorite-bias"]',
    );
  const filter = container.querySelector<HTMLButtonElement>(
    '[data-testid="shelf-filter-favorites"]',
  )!;
  if (inFavorites) await act(async () => filter.click());
  const button = heart()!;
  button.focus();
  await act(async () => button.click());
  expect(button.disabled).toBe(true);
  // jsdom can keep focus on a disabled button. Reproduce Chromium's blur.
  document.body.tabIndex = -1;
  document.body.focus();
  document.body.removeAttribute("tabindex");
  expect(document.activeElement).toBe(document.body);

  const settle = (
    response = Response.json({
      project: { ...summary, favorite: !inFavorites },
    }),
  ) => act(async () => finishPatch(response));
  return { heart, filter, settle };
}

it("restores focus to the enabled heart after it moves to the front of All", async () => {
  const { heart, settle } = await startFavoriteToggle();
  const firstHeart = () => container.querySelector(".shelf-tile-favorite");
  expect(firstHeart()).not.toBe(heart());
  await settle();
  expect(firstHeart()).toBe(heart());
  expect(heart()!.disabled).toBe(false);
  expect(document.activeElement).toBe(heart());
});

it("focuses the Favorites filter after the focused project's tile disappears", async () => {
  const { heart, filter, settle } = await startFavoriteToggle(true);
  await settle();
  expect(container.querySelector('[data-testid="shelf-tile-bias"]')).toBeNull();
  expect(heart()).toBeNull();
  expect(document.activeElement).toBe(filter);
});

it.each([false, true])(
  "preserves a subsequent focus change (control blurred: %s)",
  async (blur) => {
    const { filter, settle } = await startFavoriteToggle();
    filter.focus();
    if (blur) filter.blur();
    await settle();
    expect(document.activeElement).toBe(blur ? document.body : filter);
  },
);

it("restores focus to the enabled heart when the PATCH fails", async () => {
  const { heart, settle } = await startFavoriteToggle();
  await settle(new Response(null, { status: 500 }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "500",
  );
  expect(heart()!.disabled).toBe(false);
  expect(document.activeElement).toBe(heart());
});

it("filters by search, toggles grid/list views, and delegates open/rename/delete", async () => {
  const alpha = {
    id: "p-alpha",
    name: "Alpha Amp",
    updatedAt: "2026-11-06T00:00:00Z",
    revision: 2,
    schemaVersion: 1,
    favorite: true,
  };
  const beta = {
    id: "p-beta",
    name: "Beta Filter",
    updatedAt: "2026-11-05T00:00:00Z",
    revision: 1,
    schemaVersion: 1,
    favorite: false,
  };
  let serverProjects = [alpha, beta];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      Response.json({ projects: serverProjects, limit: 20 }),
    ),
  );
  const onOpenProject = vi.fn();
  const onRenameProject = vi.fn(async (id: string, name: string) => {
    serverProjects = serverProjects.map((p) =>
      p.id === id ? { ...p, name } : p,
    );
  });
  const onDeleteProject = vi.fn(async (id: string) => {
    serverProjects = serverProjects.filter((p) => p.id !== id);
  });

  if (typeof window.localStorage?.removeItem === "function")
    window.localStorage.removeItem("auto-canvas.cloud-projects-view.v1");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(ShelfWall, {
        onOpenProject,
        onRenameProject,
        onDeleteProject,
      }),
    ),
  );

  // Clicking a card invokes onOpenProject without full navigation.
  const alphaTile = container.querySelector<HTMLButtonElement>(
    '[data-testid="shelf-tile-p-alpha"]',
  );
  expect(alphaTile?.tagName).toBe("BUTTON");
  await act(async () => alphaTile!.click());
  expect(onOpenProject).toHaveBeenCalledWith("p-alpha");

  // Search filters projects live.
  const search = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search cloud projects"]',
  )!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(search, "Beta");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(
    container.querySelector('[data-testid="shelf-tile-p-alpha"]'),
  ).toBeNull();
  expect(
    container.querySelector('[data-testid="shelf-tile-p-beta"]'),
  ).not.toBeNull();

  // Clear search and switch to List view.
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!
      .click(),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="List view"]')!
      .click(),
  );
  expect(container.querySelector('[data-testid="shelf-list"]')).not.toBeNull();

  // Inline rename by clicking the title directly delegates to onRenameProject on Enter.
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Rename Alpha Amp"]',
      )!
      .click(),
  );
  const renameInput = container.querySelector<HTMLInputElement>(
    'input[aria-label="Project name"]',
  )!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(renameInput, "Alpha Renamed");
    renameInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    renameInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(onRenameProject).toHaveBeenCalledWith("p-alpha", "Alpha Renamed");
  expect(document.activeElement).toBe(
    container.querySelector('button[aria-label="Rename Alpha Renamed"]'),
  );

  // Clicking a tile while a rename input is focused blurs to save without opening the tile.
  onOpenProject.mockClear();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Rename Beta Filter"]',
      )!
      .click(),
  );
  const betaTile = container.querySelector<HTMLButtonElement>(
    '[data-testid="shelf-tile-p-beta"]',
  )!;
  await act(async () => {
    betaTile.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    container
      .querySelector<HTMLInputElement>('input[aria-label="Project name"]')!
      .blur();
    betaTile.click();
  });
  expect(onOpenProject).not.toHaveBeenCalled();

  // Cancelling rename with Escape restores focus to the title button.
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Rename Beta Filter"]',
      )!
      .click(),
  );
  const cancelInput = container.querySelector<HTMLInputElement>(
    'input[aria-label="Project name"]',
  )!;
  await act(async () => {
    cancelInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(document.activeElement).toBe(
    container.querySelector('button[aria-label="Rename Beta Filter"]'),
  );

  // Quick delete swaps the row action bar into Delete? Confirm / Cancel,
  // dismisses on outside click, and delegates to onDeleteProject on Confirm.
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="shelf-quick-delete-p-beta"]',
      )!
      .click(),
  );
  const confirmBar = container.querySelector(
    '.shelf-list-actions[data-confirming="true"]',
  );
  expect(confirmBar).not.toBeNull();
  const confirmButtons = [
    ...confirmBar!.querySelectorAll<HTMLButtonElement>(
      ".inline-confirm-actions button",
    ),
  ].map((button) => button.textContent);
  expect(confirmButtons).toEqual(["Confirm", "Cancel"]);
  expect(confirmBar!.querySelector(".inline-confirm-prompt")?.textContent).toBe(
    "Delete?",
  );
  // Outside pointerdown dismisses delete confirmation.
  await act(async () => {
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(
    container.querySelector('.shelf-list-actions[data-confirming="true"]'),
  ).toBeNull();

  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="shelf-quick-delete-p-beta"]',
      )!
      .click(),
  );
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Delete Beta Filter"] .inline-confirm-danger',
      )!
      .click(),
  );
  expect(onDeleteProject).toHaveBeenCalledWith("p-beta");
  expect(
    container.querySelector('[data-testid="shelf-tile-p-beta"]'),
  ).toBeNull();
});
