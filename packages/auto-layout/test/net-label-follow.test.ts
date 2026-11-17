import { resolveEndpointPoint } from "@icm/derived";
import type { Annotation, RouteBranch, SchematicDocument } from "@icm/model";
import {
  executeProjectTransaction,
  planCreateCellPin,
  proposeWireIntent,
} from "@icm/edit-engine";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
  InMemorySymbolResolver,
} from "@icm/symbols";
import { expect, it } from "vitest";
import { planAutoLayout } from "../src/index.js";
import {
  createLabelOwnership,
  labelOwnership,
} from "../src/label-ownership.js";
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

/**
 * Net `out` drawn in two pieces joined only by name: piece A from r.2 down
 * to `aY` and across to port o, piece B from p.2 up and across to port q.
 */
function twoPieces(aY: number): SchematicDocument {
  const document = circuit(
    { r: "resistor", o: "resistor", p: "resistor", q: "resistor" },
    { out: ["r.2", "o.1", "p.2", "q.1"] },
  );
  place(document, "r", 100, 100);
  place(document, "o", 500, aY + 20);
  place(document, "p", 300, 60);
  place(document, "q", 400, 60);
  document.routes.push(
    wire(document, "w-a", "out", ["r", "2"], ["o", "1"]),
    wire(document, "w-b", "out", ["p", "2"], ["q", "1"]),
  );
  return document;
}

/** Each piece of `out` named by its own `OUT` label. */
function namedPieces(document: SchematicDocument) {
  const vb = netLabel("vb", "out", {
    kind: "route",
    routeId: "w-b",
    legId: "w-b-leg",
    t: 0.5,
    normalOffset: -10,
    direction: "forward",
    orientation: "horizontal",
    fallbackPosition: { x: 350, y: 30 },
  });
  // Above piece A's long leg, nearer piece B's pin p.2 than any pin of A.
  const va = netLabel("va", "out", {
    kind: "free",
    position: { x: 300, y: 132 },
  });
  for (const label of [va, vb]) {
    document.annotations.push(label);
    document.connectivityEvidence.push({
      id: `claim-${label.id}`,
      kind: "name-claim",
      name: "OUT",
      netId: "out",
      scope: "local",
      owner: { kind: "net-label", annotationId: label.id },
    });
  }
}

it("keeps a label on the drawn piece of its Net it names", () => {
  const source = twoPieces(140);
  namedPieces(source);
  expect(labelOwnership(source, resolver)).toEqual([]);
  // The layout moves piece A down; piece B stays beside the label.
  const layout = layoutEdits(source, twoPieces(400));
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok && labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "va", reason: "own-far" },
  ]);
  const { added, final } = follow(source, layout);
  expect(added).toHaveLength(1);
  const va = final.annotations.find((a) => a.id === "va")!;
  // On piece A's wire, never on piece B's, which has its own label.
  expect(va.anchor).toMatchObject({ kind: "route", routeId: "w-a" });
  expect(labelOwnership(final, resolver)).toEqual([]);
});

it("leaves a label where it is when the piece it names has no seat", () => {
  const source = twoPieces(140);
  namedPieces(source);
  // The layout leaves piece A without a wire: a free seat by its pins reads
  // as naming piece B's wire, the nearest of the Net, so no seat names A.
  const target = twoPieces(400);
  target.routes = target.routes.filter((r) => r.id !== "w-a");
  const layout = layoutEdits(source, target);
  layout.edits.push({ kind: "remove_route_geometry", routeId: "w-a" });
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok && labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "va", reason: "own-far" },
  ]);
  expect(follow(source, layout).added).toEqual([]);
});

it("seats a label only beside pins of the piece it names", () => {
  // Net `output` also has q.1, a piece of its own without a wire.
  const withLonePin = (outY: number) => {
    const document = combed(outY);
    document.instances.push({ id: "q", symbolId: "resistor", placement: null });
    document.nets
      .find((n) => n.id === "output")!
      .terminals.push({ instanceId: "q", pinName: "1" });
    place(document, "q", 800, 80);
    return document;
  };
  const source = withLonePin(60);
  named(
    source,
    netLabel("vbias", "output", { kind: "free", position: { x: 300, y: 52 } }),
  );
  expect(labelOwnership(source, resolver)).toEqual([]);
  // Every seat by the output wire or its pins has a comb wire across it. A
  // seat by q.1 binds to the output wire, the Net's only wire, yet a reader
  // sees the name at q, which has no wire.
  const layout = layoutEdits(source, withLonePin(260));
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok && labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "vbias", reason: "own-far" },
  ]);
  expect(follow(source, layout).added).toEqual([]);
});

/**
 * Net `out` along y 140: a.2 by a bend to b.1, b.1 to c.1, c.1 to d.1. With
 * `split` the layout drops the b–c wire and moves c and d down to y 400.
 */
