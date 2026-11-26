// @vitest-environment jsdom
import { createEmptyProject, type SchematicDocument } from "@icm/model";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CellsRail } from "./cells-rail";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const base = createEmptyProject("cells-rail", "Rail").documents[0]!;
const imported = {} as NonNullable<SchematicDocument["importReference"]>;
const routed = [{}] as unknown as SchematicDocument["routes"];
const cellDocument = (
  id: string,
  name: string,
  extra: Partial<SchematicDocument> = {},
): SchematicDocument => ({ ...base, id, name, ...extra });

// One Cell per status, the top Cell listed last in the Project.
const refused = cellDocument("cell-refused", "chain", {
  importReference: imported,
  routes: routed,
});
const laidOut = cellDocument("cell-laid-out", "stage", {
  importReference: imported,
  routes: routed,
});
const asImported = cellDocument("cell-imported", "bias", {
  importReference: imported,
});
const top = cellDocument("cell-top", "top");
const documents = [refused, laidOut, asImported, top];
const reasons = new Map([["cell-refused", "more than 120 parts"]]);

function rail(onSelectDocument = vi.fn(), refusals = reasons) {
  return (
    <CellsRail
      documents={documents}
      topDocumentId="cell-top"
      activeDocumentId="cell-laid-out"
      refusalReason={(document) => refusals.get(document.id)}
      onSelectDocument={onSelectDocument}
    />
  );
}

describe("Cells rail", () => {
  it("lists every Cell, top first, with its status and the open Cell current", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(rail());
    const nav = host.querySelector("nav")!;
    expect(nav.getAttribute("aria-label")).toBe("Cell list");
    expect(nav.dataset.testid).toBe("cells-rail");
    const rows = [...nav.querySelectorAll("button")];
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      "cells-rail-cell-top",
      "cells-rail-cell-refused",
      "cells-rail-cell-laid-out",
      "cells-rail-cell-imported",
    ]);
    const status = (row: Element) =>
      row.querySelector(".cells-rail-status")!.textContent;
    // In order: a current refusal (over the chain's routes), routes, as
    // imported, and none of these (the top Cell).
    expect(rows.map(status)).toEqual([
      "not laid out",
      "not laid out",
      "laid out",
      "as imported",
    ]);
    expect(rows[0]!.textContent).toContain("top");
    // The reason is shown under its row and as the row's title.
    const reason = rows[1]!.querySelector(".cells-rail-reason")!;
    expect(reason.textContent).toBe("more than 120 parts");
    expect(rows[1]!.title).toContain("more than 120 parts");
    expect(rows[0]!.querySelector(".cells-rail-reason")).toBeNull();
    expect(
      rows.map((row) => row.getAttribute("aria-current") ?? "none"),
    ).toEqual(["none", "none", "true", "none"]);
  });

  it("shows a Cell without a current refusal by its drawing", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(rail(vi.fn(), new Map()));
    const chain = host.querySelector(
      '[data-testid="cells-rail-cell-refused"]',
    )!;
    expect(chain.querySelector(".cells-rail-status")!.textContent).toBe(
      "laid out",
    );
    expect(chain.querySelector(".cells-rail-reason")).toBeNull();
  });

  it("opens the clicked Cell", async () => {
    const onSelect = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(rail(onSelect)));
    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="cells-rail-cell-refused"]',
      )!
      .click();
    expect(onSelect).toHaveBeenCalledWith("cell-refused");
    await act(async () => root.unmount());
    host.remove();
  });

  it("offers a Manage… button in the header when onManageCells is provided", async () => {
    const onManageCells = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <CellsRail
          documents={documents}
          topDocumentId="cell-top"
          activeDocumentId="cell-laid-out"
          refusalReason={(document) => reasons.get(document.id)}
          onSelectDocument={vi.fn()}
          onManageCells={onManageCells}
        />,
      ),
    );
    const manage = host.querySelector<HTMLButtonElement>(
      '[data-testid="cells-rail-manage"]',
    )!;
    expect(manage.textContent).toBe("Manage…");
    manage.click();
    expect(onManageCells).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    host.remove();
  });
});
