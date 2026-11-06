import { describe, expect, it, vi } from "vitest";

import { buildProjectConnectivityIndex } from "@icm/derived";
import { createEmptyProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { createAgentSemanticIntentHandler } from "./agent-semantic-intent-handler";

function setup() {
  const project = createEmptyProject("semantic-project", "Semantic Project");
  const document = project.documents[0]!;
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: null,
  });
  const navigateToLocator = vi.fn();
  const fitDocument = vi.fn();
  const clearFocus = vi.fn();
  const highlightNet = vi.fn();
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const handle = createAgentSemanticIntentHandler({
    project,
    resolver,
    connectivityIndex: buildProjectConnectivityIndex(project, resolver),
    navigateToLocator,
    fitDocument,
    clearFocus,
    highlightNet,
  });
  return {
    project,
    document,
    handle,
    navigateToLocator,
    fitDocument,
    clearFocus,
  };
}

describe("Agent semantic intent handler", () => {
  it("delegates document activation, fit, and clear focus without editing", () => {
    const { document, handle, navigateToLocator, fitDocument, clearFocus } =
      setup();

    expect(
      handle({
        documentId: document.id,
        intent: { kind: "activate-document" },
      }),
    ).toMatchObject({ ok: true, kind: "activate-document" });
    expect(navigateToLocator).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: document.id,
        kind: "document",
      }),
      `Agent activated Cell ${document.name}`,
    );

    expect(
      handle({
        documentId: document.id,
        intent: { kind: "fit-document" },
      }),
    ).toMatchObject({ ok: true, kind: "fit-document" });
    expect(fitDocument).toHaveBeenCalledWith(
      document.id,
      `Agent fit Cell ${document.name}`,
    );

    expect(
      handle({
        documentId: document.id,
        intent: { kind: "clear-focus" },
      }),
    ).toMatchObject({ ok: true, kind: "clear-focus" });
    expect(clearFocus).toHaveBeenCalledOnce();
  });

  it("validates locator reachability and object existence before navigation", () => {
    const { document, handle, navigateToLocator } = setup();
    const locator = {
      documentId: document.id,
      hierarchyPath: [],
      kind: "instance" as const,
      objectId: "R1",
    };

    expect(
      handle({
        documentId: document.id,
        intent: { kind: "select", locator },
      }),
    ).toMatchObject({
      ok: true,
      kind: "select",
      objectIds: ["R1"],
    });
    expect(navigateToLocator).toHaveBeenCalledWith(
      locator,
      "Agent selected instance R1",
    );

    expect(
      handle({
        documentId: document.id,
        intent: {
          kind: "select",
          locator: { ...locator, objectId: "R404" },
        },
      }),
    ).toMatchObject({ ok: false, code: "OBJECT_NOT_FOUND" });
  });

  it("rejects requests for a Document outside the active Project", () => {
    const { handle } = setup();
    expect(
      handle({
        documentId: "missing-document",
        intent: { kind: "fit-document" },
      }),
    ).toMatchObject({ ok: false, code: "DOCUMENT_NOT_FOUND" });
  });
});