function chain(split: boolean): SchematicDocument {
  const document = circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    { out: ["a.2", "b.1", "c.1", "d.1"] },
  );
  const y = split ? 400 : 140;
  place(document, "a", 100, 100);
  place(document, "b", 200, 160);
  place(document, "c", 300, y + 20);
  place(document, "d", 400, y + 20);
  document.routes.push(
    wire(document, "w1", "out", ["a", "2"], ["b", "1"]),
    ...(split ? [] : [wire(document, "w2", "out", ["b", "1"], ["c", "1"])]),
    wire(document, "w3", "out", ["c", "1"], ["d", "1"]),
  );
  return document;
}

it("keeps a label on the piece it names now when the layout splits its piece", () => {
  const source = chain(false);
  // Drawn by c.1, above the c–d wire.
  named(
    source,
    netLabel("vout", "out", { kind: "free", position: { x: 310, y: 132 } }),
  );
  expect(labelOwnership(source, resolver)).toEqual([]);
  // After the split the label still names the a–b piece, the nearer one.
  const layout = layoutEdits(source, chain(true));
  layout.edits.push({ kind: "remove_route_geometry", routeId: "w2" });
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok && labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "vout", reason: "own-far" },
  ]);
  const { added, final } = follow(source, layout);
  expect(added).toHaveLength(1);
  // Not on the c–d piece, though c.1 is where it was drawn: that would leave
  // the a–b piece it names unnamed.
  expect(final.annotations[0]!.anchor).toMatchObject({
    kind: "route",
    routeId: "w1",
  });
  expect(labelOwnership(final, resolver)).toEqual([]);
});

/**
 * twoPieces(140), and a comb of Net `comb` wires every 20 units from x 110
 * to 490: far below in the source; with `crossed`, piece A runs straight
 * along y 400 from r.2 to o.1 and the comb crosses it from y 380 to 420.
 */
function combedPieces(crossed: boolean): SchematicDocument {
  const teeth = Array.from({ length: 20 }, (_, i) => 110 + 20 * i);
  const document = twoPieces(140);
  for (const [i] of teeth.entries())
    document.instances.push(
      { id: `c${i}`, symbolId: "resistor", placement: null },
      { id: `d${i}`, symbolId: "resistor", placement: null },
    );
  document.nets.push({
    id: "comb",
    terminals: teeth.flatMap((_, i) => [
      { instanceId: `c${i}`, pinName: "2" },
      { instanceId: `d${i}`, pinName: "1" },
    ]),
  });
  const top = crossed ? 380 : 600;
  teeth.forEach((x, i) => {
    place(document, `c${i}`, x, top - 20);
    place(document, `d${i}`, x, top + 60);
  });
  if (crossed) {
    place(document, "r", 100, 380);
    place(document, "o", 500, 420);
  }
  document.routes = [
    wire(document, "w-a", "out", ["r", "2"], ["o", "1"]),
    wire(document, "w-b", "out", ["p", "2"], ["q", "1"]),
    ...teeth.map((_, i) =>
      wire(document, `w-c${i}`, "comb", [`c${i}`, "2"], [`d${i}`, "1"]),
    ),
  ];
  return document;
}

it("takes a pin seat on its own piece over a wire seat on another", () => {
  const source = combedPieces(false);
  namedPieces(source);
  expect(labelOwnership(source, resolver)).toEqual([]);
  // Every seat by A's wire has a comb wire across its text; only the ends
  // of A, beyond the comb, have room. Drawn by a wire, the label would
  // rather take a seat by a wire, and B's wire has clear ones.
  const layout = layoutEdits(source, combedPieces(true));
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok && labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "va", reason: "own-far" },
  ]);
  const { added, final } = follow(source, layout);
  expect(added).toHaveLength(1);
  const va = final.annotations.find((a) => a.id === "va")!;
  expect(va.anchor.kind).toBe("free");
  expect(labelOwnership(final, resolver)).toEqual([]);
  // Beside r.2 or o.1, not over piece B's wire along y 40.
  const ink = createLabelOwnership(final, resolver).context.measure(
    va,
  ).inkBounds;
  expect(ink.y).toBeGreaterThan(350);
});

it("does not move a Net label a layout group or constraint holds", () => {
  const source = divider(140);
  named(
    source,
    netLabel("vout", "out", { kind: "free", position: { x: 140, y: 132 } }),
  );
  source.layoutGroups.push({
    id: "held",
    kind: "custom",
    objectIds: ["vout", "o"],
    locked: false,
  });
  expect(follow(source, layoutEdits(source, divider(260))).added).toEqual([]);
  source.layoutGroups = [];
  source.constraints.push({
    id: "aligned",
    kind: "align-x",
    objectIds: ["vout", "o"],
    locked: false,
  });
  expect(follow(source, layoutEdits(source, divider(260))).added).toEqual([]);
});

