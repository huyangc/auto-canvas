import { expect, it } from "vitest";
import {
  createLabelClearanceContext,
  defaultInstanceLabelPlacement,
  instanceLabelSlotAt,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import {
  createRoutePath,
  type Annotation,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { seatLabels } from "../src/seat-labels.js";
import { facePorts } from "../src/face-ports.js";
import { planAutoLayout, ROUTED_SCORE_WEIGHTS } from "../src/index.js";
import { emptyChoices } from "../src/layout-choices.js";
import { pinPoints, placement } from "../src/geometry.js";
import { routedScore } from "../src/refine.js";
import { preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function labeledPair(values = false) {
  const document = circuit({ a: "nmos", b: "nmos" }, {});
  const profile = resolveDocumentStyleProfile(document.presentation);
  document.instances.forEach((i, index) => {
    i.placement = placement(index * 100, 0);
  });
  for (const instance of document.instances) {
    for (const kind of values
      ? (["instance-label", "instance-value"] as const)
      : (["instance-label"] as const)) {
      const p = defaultInstanceLabelPlacement(
        instance,
        resolver.resolve(instance.symbolId)!,
        profile,
        document.presentation.grid,
        kind === "instance-value" ? "value" : "reference",
      )!;
      document.annotations.push({
        id: `${instance.id}-${kind}`,
        kind,
        content: {
          runs: [
            {
              kind: "text",
              value:
                kind === "instance-value" ? "10u/1u" : "LongReference123456",
            },
          ],
        },
        anchor: {
          kind: "object",
          objectId: instance.id,
          localOffset: {
            x: p.position.x - instance.placement!.position.x,
            y: p.position.y - instance.placement!.position.y,
          },
          fallbackPosition: p.position,
        },
        alignment: p.alignment,
        rotation: 0,
        locked: false,
      });
    }
  }
  return document;
}
function seated(document: SchematicDocument) {
  const edits = seatLabels(
    document,
    resolver,
    new Set(document.instances.map((i) => i.id)),
  );
  const result = preview(document, resolver, edits);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("seating replay failed");
  return { document: result.document, edits };
}
function side(document: SchematicDocument, a: Annotation) {
  if (a.anchor.kind !== "object")
    throw new Error("expected attached annotation");
  const ownerId = a.anchor.objectId;
  const instance = document.instances.find((i) => i.id === ownerId)!;
  return instanceLabelSlotAt(
    instance,
    resolver.resolve(instance.symbolId)!,
    resolveDocumentStyleProfile(document.presentation),
    document.presentation.grid,
    {
      position: createLabelClearanceContext(document, resolver).measure(a)
        .position,
      alignment: a.alignment,
    },
    a.sizeScale,
  )?.side;
}
it("R73 seats overlapping default labels on different sides", () => {
  const before = labeledPair();
  expect(
    createLabelClearanceContext(before, resolver).conflicts(
      before.annotations[0]!,
    ).length,
  ).toBeGreaterThan(0);
  const after = seated(before).document;
  expect(side(after, after.annotations[0]!)).not.toBe(
    side(after, after.annotations[1]!),
  );
  for (const a of after.annotations)
    expect(
      createLabelClearanceContext(after, resolver).findingsAt(a).overlapped,
    ).toEqual([]);
});
it("R73 chooses a free side instead of placing text on a wire", () => {
  const before = labeledPair();
  before.instances = before.instances.slice(0, 1);
  before.annotations = before.annotations.slice(0, 1);
  const ink = createLabelClearanceContext(before, resolver).measure(
    before.annotations[0]!,
  ).inkBounds;
  const y = Math.round(ink.y + ink.height / 2);
  before.nets = [{ id: "wire", terminals: [] }];
  before.junctions = [
    { id: "j1", netId: "wire", position: { x: Math.floor(ink.x) - 10, y } },
    {
      id: "j2",
      netId: "wire",
      position: { x: Math.ceil(ink.x + ink.width) + 10, y },
    },
  ];
  before.routes = [
    createRoutePath({
      id: "r",
      netId: "wire",
      start: { kind: "junction", junctionId: "j1" },
      bends: [],
      end: { kind: "junction", junctionId: "j2" },
      modes: ["manual"],
    }),
  ];
  const after = seated(before).document;
  expect(
    createLabelClearanceContext(after, resolver).findingsAt(
      after.annotations[0]!,
    ).struck,
  ).toEqual([]);
});
it("R73 leaves a locked annotation byte-for-byte unchanged", () => {
  const before = labeledPair();
  before.annotations[0]!.locked = true;
  const { document: after, edits } = seated(before);
  expect(
    after.annotations.find((a) => a.id === before.annotations[0]!.id),
  ).toEqual(before.annotations[0]);
  expect(
    edits.some(
      (e) =>
        e.kind === "upsert_schematic_annotation" &&
        e.annotation.id === before.annotations[0]!.id,
    ),
  ).toBe(false);
});
it("R73 keeps each name and value together, preserving all non-placement fields", () => {
  const before = labeledPair(true),
    after = seated(before).document;
  for (const instance of after.instances) {
    const group = after.annotations.filter(
      (a) => a.anchor.kind === "object" && a.anchor.objectId === instance.id,
    );
    expect(side(after, group[0]!)).toBe(side(after, group[1]!));
  }
  for (const a of after.annotations) {
    const old = before.annotations.find((o) => o.id === a.id)!;
    expect({ ...a, anchor: old.anchor, alignment: old.alignment }).toEqual(old);
  }
});
it("R74 prefers no label overlap with identical wiring", () => {
  const poor = circuit({}, {});
  poor.annotations = [0, 1].map((i) => ({
    id: `a${i}`,
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "Name" }] },
    anchor: { kind: "free", position: { x: 200, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  }));
  const good = structuredClone(poor);
  good.annotations[1]!.anchor = { kind: "free", position: { x: 400, y: 0 } };
  const score = (final: SchematicDocument) =>
    routedScore(
      {
        final,
        choices: emptyChoices(),
        result: { edits: [], groups: [], diagnostics: [] },
      },
      resolver,
    );
  expect(score(poor) - score(good)).toBe(ROUTED_SCORE_WEIGHTS.labelOverlaps);
});
it("quick mode remains deterministic and its seated transactions replay", () => {
  const before = labeledPair(true),
    original = structuredClone(before),
    plan = planAutoLayout(before, resolver);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(planAutoLayout(before, resolver)).toEqual(plan);
  expect(preview(before, resolver, plan.edits).ok).toBe(true);
  expect(before).toEqual(original);
});
it("faces a port along a sideways route without moving its terminal or changing wires", () => {
  const before = circuit({ p: "port", a: "nmos", b: "nmos" }, { n: ["p.P"] });
  before.instances[1]!.placement = placement(-200, -200);
  before.instances[2]!.placement = placement(200, 200);
  before.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "port-terminal",
        name: "input",
        netId: "n",
        direction: "input",
        interfaceInstanceIds: ["p"],
      },
    ],
  };
  before.instances[0]!.placement = placement(0, 0);
  before.junctions = [{ id: "j", netId: "n", position: { x: 0, y: 80 } }];
  before.routes = [
    createRoutePath({
      id: "r",
      netId: "n",
      start: { kind: "terminal", instanceId: "p", pinName: "P" },
      bends: [],
      end: { kind: "junction", junctionId: "j" },
      modes: ["manual"],
    }),
  ];
  const edits = facePorts(before, resolver, new Set());
  expect(edits.length).toBeGreaterThan(0);
  const after = preview(before, resolver, edits);
  expect(after.ok, JSON.stringify(after.diagnostics)).toBe(true);
  if (!after.ok) return;
  expect(pinPoints(after.document, resolver)).toEqual(
    pinPoints(before, resolver),
  );
  expect(after.document.routes).toEqual(before.routes);
  expect(facePorts(after.document, resolver, new Set())).toEqual([]);
  expect(facePorts(before, resolver, new Set(["p"]))).toEqual([]);
});

