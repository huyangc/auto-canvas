import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  documentObjectIds,
  planRouteNet,
  type SchematicEdit,
} from "@icm/edit-engine";
import { createRoutePath, deriveStableId } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { circuit } from "./document-fixture.js";
import { placement } from "../src/geometry.js";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { parseProject } from "@icm/project-protocol";
import { planLayoutOnce } from "../src/auto-layout.js";
import { emptyOverrides } from "../src/layout-choices.js";
import { preview, terminalPartition } from "../src/transaction.js";
import cases from "./corpus-cases.json";

it("R98 relayout does not reuse a removed foreign Junction's identity", () => {
  const fixture = cases.find((c) => c.id === "two-inverters")!;
  const project = parseProject(readFileSync(fixture.file, "utf8"));
  const document = project.documents.find((d) => d.id === fixture.documentId)!;
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const baseline = planLayoutOnce(document, resolver, {}, emptyOverrides());
  expect(baseline.result.diagnostics).toEqual([]);
  const junction = baseline.result.edits.find(
    (e) => e.kind === "add_junction",
  )!;
  if (junction.kind !== "add_junction") throw new Error("Missing Junction");
  const old = document.junctions.find((j) => j.netId !== junction.netId)!;
  expect(old).toBeDefined();
  const oldId = old.id;
  old.id = junction.junctionId;
  for (const route of document.routes) {
    if (route.start.kind === "junction" && route.start.junctionId === oldId)
      route.start.junctionId = old.id;
    for (const leg of route.legs)
      if (
        leg.to.kind === "endpoint" &&
        leg.to.endpoint.kind === "junction" &&
        leg.to.endpoint.junctionId === oldId
      )
        leg.to.endpoint.junctionId = old.id;
  }
  const run = planLayoutOnce(document, resolver, {}, emptyOverrides());
  expect(run.result.diagnostics).toEqual([]);
  expect(
    run.result.edits.some(
      (e) => e.kind === "add_junction" && e.junctionId === old.id,
    ),
  ).toBe(false);
  expect(
    planLayoutOnce(document, resolver, {}, emptyOverrides()).result,
  ).toEqual(run.result);
  const final = preview(document, resolver, run.result.edits);
  expect(final.ok).toBe(true);
  if (final.ok)
    expect(terminalPartition(final.document, resolver)).toBe(
      terminalPartition(document, resolver),
    );
});

it("R98 reserves wire-derived Route, Junction and split ids without changing collision-free plans", () => {
  const document = circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    {},
  );
  document.instances.forEach((instance, index) => {
    instance.placement = placement(index * 100, 100);
  });
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const input = {
    trunk: { start: { x: -40, y: 0 }, end: { x: 340, y: 0 } },
    target: {
      kind: "pins" as const,
      pins: document.instances.map((i) => ({ instanceId: i.id, pinName: "1" })),
    },
  };
  const baseline = planRouteNet(document, resolver, input, 256);
  expect(
    planRouteNet(document, resolver, input, 256, { reservedIds: new Set() }),
  ).toEqual(baseline);
  const route = baseline.edits.find((e) => e.kind === "set_route_path")!;
  if (route.kind !== "set_route_path") throw new Error("Missing Route");
  // Sharing an intent prefix is not an object-id collision.
  expect(
    planRouteNet(document, resolver, input, 256, {
      reservedIds: new Set([route.route.id.replace(/-route$/, "-unrelated")]),
    }),
  ).toEqual(baseline);
  const ids = (edits: SchematicEdit[]) =>
    edits.flatMap((e) =>
      e.kind === "set_route_path"
        ? [e.route.id]
        : e.kind === "add_junction"
          ? [
              e.junctionId,
              ...(e.split ? [e.split.firstRouteId, e.split.secondRouteId] : []),
            ]
          : [],
    );
  expect(baseline.edits.some((e) => e.kind === "add_junction" && e.split)).toBe(
    true,
  );
  const reservedIds = new Set(ids(baseline.edits));
  const fresh = planRouteNet(document, resolver, input, 256, { reservedIds });
  expect(ids(fresh.edits).every((id) => !reservedIds.has(id))).toBe(true);
  expect(planRouteNet(document, resolver, input, 256, { reservedIds })).toEqual(
    fresh,
  );
  expect(planRouteNet(document, resolver, input, 256)).toEqual(baseline);
  const after = preview(document, resolver, fresh.edits);
  expect(after.ok).toBe(true);
  if (after.ok)
    expect(after.document.nets.some((net) => net.terminals.length === 4)).toBe(
      true,
    );
});

