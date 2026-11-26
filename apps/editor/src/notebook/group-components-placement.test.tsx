// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import type { SharedComponent } from "@icm/component-library";
import { componentEditorPlacement } from "../app/component-editor-placement";
import type { EditorComponentEditorProps } from "../app/editor-component-editor";
import {
  planComponentPlacement,
  type PendingCircuitCapture,
  type ScopedComponentLibraryOrigin,
} from "../features/user-components/component-placement";
import { checkSharedComponentRevision } from "../features/user-components/component-library-client";
import type { PendingComponentPlacement } from "../interaction/interaction-state";
import { GroupComponentsPanel } from "./group-components-panel";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

if (!("fonts" in document)) {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.resolve(),
      addEventListener() {},
      removeEventListener() {},
    },
  });
}

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function makeScopedSymbolComponent() {
  const resistor = structuredClone(
    builtInSymbols.find((item) => item.id === "resistor")!,
  );
  resistor.id = "custom_grp_res";
  resistor.name = "GroupPolyR";
  const summary = {
    id: "gc-1",
    groupId: "grp-1",
    authorId: "u2",
    authorName: "Alice",
    sourceComponentId: "src-1",
    name: "GroupPolyR",
    description: "Matched poly resistor",
    status: "approved" as const,
    capability: "symbol-only",
    pinCount: resistor.pins.length,
    parameterCount: 0,
    symbol: resistor,
    reviewerId: "u1",
    reviewerName: "Admin",
    reviewNote: "",
    createdAt: "2026-11-26T00:00:00Z",
    updatedAt: "2026-11-26T00:00:00Z",
    reviewedAt: "2026-11-26T00:01:00Z",
  };
  const entry: SharedComponent = {
    id: "grp-gc-1",
    revision: 1,
    authorId: "u2",
    author: "Alice",
    status: "shared",
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    definition: { symbol: resistor },
  };
  return { summary, entry };
}

describe("scoped group/notebook component placement and safety", () => {
  it("completes the full select-and-place flow against the scoped endpoint without calling /api/components/:id", async () => {
    const { summary, entry } = makeScopedSymbolComponent();
    const requestedUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith("/api/notebook/groups")) {
          return Response.json({
            groups: [
              {
                id: "grp-1",
                name: "Analog Team",
                kind: "project",
                description: "",
                ownerId: "u1",
                myRole: "member",
                isAdmin: false,
                memberCount: 2,
              },
            ],
          });
        }
        if (
          url.includes("/api/notebook/groups/grp-1/components?status=approved")
        ) {
          return Response.json({
            group: { id: "grp-1", name: "Analog Team", isAdmin: false },
            components: [summary],
          });
        }
        if (url.endsWith("/api/notebook/groups/grp-1/components/gc-1")) {
          return Response.json({
            component: summary,
            entry,
          });
        }
        return Response.json({ error: "unexpected-route" }, { status: 404 });
      }),
    );

    const project = createEmptyProject("proj-1", "Test");
    const activeDocId = project.documents[0]!.id;
    let launchedRequest: PendingComponentPlacement | null = null;
    const editorCommands = {
      execute: vi.fn(
        (command: {
          id: string;
          launch?: { request?: PendingComponentPlacement };
        }) => {
          if (command.id === "insert.start" && command.launch?.request) {
            launchedRequest = command.launch.request;
          }
        },
      ),
    };
    const setStatus = vi.fn();
    const placement = componentEditorPlacement({
      returnToLibrary: { current: false },
      editorDocumentController: {
        project,
        activeDocumentId: activeDocId,
        offerComponentDefinition: vi.fn(),
      },
      synchronizeExternalCommit: vi.fn(),
      editorCommands,
      setStatus,
      definitionProjectRef: { current: { project, projectSessionId: "s1" } },
      resolver: createProjectSymbolResolver(project, builtInSymbols),
      onBeforePlace: vi.fn(),
      externalSubcircuitInsertCandidates: [],
    } as unknown as EditorComponentEditorProps & {
      returnToLibrary: { current: boolean };
    });

    const receivedScopes: ScopedComponentLibraryOrigin[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <GroupComponentsPanel
          initialGroupId="grp-1"
          onInsertComponent={async (selected, scope) => {
            receivedScopes.push(scope);
            await placement.insertSharedComponent(selected, scope);
          }}
        />,
      );
    });

    const placeButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("放置到画布"),
    );
    expect(placeButton).toBeTruthy();

    await act(async () => {
      placeButton!.click();
    });
    await vi.waitFor(() => {
      expect(editorCommands.execute).toHaveBeenCalled();
    });

    expect(setStatus).not.toHaveBeenCalled();
    expect(receivedScopes).toEqual([
      { kind: "group", scopeId: "grp-1", itemId: "gc-1", status: "approved" },
    ]);
    const capture = (launchedRequest as PendingComponentPlacement | null)
      ?.capture as PendingCircuitCapture | undefined;
    expect(capture?.library?.scope).toEqual(receivedScopes[0]);

    // Commit-time revalidation checks the scoped endpoint, never /api/components/:id.
    await expect(
      checkSharedComponentRevision(capture!.library!),
    ).resolves.toBeUndefined();

    // Planned placement commits cleanly onto the active schematic.
    const planned = planComponentPlacement(
      project,
      activeDocId,
      capture!.payload,
      capture!.identity,
      { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    );
    expect(planned.instance.symbolId).toBe("custom_grp_res");
    expect(requestedUrls.some((url) => url.includes("/api/components/"))).toBe(
      false,
    );
  });

  it("refuses to substitute another group when an inaccessible group deep link is opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/notebook/groups")) {
          return Response.json({
            groups: [
              {
                id: "grp-other",
                name: "Other Team",
                kind: "project",
                description: "",
                ownerId: "u1",
                myRole: "member",
                isAdmin: false,
                memberCount: 2,
              },
            ],
          });
        }
        return Response.json({ error: "unexpected" }, { status: 404 });
      }),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <GroupComponentsPanel
          initialGroupId="grp-deleted"
          onInsertComponent={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("链接指定的群组不可访问");
    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("");
    const publishButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("发布器件"),
    );
    expect(publishButton).toBeUndefined();
  });
});