it("does not start R15a once the search was stopped", () => {
  const source = divider(140);
  named(
    source,
    netLabel("vout", "out", { kind: "free", position: { x: 140, y: 132 } }),
  );
  const controller = new AbortController();
  controller.abort();
  const layout = layoutEdits(source, divider(260));
  const before = structuredClone(layout.edits);
  followNetLabels(source, resolver, layout, {
    search: { seed: 1, evaluations: 0, signal: controller.signal },
  });
  expect(layout.edits).toEqual(before);
  followNetLabels(source, resolver, layout, {
    search: { seed: 1, evaluations: 0, deadline: Date.now() - 1 },
  });
  expect(layout.edits).toEqual(before);
});

/**
 * `output` from r.2 straight across to port o at `outY`, inside a comb of
 * vertical `comb` wires every 20 units from y 200 to 320.
 */
function combed(outY: number): SchematicDocument {
  const teeth = Array.from({ length: 28 }, (_, i) => 90 + 20 * i);
  const document = circuit(
    {
      r: "resistor",
      o: "resistor",
      ...Object.fromEntries(
        teeth.flatMap((_, i) => [
          [`c${i}`, "resistor"],
          [`d${i}`, "resistor"],
        ]),
      ),
    },
    {
      output: ["r.2", "o.1"],
      comb: teeth.flatMap((_, i) => [`c${i}.2`, `d${i}.1`]),
    },
  );
  place(document, "r", 100, outY - 20);
  place(document, "o", 600, outY + 20);
  teeth.forEach((x, i) => {
    place(document, `c${i}`, x, 180);
    place(document, `d${i}`, x, 340);
  });
  document.routes.push(
    wire(document, "w-out", "output", ["r", "2"], ["o", "1"]),
    ...teeth.map((_, i) =>
      wire(document, `w-c${i}`, "comb", [`c${i}`, "2"], [`d${i}`, "1"]),
    ),
  );
  return document;
}

it("does not move a label clear of wires onto a wire", () => {
  const source = combed(60);
  named(
    source,
    netLabel("vbias", "output", { kind: "free", position: { x: 300, y: 52 } }),
  );
  expect(labelOwnership(source, resolver)).toEqual([]);
  // The layout runs the output wire through the comb: every seat that reads
  // as the output's has a wire drawn across its text.
  const layout = layoutEdits(source, combed(260));
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok && labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "vbias", reason: "own-far" },
  ]);
  expect(follow(source, layout).added).toEqual([]);
});

/**
 * A caller of a cell with bus pin `INPUT<7:4>` whose tap Route selects one
 * member: the selector Net label sits on the tap's long leg (y 0, x 0 to
 * -200). Port pair f1/f2 on Net `foreign` is wired across at `foreignY`.
 */
function busTap(foreignY: number) {
  const initial = createEmptyProject("selector", "Selector", "child");
  const actor = { kind: "human" as const, id: "test" };
  const created = executeProjectTransaction(initial, {
    transactionId: "pin",
    projectId: initial.id,
    expectedStructureRevision: 0,
    actor,
    edits: planCreateCellPin(initial, "child", {
      instance: {
        id: "port",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      terminal: {
        id: "formal",
        name: "INPUT<7:4>",
        netId: "input",
        direction: "input",
        interfaceInstanceIds: ["port"],
      },
      connectionEdits: [],
      signalExpression: "INPUT<7:4>",
    }),
  });
  if (!created.ok) throw new Error(JSON.stringify(created));
  const child = created.project.documents[0]!;
  const parent = createEmptyDocument("parent", "Parent");
  parent.instances.push({
    id: "call",
    reference: "X1",
    symbolId: hierarchicalSymbolId(child.netlist!.name),
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: child.id },
      parameters: {},
    },
  });
  const project = {
    ...created.project,
    topDocumentId: parent.id,
    documents: [...created.project.documents, parent],
  };
  const projectResolver = createProjectSymbolResolver(project, builtInSymbols);
  const proposal = proposeWireIntent(parent, projectResolver, {
    id: "tap",
    from: {
      kind: "endpoint",
      endpoint: {
        kind: "terminal",
        instanceId: "call",
        pinName: "INPUT<7:4>",
        memberId: child.netlist!.terminals[0]!.signal!.members[1]!.id,
      },
    },
    to: { kind: "free", point: { x: -200, y: -40 } },
  });
  if (typeof proposal === "string") throw new Error(proposal);
  const tapped = executeProjectTransaction(project, {
    transactionId: "tap",
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    actor,
    edits: [
      {
        kind: "transact_document",
        documentId: parent.id,
        expectedRevision: parent.revision,
        edits: proposal.edits,
      },
    ],
  });
  if (!tapped.ok) throw new Error(JSON.stringify(tapped));
  const document = structuredClone(
    tapped.project.documents.find((d) => d.id === parent.id)!,
  );
  document.instances.push(
    { id: "f1", symbolId: "resistor", placement: null },
    { id: "f2", symbolId: "resistor", placement: null },
  );
  document.nets.push({
    id: "foreign",
    terminals: [
      { instanceId: "f1", pinName: "1" },
      { instanceId: "f2", pinName: "1" },
    ],
  });
  const busResolver = createProjectSymbolResolver(
    tapped.project,
    builtInSymbols,
  );
  place(document, "f1", -180, foreignY + 20);
  place(document, "f2", -20, foreignY + 20);
  const p = (id: string) =>
    resolveEndpointPoint(document, busResolver, {
      kind: "terminal",
      instanceId: id,
      pinName: "1",
    })!;
  expect(p("f1").y).toBe(foreignY);
  document.routes.push({
    id: "w-f",
    netId: "foreign",
    start: { kind: "terminal", instanceId: "f1", pinName: "1" },
    legs: [
      {
        id: "w-f-leg",
        mode: "manual",
        to: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: "f2", pinName: "1" },
        },
      },
    ],
  });
  return { document, busResolver };
}

