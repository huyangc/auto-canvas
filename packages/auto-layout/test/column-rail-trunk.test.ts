import { expect, it } from "vitest";
import { diagnoseProject } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { createEmptyProject } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/auto-layout.js";
import { pinPoints, placement } from "../src/geometry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

const danglingWires = (document: SchematicDocument) => {
  const project = createEmptyProject("test", "Test", document.id);
  project.documents = [document];
  return diagnoseProject(project, resolver).filter(
    (d) => d.code === "ERC_DANGLING_WIRE",
  );
};

/** A power marker whose only rail member is a three-pin device's pin has no
 * R12 host, so R43 joins it as a trunk member. Seated straight below (ground)
 * or above (supply) that pin, the two share one column and so have no
 * horizontal span to share. */
function columnRail(
  markerSymbol: "ground" | "vdd-port",
  pinName: string,
): SchematicDocument {
  const lead = markerSymbol === "ground" ? "0" : "P";
  const document = circuit(
    { host: "npn", marker: markerSymbol },
    { rail: [`host.${pinName}`, `marker.${lead}`] },
  );
  const [host, marker] = document.instances;
  host!.placement = placement(400, 400);
  marker!.placement = placement(0, 0);
  const points = pinPoints(document, resolver);
  const pin = points.find(
    (p) => p.instanceId === "host" && p.pinName === pinName,
  )!.point;
  const end = points.find((p) => p.instanceId === "marker")!.point;
  const offset = 2 * document.presentation.grid;
  marker!.placement = placement(
    pin.x - end.x,
    pin.y + (markerSymbol === "ground" ? offset : -offset) - end.y,
  );
  return document;
}

it.each([
  ["ground", "E"],
  ["vdd-port", "C"],
] as const)(
  "R43 joins a %s marker and an npn %s pin in one column without open trunk ends",
  (markerSymbol, pinName) => {
    const document = columnRail(markerSymbol, pinName);
    const fixedInstanceIds = new Set(document.instances.map((i) => i.id));
    const plan = planAutoLayout(document, resolver, { fixedInstanceIds });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const result = executeTransaction(
      document,
      {
        transactionId: "column-rail",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits: plan.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.ok && result.applied).toBe(true);
    if (!result.ok) return;
    const after = result.document;
    expect(danglingWires(document)).toEqual([]);
    expect(danglingWires(after)).toEqual([]);
    // The pin and the marker are joined by one straight vertical wire.
    const [pin, lead] = [
      ["host", pinName],
      ["marker", markerSymbol === "ground" ? "0" : "P"],
    ].map(([id, name]) =>
      pinPoints(after, resolver).find(
        (p) => p.instanceId === id && p.pinName === name,
      )!,
    );
    expect(pin!.point.x).toBe(lead!.point.x);
    expect(after.junctions).toEqual([]);
    expect(after.routes).toHaveLength(1);
  },
60_000);
