// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import type { ProjectWorkspace } from "../document/project-workspace";
import { workspaceRoute } from "../document/project-workspace";
import { libraryProjectExamples } from "../examples/library-examples";
import { createNetlistExportProfile } from "../features/netlist-export/netlist-process-presets";
import { prepareNetlistExample } from "../features/netlist-export/netlist-process";
import { openLibraryExample, useBootLink } from "./use-project-entry";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  window.history.replaceState(null, "", "/editor");
});

async function mount(
  overrides: Partial<Parameters<typeof useBootLink>[0]> = {},
) {
  const options: Parameters<typeof useBootLink>[0] = {
    restoredWorkspace: null,
    bootRequestsNewProject: false,
    preparedInitialProject: createEmptyProject("new", "Untitled"),
    setStatus: vi.fn(),
    restoreAfterRefresh: false,
    replaceActiveProject: vi.fn(),
    openCloudProjectById: vi.fn(),
    guardDirtyReplacement: vi.fn(async (_intent, perform) => {
      await perform(false);
      return false;
    }),
    netlistProfile: createNetlistExportProfile("sky130"),
    ...overrides,
  };
  function Harness() {
    useBootLink(options);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => {
    root!.render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
  });
  return options;
}

it.each(["sky130", "abstract"] as const)(
  "opens a cloned bundled example once with the selected %s defaults",
  async (profileId) => {
    window.history.replaceState(
      { saved: true },
      "",
      "/editor?example=common-source-amplifier&keep=1#drawing",
    );
    const example = libraryProjectExamples[0]!;
    const sourceBefore = structuredClone(example.project);
    const options = await mount({
      netlistProfile: createNetlistExportProfile(profileId),
    });
    expect(options.guardDirtyReplacement).toHaveBeenCalledOnce();
    expect(options.guardDirtyReplacement).toHaveBeenCalledWith(
      `Open ${example.name} example`,
      expect.any(Function),
    );
    expect(options.replaceActiveProject).toHaveBeenCalledExactlyOnceWith(
      prepareNetlistExample(sourceBefore, options.netlistProfile),
    );
    const opened = vi.mocked(options.replaceActiveProject).mock.calls[0]![0];
    expect(opened).not.toBe(example.project);
    expect(example.project).toEqual(sourceBefore);
    expect(options.setStatus).toHaveBeenCalledExactlyOnceWith(
      `Opened example: ${example.name}`,
    );
    expect(options.openCloudProjectById).not.toHaveBeenCalled();
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/editor?keep=1#drawing");
    expect(window.history.state).toEqual({ saved: true });
    expect(
      workspaceRoute("/editor?example=common-source-amplifier&keep=1"),
    ).toBe("/editor?keep=1");
  },
);

it("waits for the dirty replacement guard before opening or consuming the link", async () => {
  window.history.replaceState(
    null,
    "",
    "/editor?example=common-source-amplifier",
  );
  const options = await mount({ guardDirtyReplacement: vi.fn() });
  expect(options.replaceActiveProject).not.toHaveBeenCalled();
  expect(options.setStatus).not.toHaveBeenCalled();
  expect(window.location.search).toContain("example=");
  const perform = vi.mocked(options.guardDirtyReplacement).mock.calls[0]![1];
  await act(async () => perform(true));
  expect(options.replaceActiveProject).toHaveBeenCalledOnce();
  expect(options.setStatus).toHaveBeenCalledWith(
    "Opened example: Common-Source Amplifier",
  );
  expect(window.location.search).toBe("");
});

it.each(["unknown", ""])(
  "reports unknown example id %j without opening",
  async (id) => {
    window.history.replaceState(null, "", `/editor?example=${id}`);
    const options = await mount();
    expect(options.setStatus).toHaveBeenCalledWith(`Example not found: ${id}`);
    expect(options.guardDirtyReplacement).not.toHaveBeenCalled();
    expect(options.replaceActiveProject).not.toHaveBeenCalled();
    expect(options.openCloudProjectById).not.toHaveBeenCalled();
  },
);

it("keeps a restored workspace instead of opening the example", async () => {
  window.history.replaceState(
    null,
    "",
    "/editor?example=common-source-amplifier",
  );
  const restoredWorkspace: ProjectWorkspace = {
    version: 1,
    windowId: "window",
    url: "/editor",
    savedAt: 1,
    activeId: "active",
    tabs: [{ id: "active", session: {} }],
  };
  const options = await mount({ restoredWorkspace });
  expect(options.guardDirtyReplacement).not.toHaveBeenCalled();
  expect(options.replaceActiveProject).not.toHaveBeenCalled();
  expect(options.setStatus).not.toHaveBeenCalled();
});

it("opens an example from the empty card exactly as the link does", async () => {
  window.history.replaceState(null, "", "/editor?keep=1");
  const example = libraryProjectExamples[1]!;
  const options = {
    netlistProfile: createNetlistExportProfile("sky130"),
    guardDirtyReplacement: vi.fn(
      async (_intent: string, perform: (dirty: boolean) => unknown) => {
        await perform(false);
      },
    ),
    replaceActiveProject: vi.fn(),
    setStatus: vi.fn(),
  };
  openLibraryExample(
    example.id,
    options as unknown as Parameters<typeof openLibraryExample>[1],
  );
  await act(async () => {});
  expect(options.guardDirtyReplacement).toHaveBeenCalledWith(
    `Open ${example.name} example`,
    expect.any(Function),
  );
  expect(options.replaceActiveProject).toHaveBeenCalledExactlyOnceWith(
    prepareNetlistExample(
      structuredClone(example.project),
      options.netlistProfile,
    ),
  );
  expect(options.setStatus).toHaveBeenCalledExactlyOnceWith(
    `Opened example: ${example.name}`,
  );
  expect(window.location.search).toBe("?keep=1");
});