it("leaves a bus selector on the branch Route it selects from", () => {
  const { document: source, busResolver } = busTap(300);
  const selector = source.annotations.find(
    (a) => a.binding?.kind === "net-name",
  )!;
  expect(selector.binding).toHaveProperty("memberEndpoint");
  expect(labelOwnership(source, busResolver)).toEqual([]);
  // The layout runs the foreign wire just under the tap's leg, beside the
  // selector's text.
  const layout = layoutEdits(source, busTap(-10).document);
  const stayed = preview(source, busResolver, layout.edits);
  expect(
    stayed.ok && labelOwnership(stayed.document, busResolver),
  ).toMatchObject([{ annotationId: selector.id }]);
  const edits = structuredClone(layout.edits);
  followNetLabels(source, busResolver, layout, {});
  expect(layout.edits).toEqual(edits);
});

it("orders pins at equal distance by code-point id order", () => {
  const document = circuit(
    { a: "resistor", B: "resistor" },
    { out: ["a.1", "B.1"] },
  );
  place(document, "a", 100, 100);
  place(document, "B", 140, 100);
  // Both pins 10 units from the box between them.
  const box = { x: 110, y: 70, width: 20, height: 20 };
  expect(
    createLabelOwnership(document, resolver)
      .ownPins("out", box)
      .map((p) => p.id),
  ).toEqual(["B.1", "a.1"]);
});

/**
 * Base Net `x` holds only m.B, a pin the symbol hides; Base Net `x2`, joined
 * to it by the name X, runs from s.1 to t.1 along `y`.
 */
function hiddenBase(y: number): SchematicDocument {
  const document = circuit(
    { m: "nmos", s: "resistor", t: "resistor" },
    { x: ["m.B"], x2: ["s.1", "t.1"] },
  );
  place(document, "m", 100, 100);
  place(document, "s", 300, y + 20);
  place(document, "t", 400, y + 20);
  document.routes.push(wire(document, "w-x2", "x2", ["s", "1"], ["t", "1"]));
  return document;
}

it("does not seat a label by another Base Net joined to its own by name", () => {
  const source = hiddenBase(140);
  // X's label on x2's wire names x2; the label for x stands just above it.
  named(
    source,
    netLabel("x2-label", "x2", {
      kind: "route",
      routeId: "w-x2",
      legId: "w-x2-leg",
      t: 0.75,
      normalOffset: -10,
      direction: "forward",
      orientation: "horizontal",
      fallbackPosition: { x: 375, y: 130 },
    }),
  );
  named(
    source,
    netLabel("x-label", "x", { kind: "free", position: { x: 310, y: 132 } }),
  );
  for (const claim of source.connectivityEvidence)
    if (claim.kind === "name-claim") claim.name = "X";
  expect(labelOwnership(source, resolver)).toEqual([]);
  // The layout moves x2 down; x has nothing drawn to stand by.
  const layout = layoutEdits(source, hiddenBase(400));
  const stayed = preview(source, resolver, layout.edits);
  expect(
    stayed.ok &&
      labelOwnership(stayed.document, resolver).map((f) => f.annotationId),
  ).toContain("x-label");
  // A seat by x2's wire or pins would show the name on x2, not on x.
  expect(
    follow(source, layout).added.filter(
      (e) =>
        e.kind === "upsert_schematic_annotation" &&
        e.annotation.id === "x-label",
    ),
  ).toEqual([]);
});
