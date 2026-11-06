import { createEmptyDocument } from "@icm/model";
import type { DraftingObject, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  proposeRectangleLabel,
  rectangleInteriorAt,
  rectangleLabelFor,
  type DraftingRectangle,
} from "./rectangle-label";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function rectangle(
  id: string,
  center: { x: number; y: number },
  width: number,
  height: number,
  rotation = 0,
): DraftingRectangle {
  return {
    id,
    kind: "rectangle",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: center },
    center,
    width,
    height,
    rotation,
    lineStyle: "solid",
  };
}

function documentWith(objects: DraftingObject[]): SchematicDocument {
  const document = createEmptyDocument("doc", "Drafting");
  document.drafting = { objects };
  return document;
}

describe("rectangleInteriorAt", () => {
  it("finds the rectangle containing the point, boundary inclusive", () => {
    const document = documentWith([
      rectangle("box-1", { x: 100, y: 60 }, 80, 40),
    ]);
    expect(rectangleInteriorAt(document, resolver, { x: 100, y: 60 })?.id).toBe(
      "box-1",
    );
    expect(rectangleInteriorAt(document, resolver, { x: 60, y: 60 })?.id).toBe(
      "box-1",
    );
    expect(
      rectangleInteriorAt(document, resolver, { x: 141, y: 60 }),
    ).toBeNull();
    expect(
      rectangleInteriorAt(document, resolver, { x: 100, y: 81 }),
    ).toBeNull();
  });

  it("prefers the smallest containing rectangle for nested boxes", () => {
    const document = documentWith([
      rectangle("group", { x: 100, y: 60 }, 200, 160),
      rectangle("inner", { x: 100, y: 60 }, 60, 30),
    ]);
    expect(rectangleInteriorAt(document, resolver, { x: 100, y: 60 })?.id).toBe(
      "inner",
    );
    expect(rectangleInteriorAt(document, resolver, { x: 20, y: 60 })?.id).toBe(
      "group",
    );
  });

  it("respects rotation when testing containment", () => {
    const document = documentWith([
      rectangle("tilted", { x: 0, y: 0 }, 100, 20, 90),
    ]);
    // Rotated 90°: the long axis is now vertical.
    expect(rectangleInteriorAt(document, resolver, { x: 0, y: 45 })?.id).toBe(
      "tilted",
    );
    expect(rectangleInteriorAt(document, resolver, { x: 45, y: 0 })).toBeNull();
  });

  it("ignores non-rectangle drafting objects", () => {
    const text: Extract<DraftingObject, { kind: "text" }> = {
      id: "note-1",
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      content: { runs: [{ kind: "text", value: "free" }] },
      alignment: "start",
      rotation: 0,
    };
    const document = documentWith([text]);
    expect(rectangleInteriorAt(document, resolver, { x: 0, y: 0 })).toBeNull();
  });
});

describe("rectangleLabelFor", () => {
  it("finds only the text anchored to the rectangle", () => {
    const box = rectangle("box-1", { x: 100, y: 60 }, 80, 40);
    const label = proposeRectangleLabel(box, "note-7");
    const free: Extract<DraftingObject, { kind: "text" }> = {
      id: "note-8",
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 100, y: 60 } },
      content: { runs: [{ kind: "text", value: "free" }] },
      alignment: "middle",
      rotation: 0,
    };
    const document = documentWith([box, free, label]);
    expect(rectangleLabelFor(document, "box-1")?.id).toBe("note-7");
    expect(rectangleLabelFor(document, "box-2")).toBeNull();
  });
});

describe("proposeRectangleLabel", () => {
  it("proposes a centered, object-anchored, schema-legal empty label", () => {
    const box = rectangle("box-1", { x: 100, y: 60 }, 80, 40);
    box.zIndex = 3;
    const label = proposeRectangleLabel(box, "note-9");
    expect(label).toMatchObject({
      id: "note-9",
      kind: "text",
      locked: false,
      zIndex: 3,
      alignment: "middle",
      rotation: 0,
      typographyToken: "label",
      anchor: {
        kind: "object",
        objectId: "box-1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 100, y: 60 },
      },
    });
    // One line break is the smallest legal RichText document and flattens to
    // whitespace, so an untouched commit deletes the label again.
    expect(label.content.runs).toEqual([{ kind: "line-break" }]);
  });
});