it("R73 keeps several displayed parameters on their own rows", () => {
  const document = labeledPair(true);
  const value = document.annotations.find((a) => a.id === "a-instance-value")!;
  if (value.anchor.kind !== "object") throw new Error("expected object anchor");
  // A second displayed parameter, one row below the first.
  document.annotations.push({
    ...value,
    id: "a-instance-value-2",
    anchor: {
      ...value.anchor,
      localOffset: {
        x: value.anchor.localOffset.x,
        y: value.anchor.localOffset.y + 20,
      },
      fallbackPosition: {
        x: value.anchor.fallbackPosition.x,
        y: value.anchor.fallbackPosition.y + 20,
      },
    },
  });
  const after = seated(document).document;
  const context = createLabelClearanceContext(after, resolver);
  const at = (id: string) =>
    context.measure(after.annotations.find((a) => a.id === id)!).position;
  const first = at("a-instance-value"),
    second = at("a-instance-value-2");
  expect(second.x - first.x).toBe(0);
  expect(second.y - first.y).toBe(20);
});

it("finishes shared-owner labels in distinct seats while preserving their owner and text", () => {
  const d = labeledPair();
  const reference = d.annotations[0]!;
  d.annotations.push({
    ...reference,
    id: "second-name",
    content: { runs: [{ kind: "text", value: "bias" }] },
  });
  const previewed = preview(d, resolver, planAutoLayout(d, resolver).edits);
  expect(previewed.ok).toBe(true);
  if (!previewed.ok) return;
  const drawn = previewed.document,
    ctx = createLabelClearanceContext(drawn, resolver);
  for (const original of [reference, d.annotations.at(-1)!]) {
    const moved = drawn.annotations.find((a) => a.id === original.id)!;
    expect(moved.content).toEqual(original.content);
    expect(moved.anchor).toMatchObject({ kind: "object", objectId: "a" });
    expect(ctx.overlapsAt(ctx.measure(moved).inkBounds, moved.id)).toEqual([]);
  }
});
