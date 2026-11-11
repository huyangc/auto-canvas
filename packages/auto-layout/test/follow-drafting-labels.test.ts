import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  resolveVisualAnchor,
} from "@icm/derived";
import { createRoutePath, type DraftingObject, type Point } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planAutoLayout } from "../src/index.js";
import { placement } from "../src/geometry.js";
import { preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function note(
  id: string,
  position: Point,
): Extract<DraftingObject, { kind: "text" }> {
  return {
    id,
    kind: "text",
    anchor: { kind: "free", position },
    locked: false,
    zIndex: 0,
    alignment: "middle",
    rotation: 0,
    typographyToken: "label",
    content: { runs: [{ kind: "text", value: id }] },
  };
}
it("recovers a drawn branch and a device caption while preserving unrelated and locked notes", () => {
  const d = circuit(
    { left: "resistor", right: "resistor", lower: "npn" },
    { sense: ["left.2", "right.1", "lower.C"] },
  );
  d.presentation.grid = 1;
  d.instances[0]!.placement = placement(10, 100, "none", 90);
  d.instances[1]!.placement = placement(190, 100, "none", 90);
  d.instances[2]!.placement = placement(100, 190, "horizontal");
  const node = { x: 100, y: 100 };
  d.junctions.push({
    id: "old-fork",
    role: "branch",
    netId: "sense",
    position: node,
  });
  d.routes = d.nets[0]!.terminals.map((pin) =>
    createRoutePath({
      id: "lead-" + pin.instanceId,
      netId: "sense",
      start: { kind: "terminal", ...pin },
      end: { kind: "junction", junctionId: "old-fork" },
      bends: [],
      modes: ["manual"],
    }),
  );
  expect(
    deriveDocumentContactEvidence(d, resolver)
      .contacts.filter(contactRequiresJunctionDot)
      .map((c) => c.point),
  ).toContainEqual(node);
  const fork = note("F", { x: 90, y: 102 }),
    device = note("m", { x: 120, y: 217 });
  const locked = { ...note("k", { x: 85, y: 216 }), locked: true };
  const far = note("G", { x: 400, y: 400 });
  d.drafting = { objects: [fork, device, locked, far] };
  const planned = planAutoLayout(d, resolver);
  expect(planned.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const tx = preview(d, resolver, planned.edits);
  if (!tx.ok) throw Error(JSON.stringify(tx.diagnostics));
  const notes = tx.document.drafting!.objects;
  expect(notes[1]).toMatchObject({
    content: device.content,
    anchor: { kind: "object", objectId: "lower" },
  });
  expect(notes.slice(2)).toEqual([locked, far]);
  const anchor = notes[0]!.anchor;
  expect(anchor.kind).toBe("route");
  if (anchor.kind !== "route") throw Error("missing route anchor");
  expect(resolveVisualAnchor(tx.document, resolver, anchor).resolved).toBe(
    true,
  );
  const net = tx.document.routes.find((r) => r.id === anchor.routeId)?.netId;
  expect(tx.document.nets.find((n) => n.id === net)?.terminals).toEqual(
    expect.arrayContaining(d.nets[0]!.terminals),
  );

  const repeated = planAutoLayout(tx.document, resolver);
  expect(
    repeated.diagnostics.filter((issue) => issue.severity === "error"),
  ).toEqual([]);
  const again = preview(tx.document, resolver, repeated.edits);
  if (!again.ok) throw Error(JSON.stringify(again.diagnostics));
  const nextAnchor = again.document.drafting!.objects[0]!.anchor;
  expect(nextAnchor.kind).toBe("route");
  expect(
    resolveVisualAnchor(again.document, resolver, nextAnchor).resolved,
  ).toBe(true);
});
