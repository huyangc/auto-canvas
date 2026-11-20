import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { describe, expect, it, vi } from "vitest";

import { EditorDocumentController } from "../document/document-controller";
import { createLibraryExampleProject } from "../examples/library-examples";
import type { InteractionMode } from "../interaction/interaction-state";
import {
  createEditorTransactionCommands,
  plainRoutingRefusal,
} from "./editor-transaction-commands";

function dependencies() {
  const project = createEmptyProject("project", "Project");
  return {
    project,
    document: project.documents[0]!,
    dispatchProjectTransaction: vi.fn(),
    transactDocument: vi.fn(),
    dispatchTransaction: vi.fn(),
    getCurrentInteractionKind: vi.fn((): InteractionMode => "idle"),
    cancelAllTransientInteraction: vi.fn(),
    setStatus: vi.fn(),
  };
}

describe("editor transaction commands", () => {
  it("builds one revision-checked structural envelope and surfaces diagnostics", () => {
    const input = dependencies();
    input.dispatchProjectTransaction.mockReturnValue({
      ok: false,
      applied: false,
      structureRevision: 0,
      project: input.project,
      error: { code: "EDIT_PRECONDITION", message: "generic failure" },
      diagnostics: [
        {
          code: "EDIT_PRECONDITION",
          severity: "error",
          message: "specific structural failure",
        },
      ],
    });
    const commands = createEditorTransactionCommands(input);

    expect(
      commands.commitStructure("rename-project", [
        { kind: "rename_project", name: "Next" },
      ]),
    ).toBe(false);
    expect(input.dispatchProjectTransaction).toHaveBeenCalledWith(
      {
        transactionId: "rename-project",
        projectId: "project",
        expectedStructureRevision: 0,
        actor: { kind: "human", id: "human-local" },
        edits: [{ kind: "rename_project", name: "Next" }],
      },
      input.document.id,
    );
    expect(input.setStatus).toHaveBeenCalledWith(
      "Could not update Cell structure: specific structural failure",
    );
  });

  it("preserves a legal structural no-op for callers that distinguish unchanged", () => {
    const input = dependencies();
    const unchanged = {
      ok: true as const,
      applied: false,
      structureRevision: 0,
      proposedStructureRevision: 0,
      project: input.project,
      proposedProject: input.project,
      changedDocumentIds: [],
      documentResults: [],
      diagnostics: [],
    };
    input.dispatchProjectTransaction.mockReturnValue(unchanged);
    const commands = createEditorTransactionCommands(input);

    expect(
      commands.transactStructure("upsert-simulation-folder", [
        {
          kind: "upsert_simulation_folder",
          folder: createSimulationFolder({
            id: "folder-1",
            name: "OP",
            documentId: input.document.id,
            profileId: "profile",
          }),
        },
      ]),
    ).toBe(unchanged);
    expect(input.setStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["copy-placement", "active tool cancelled"],
    // Any commit while a Wire is being drawn, an Undo say, drops the Wire
    // and says so.
    ["wire", "Wire cancelled"],
  ] as const)(
    "cancels an unrelated %s after a successful commit",
    (kind, said) => {
      const input = dependencies();
      input.getCurrentInteractionKind.mockReturnValue(kind);
      input.transactDocument.mockReturnValue({
        ok: true,
        applied: true,
        revision: 1,
        proposedRevision: 1,
        document: { ...input.document, revision: 1 },
        diff: {
          documentId: input.document.id,
          fromRevision: 0,
          toRevision: 1,
          editKinds: ["set_presentation_style"],
          changedObjectIds: [],
        },
        diagnostics: [],
      });
      const commands = createEditorTransactionCommands(input);

      commands.transact([
        {
          kind: "set_presentation_style",
          styleProfileId: "razavi-textbook-v1",
        },
      ]);

      expect(input.cancelAllTransientInteraction).toHaveBeenCalledOnce();
      expect(input.setStatus).toHaveBeenLastCalledWith(
        `Committed revision 1; ${said} because the circuit changed`,
      );
    },
  );

  it("converts wrapper exceptions into a typed rejection and clears interaction", () => {
    const input = dependencies();
    input.transactDocument.mockImplementation(() => {
      throw new Error("wrapper failed");
    });
    const commands = createEditorTransactionCommands(input);

    const result = commands.transact([
      {
        kind: "set_presentation_style",
        styleProfileId: "razavi-textbook-v1",
      },
    ]);

    expect(result).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "INTERNAL_ERROR", message: "wrapper failed" },
    });
    expect(input.cancelAllTransientInteraction).toHaveBeenCalledOnce();
    expect(input.setStatus).toHaveBeenCalledWith(
      "INTERNAL_ERROR: wrapper failed — operation cancelled; circuit unchanged",
    );
  });
});

