import { resolveEndpointPoint } from "@icm/derived";
import type { Annotation, RouteBranch, SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planAutoLayout } from "../src/index.js";
import { labelOwnership } from "../src/label-ownership.js";
import { followNetLabels } from "../src/net-label-seat.js";
import type { AutoLayoutResult } from "../src/types.js";
import { preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const place = (
  document: SchematicDocument,
  id: string,
  x: number,
  y: number,
  rotation: 0 | 90 = 0,
) => {
  document.instances.find((i) => i.id === id)!.placement = {
    position: { x, y },
    rotation,
    mirror: "none",
  };
};
const pin = (
  document: SchematicDocument,
  instanceId: string,
  pinName: string,
) =>
  resolveEndpointPoint(document, resolver, {
    kind: "terminal",
    instanceId,
    pinName,
  })!;
/** A wire from `from`'s pin straight across, then to `to`'s pin, by one bend. */
const wire = (
  document: SchematicDocument,
  id: string,
  netId: string,
  from: [string, string],
  to: [string, string],
): RouteBranch => {
  const a = pin(document, ...from),
    b = pin(document, ...to);
  return {
    id,
    netId,
    start: { kind: "terminal", instanceId: from[0], pinName: from[1] },
    legs: [
      ...(a.x === b.x || a.y === b.y
        ? []
        : [
            {
              id: `${id}-bend`,
              mode: "manual" as const,
              to: {
                kind: "bend" as const,
                bendId: `${id}-b`,
                position: { x: a.x, y: b.y },
              },
            },
          ]),
      {
        id: `${id}-leg`,
        mode: "manual" as const,
        to: {
          kind: "endpoint" as const,
          endpoint: { kind: "terminal", instanceId: to[0], pinName: to[1] },
        },
      },
    ],
  };
};
const netLabel = (
  id: string,
  netId: string,
  anchor: Annotation["anchor"],
): Annotation => ({
  id,
  kind: "net-label",
  netId,
  binding: { kind: "net-name", netId },
  anchor,
  alignment: "start",
  rotation: 0,
  locked: false,
});

/** Add `label` to `document` with the name claim that names its Net. */
const named = (document: SchematicDocument, label: Annotation) => {
  document.annotations.push(label);
  document.connectivityEvidence.push({
    id: `claim-${label.id}`,
    kind: "name-claim",
    name: label.id.toUpperCase(),
    netId: label.netId!,
    scope: "local",
    owner: { kind: "net-label", annotationId: label.id },
  });
};

/**
 * Two ports joined to a resistor: `out` runs from r.2 to port `o`, `in`
 * from r.1 to port `i`. `outY` places the output wire.
 */
function divider(outY: number, outX = 200): SchematicDocument {
  const document = circuit(
    { r: "resistor", i: "resistor", o: "resistor" },
    { in: ["r.1", "i.1"], out: ["r.2", "o.1"] },
  );
  place(document, "r", 100, 100);
  place(document, "i", 0, 100);
  place(document, "o", outX, outY + 20);
  document.routes.push(
    wire(document, "w-in", "in", ["i", "1"], ["r", "1"]),
    wire(document, "w-out", "out", ["r", "2"], ["o", "1"]),
  );
  return document;
}

/** The edits that turn `source` into `target`: moved parts, redrawn wires. */
const layoutEdits = (
  source: SchematicDocument,
  target: SchematicDocument,
): AutoLayoutResult => ({
  edits: [
    ...target.instances
      .filter(
        (i) =>
          JSON.stringify(i.placement) !==
          JSON.stringify(
            source.instances.find((s) => s.id === i.id)?.placement,
          ),
      )
      .map((i) => ({
        kind: "move_instance" as const,
        instanceId: i.id,
        position: i.placement!.position,
      })),
    ...target.routes.map((route) => ({
      kind: "set_route_path" as const,
      route,
    })),
  ],
  groups: [],
  diagnostics: [],
});
const follow = (source: SchematicDocument, layout: AutoLayoutResult) => {
  const before = layout.edits.length;
  const result = followNetLabels(source, resolver, layout, {});
  const replay = preview(source, resolver, result.edits);
  if (!replay.ok) throw new Error(JSON.stringify(replay.diagnostics));
  return { added: result.edits.slice(before), final: replay.document };
};

it("moves a free Net label the layout left behind onto a wire of its Net", () => {
  const source = divider(140);
  // Drawn above the output wire, at its middle.
  named(
    source,
    netLabel("vout", "out", { kind: "free", position: { x: 140, y: 132 } }),
  );
  expect(labelOwnership(source, resolver)).toEqual([]);
  // The layout puts the output wire 120 units further down.
  const layout = layoutEdits(source, divider(260));
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok && labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "vout", reason: "own-far" },
  ]);
  const { added, final } = follow(source, layout);
  expect(added).toHaveLength(1);
  expect(final.annotations[0]!.anchor).toMatchObject({
    kind: "route",
    routeId: "w-out",
  });
  expect(labelOwnership(final, resolver)).toEqual([]);
});

