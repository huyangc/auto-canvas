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
  await action("Favorite");
  expect(count()).toContain("2 of 37 saved");
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