it("R98 collects every Document object collection, including Route children", () => {
  const document = circuit(
    { a: "inductor", b: "inductor" },
    { net: ["a.1", "b.1"] },
  );
  document.routes.push(
    createRoutePath({
      id: "route",
      netId: "net",
      start: { kind: "terminal", instanceId: "a", pinName: "1" },
      end: { kind: "junction", junctionId: "junction" },
      bends: [{ x: 20, y: 0 }],
      modes: ["manual", "manual"],
    }),
  );
  document.junctions.push({
    id: "junction",
    netId: "net",
    position: { x: 20, y: 20 },
  });
  document.annotations.push({
    id: "annotation",
    kind: "net-label",
    netId: "net",
    binding: { kind: "net-name", netId: "net" },
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.layoutGroups.push({
    id: "group",
    kind: "custom",
    objectIds: ["a", "b"],
    locked: false,
  });
  document.constraints.push({
    id: "constraint",
    kind: "align-x",
    objectIds: ["a", "b"],
    locked: false,
  });
  document.connectivityEvidence.push({
    id: "evidence",
    kind: "spice-source",
    netId: "net",
    sourceNetId: "source",
  });
  document.noConnects.push({
    id: "no-connect",
    endpoint: { kind: "terminal", instanceId: "a", pinName: "2" },
  });
  document.inductorCouplings = [
    {
      id: "coupling",
      name: "K1",
      k: "1",
      members: [
        { instanceId: "a", dotPin: "1" },
        { instanceId: "b", dotPin: "1" },
      ],
    },
  ];
  document.drafting!.objects.push({
    id: "draft",
    kind: "text",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    content: { runs: [{ kind: "text", value: "note" }] },
    alignment: "start",
    rotation: 0,
  });
  const route = document.routes[0]!;
  const bend = route.legs[0]!.to;
  if (bend.kind !== "bend") throw new Error("Missing Bend");
  const expected = [
    "a",
    "b",
    "net",
    "route",
    "junction",
    "annotation",
    "group",
    "constraint",
    "evidence",
    "no-connect",
    "coupling",
    "draft",
    ...route.legs.map((leg) => leg.id),
    bend.bendId,
  ];
  expect(documentObjectIds(document)).toEqual(new Set(expected));
  delete document.inductorCouplings;
  delete document.drafting;
  expect(documentObjectIds(document)).toEqual(
    new Set(expected.filter((id) => id !== "coupling" && id !== "draft")),
  );
});

it("R98 fails with the colliding id after 64 reserved salt attempts", () => {
  const document = circuit({ a: "resistor", b: "resistor" }, {});
  document.instances.forEach((instance, index) => {
    instance.placement = placement(index * 100, 100);
  });
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const input = {
    trunk: { start: { x: -40, y: 0 }, end: { x: 140, y: 0 } },
    target: {
      kind: "pins" as const,
      pins: document.instances.map((i) => ({ instanceId: i.id, pinName: "1" })),
    },
  };
  const ids = Array.from(
    { length: 64 },
    (_, salt) =>
      `${deriveStableId("route-net", document.id, String(document.revision), "trunk", ...(salt ? [String(salt)] : []))}-route`,
  );
  // The last permitted attempt still succeeds when it is free.
  const result = planRouteNet(document, resolver, input, 256, {
    reservedIds: new Set(ids.slice(0, -1)),
  });
  expect(result.edits).toContainEqual(
    expect.objectContaining({
      kind: "set_route_path",
      route: expect.objectContaining({ id: ids[63] }),
    }),
  );
  expect(() =>
    planRouteNet(document, resolver, input, 256, { reservedIds: new Set(ids) }),
  ).toThrow(`route-net exhausted 64 id attempts: ${ids[63]}`);
});