/** `out` from r.2 to port o; `in` from s.1 straight across to port i at `inY`. */
function crowded(inY: number): SchematicDocument {
  const document = circuit(
    { r: "resistor", s: "resistor", i: "resistor", o: "resistor" },
    { in: ["s.1", "i.1"], out: ["r.2", "o.1"] },
  );
  place(document, "r", 100, 100);
  place(document, "o", 300, 160);
  place(document, "s", 60, inY + 20);
  place(document, "i", 300, inY + 20);
  document.routes.push(
    wire(document, "w-out", "out", ["r", "2"], ["o", "1"]),
    wire(document, "w-in", "in", ["s", "1"], ["i", "1"]),
  );
  return document;
}

it("does not seat a label between its own wire and a nearer foreign wire", () => {
  const source = crowded(390);
  // Above the output wire's long leg, as R15 seats a label.
  named(
    source,
    netLabel("vout", "out", {
      kind: "route",
      routeId: "w-out",
      legId: "w-out-leg",
      t: 0.5,
      normalOffset: -10,
      direction: "forward",
      orientation: "horizontal",
      fallbackPosition: { x: 200, y: 130 },
    }),
  );
  expect(labelOwnership(source, resolver)).toEqual([]);
  // The layout runs the input wire 10 units above the output wire.
  const layout = layoutEdits(source, crowded(130));
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok && labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "vout", reason: "foreign-closer", foreignNetId: "in" },
  ]);
  const { added, final } = follow(source, layout);
  expect(added).toHaveLength(1);
  expect(final.annotations[0]!.anchor).toMatchObject({
    kind: "route",
    routeId: "w-out",
  });
  expect(labelOwnership(final, resolver)).toEqual([]);
});

it("keeps a Net label that already reads as its Net's in place", () => {
  const source = divider(140);
  named(
    source,
    netLabel("vout", "out", { kind: "free", position: { x: 140, y: 132 } }),
  );
  // The layout moves the input side only.
  const target = divider(140);
  place(target, "i", -40, 100);
  target.routes = [wire(target, "w-in", "in", ["i", "1"], ["r", "1"])];
  const layout = layoutEdits(source, target);
  const edits = structuredClone(layout.edits);
  expect(follow(source, layout).added).toEqual([]);
  expect(layout.edits).toEqual(edits);
});

it("keeps a label its source drawing already misreads where the source put it", () => {
  const source = divider(140);
  // Far from every wire in the source, too.
  named(
    source,
    netLabel("vout", "out", { kind: "free", position: { x: 400, y: 400 } }),
  );
  expect(labelOwnership(source, resolver)).toHaveLength(1);
  expect(follow(source, layoutEdits(source, divider(260))).added).toEqual([]);
});

it("plans a free Net label onto its Net when the layout moves the Net away", () => {
  const document = divider(140, 600);
  document.instances.find((i) => i.id === "i")!.placement!.position = {
    x: -400,
    y: 80,
  };
  document.routes = [
    wire(document, "w-in", "in", ["i", "1"], ["r", "1"]),
    wire(document, "w-out", "out", ["r", "2"], ["o", "1"]),
  ];
  const position = { x: 500, y: 132 };
  named(document, netLabel("vout", "out", { kind: "free", position }));
  expect(labelOwnership(document, resolver)).toEqual([]);
  const plan = planAutoLayout(document, resolver);
  const result = preview(document, resolver, plan.edits);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // Left where it was drawn, the label would stand apart from its Net now.
  const stayed = structuredClone(result.document);
  stayed.annotations[0]!.anchor = { kind: "free", position };
  expect(labelOwnership(stayed, resolver)).toHaveLength(1);
  expect(labelOwnership(result.document, resolver)).toEqual([]);
});