describe("revision-fenced Document commits", () => {
  /** The real controller behind the commands, as App wires them. */
  function controlled(kind: InteractionMode = "idle") {
    const controller = new EditorDocumentController(
      createLibraryExampleProject("two-stage-op-amp")!,
    );
    const input = {
      dispatchProjectTransaction: vi.fn(),
      transactDocument: vi.fn(),
      dispatchTransaction: vi.fn(
        (request: Parameters<typeof controller.dispatchTransaction>[0]) =>
          controller.dispatchTransaction(request),
      ),
      getCurrentInteractionKind: vi.fn((): InteractionMode => kind),
      cancelAllTransientInteraction: vi.fn(),
      setStatus: vi.fn(),
    };
    const commands = () =>
      createEditorTransactionCommands({
        ...input,
        project: controller.project,
        document: controller.document,
      });
    const instance = controller.document.instances[0]!;
    const move = [
      {
        kind: "move_instance" as const,
        instanceId: instance.id,
        position: {
          x: instance.placement!.position.x + 20,
          y: instance.placement!.position.y,
        },
      },
    ];
    return { controller, input, commands, move };
  }

  it("commits once at the revision the edits were planned against", () => {
    const { controller, input, commands, move } = controlled();
    const revision = controller.document.revision;

    const result = commands().transactAtRevision(revision, move, "plan-1");

    expect(result).toMatchObject({ ok: true, applied: true });
    expect(input.dispatchTransaction).toHaveBeenCalledOnce();
    expect(input.dispatchTransaction).toHaveBeenCalledWith({
      transactionId: "plan-1",
      documentId: controller.document.id,
      expectedRevision: revision,
      expectedStructureRevision: controller.project.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits: move,
    });
    expect(controller.document.revision).toBe(revision + 1);
    expect(controller.canUndo).toBe(true);
    expect(input.setStatus).toHaveBeenLastCalledWith(
      `Committed revision ${revision + 1}`,
    );
  });

  it("refuses edits planned against an older revision", () => {
    const { controller, input, commands, move } = controlled();
    const planned = controller.document.revision;
    // Someone else commits first, through the ordinary write path.
    controller.transact([{ ...move[0]!, position: { x: 0, y: 0 } }]);
    const live = controller.document.revision;
    expect(live).toBeGreaterThan(planned);
    const before = JSON.stringify(controller.document);

    const result = commands().transactAtRevision(planned, move, "plan-2");

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STALE_REVISION" },
    });
    expect(controller.document.revision).toBe(live);
    expect(JSON.stringify(controller.document)).toBe(before);
    expect(input.setStatus).toHaveBeenLastCalledWith(
      `The drawing changed since revision ${planned}; nothing was applied`,
    );
  });

  it("cancels a transient tool the commit lands under, as transact does", () => {
    const { controller, input, commands, move } = controlled("copy-placement");
    const revision = controller.document.revision;

    commands().transactAtRevision(revision, move, "plan-3");

    expect(input.cancelAllTransientInteraction).toHaveBeenCalledOnce();
    expect(input.setStatus).toHaveBeenLastCalledWith(
      `Committed revision ${revision + 1}; active tool cancelled because the circuit changed`,
    );
  });
});

describe("routing refusals shown to a person", () => {
  it("restates electrical invariants as what the drawing refused to do", () => {
    const preserve = plainRoutingRefusal(
      "Routing operation changed endpoint Net membership outside a preserve effect",
    );
    // The invariant's own vocabulary never survives to the status bar.
    expect(preserve).not.toContain("preserve effect");
    expect(preserve).not.toContain("endpoint Net membership");
    expect(preserve).toContain("Nets");
    expect(
      plainRoutingRefusal("Routing merge did not join endpoint group a, b"),
    ).not.toContain("endpoint group");
    expect(
      plainRoutingRefusal("Routing partition retained a Route declared as cut"),
    ).not.toContain("partition");
  });

  it("passes an unrecognized refusal through unchanged", () => {
    // An honest technical sentence beats a vague friendly one.
    expect(plainRoutingRefusal("Route route-1 contains a locked segment")).toBe(
      "Route route-1 contains a locked segment",
    );
  });
});
