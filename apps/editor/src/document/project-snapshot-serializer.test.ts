import { describe, expect, it, vi } from "vitest";
import {
  createSimulationFolder,
  createEmptyDocument,
  createEmptyProject,
  freezeSnapshot,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { EditorDocumentController } from "./document-controller";
import { createProjectSnapshotSerializer } from "./project-snapshot-serializer";

describe("committed project serialization reuse", () => {
  it("does not reuse stale text when a mutable caller changes the same object", () => {
    const project = createEmptyProject("mutable", "Before");
    const cache = createProjectSnapshotSerializer();
    cache.serialize(project);
    project.name = "After";
    expect(cache.serialize(project)).toBe(serializeProject(project));
    project.documents[0]!.instances.push({
      id: "invalid",
      symbolId: "resistor",
      placement: { position: { x: NaN, y: 0 }, rotation: 0, mirror: "none" },
    });
    expect(() => cache.serialize(project)).toThrow();
  });
  it("serializes unchanged tabs once and leaves changed snapshots byte-identical", () => {
    const serialize = vi.fn(serializeProject);
    const cache = createProjectSnapshotSerializer(serialize);
    const first = new EditorDocumentController(
      createEmptyProject("same-id", "First"),
    );
    const second = new EditorDocumentController(
      createEmptyProject("same-id", "Second"),
    );
    const save = () => [first, second].map((c) => cache.serialize(c.project));
    const original = save();
    expect(save()).toEqual(original);
    expect(serialize).toHaveBeenCalledTimes(2);
    first.transact([
      {
        kind: "add_instance",
        instance: { id: "R1", symbolId: "resistor", placement: null },
      },
    ]);
    const edited = save();
    expect(edited).toEqual(
      [first, second].map((c) => serializeProject(c.project)),
    );
    expect(edited[0]).not.toBe(original[0]);
    expect(serialize).toHaveBeenCalledTimes(3);
    first.transact([{ kind: "undo" }]);
    expect(save()[0]).toBe(serializeProject(first.project));
    first.transact([{ kind: "redo" }]);
    expect(save()[0]).toBe(serializeProject(first.project));
    expect(serialize).toHaveBeenCalledTimes(5);
  });

  it("does not confuse inactive Cell edits, project replacements or equal revisions", () => {
    const input = createEmptyProject("hierarchy", "Hierarchy");
    input.documents.push(createEmptyDocument("child", "Child"));
    const controller = new EditorDocumentController(input);
    const serialize = vi.fn(serializeProject);
    const cache = createProjectSnapshotSerializer(serialize);
    const before = cache.serialize(controller.project);
    controller.openDocument("child");
    expect(cache.serialize(controller.project)).toBe(before);
    controller.transact([
      {
        kind: "add_instance",
        instance: { id: "Rchild", symbolId: "resistor", placement: null },
      },
    ]);
    controller.openDocument(input.topDocumentId);
    expect(cache.serialize(controller.project)).toBe(
      serializeProject(controller.project),
    );
    expect(cache.serialize(controller.project)).not.toBe(before);
    controller.replaceProject({ ...controller.project, name: "Renamed" });
    expect(cache.serialize(controller.project)).toBe(
      serializeProject(controller.project),
    );
    expect(serialize).toHaveBeenCalledTimes(3);
  });

  it("bounds retained entries, evicts least-recently-used snapshots and releases closed tabs", () => {
    const projects = ["a", "b", "c"].map((id) =>
      freezeSnapshot(createEmptyProject(id, id)),
    );
    const serialize = vi.fn((p: (typeof projects)[number]) => p.name);
    const cache = createProjectSnapshotSerializer(serialize, {
      entries: 2,
      bytes: 100,
    });
    cache.serialize(projects[0]!);
    cache.serialize(projects[1]!);
    cache.serialize(projects[0]!);
    cache.serialize(projects[2]!);
    cache.serialize(projects[1]!);
    expect(serialize).toHaveBeenCalledTimes(4);
    cache.retain([projects[1]!]);
    cache.serialize(projects[1]!);
    cache.serialize(projects[2]!);
    expect(serialize).toHaveBeenCalledTimes(5);
  });

  it("bounds text memory and does not retain oversized text or failed serialization", () => {
    const a = freezeSnapshot(createEmptyProject("a", "ab"));
    const b = freezeSnapshot(createEmptyProject("b", "cd"));
    const serialize = vi.fn((p: typeof a) => p.name);
    const cache = createProjectSnapshotSerializer(serialize, {
      entries: 10,
      bytes: 4,
    });
    cache.serialize(a);
    cache.serialize(b);
    cache.serialize(a);
    expect(serialize).toHaveBeenCalledTimes(3);
    const large = freezeSnapshot({ ...a, name: "too large" });
    cache.serialize(large);
    cache.serialize(large);
    expect(serialize).toHaveBeenCalledTimes(5);
    serialize.mockImplementationOnce(() => {
      throw new Error("invalid");
    });
    expect(() => cache.serialize(b)).toThrow("invalid");
    expect(cache.serialize(b)).toBe("cd");
    expect(serialize).toHaveBeenCalledTimes(7);
  });
});

it("keeps a useful bounded cache when the open workspace exceeds its entry budget", () => {
  const projects = Array.from({ length: 20 }, (_, i) =>
    freezeSnapshot(createEmptyProject(`tab-${i}`, `Tab ${i}`)),
  );
  const serialize = vi.fn(serializeProject);
  const cache = createProjectSnapshotSerializer(serialize);
  const save = () => {
    cache.retain(projects);
    return projects.map((p) => cache.serialize(p));
  };
  const first = save();
  expect(save()).toEqual(first);
  expect(save()).toEqual(first);
  // Four misses per pass, rather than evicting every unchanged open tab.
  expect(serialize).toHaveBeenCalledTimes(28);
});

it("loads dormant simulation folders, edits the schematic and saves their source bytes unchanged", () => {
  const project = createEmptyProject("dormant-source", "Dormant source");
  project.simulationFolders = [
    createSimulationFolder({
      id: "saved-source",
      name: "Saved source",
      profileId: "external",
      documentId: project.topDocumentId,
    }),
  ];
  project.simulationFolders[0]!.input.files.push({
    path: "notes.txt",
    text: "\ufeffsaved source\r\n参数 α\r\n  preserved whitespace\t\n",
  });
  const disk = serializeProject(project);
  const loaded = parseProject(disk);
  const foldersBefore = new TextEncoder().encode(
    JSON.stringify(loaded.simulationFolders),
  );
  const sourceBefore = loaded.simulationFolders.flatMap((folder) =>
    folder.input.files.map((file) => new TextEncoder().encode(file.text)),
  );
  const controller = new EditorDocumentController(loaded);
  expect(
    controller.transact([
      {
        kind: "add_instance",
        instance: { id: "R1", symbolId: "resistor", placement: null },
      },
    ]).ok,
  ).toBe(true);
  const saved = createProjectSnapshotSerializer().serialize(controller.project);
  const reopened = parseProject(saved);
  expect(
    reopened.documents[0]!.instances.map((instance) => instance.id),
  ).toContain("R1");
  expect(
    new TextEncoder().encode(JSON.stringify(reopened.simulationFolders)),
  ).toEqual(foldersBefore);
  expect(
    reopened.simulationFolders.flatMap((folder) =>
      folder.input.files.map((file) => new TextEncoder().encode(file.text)),
    ),
  ).toEqual(sourceBefore);
});
