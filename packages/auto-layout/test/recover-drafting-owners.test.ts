import {
  resolveDocumentRoutingGeometry,
  resolveVisualAnchor,
} from "@icm/derived";
import { createRoutePath, type DraftingObject, type Point } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { draftingGroups } from "../src/drafting-groups.js";
import { placement } from "../src/geometry.js";
import { planAutoLayout } from "../src/index.js";
import {
  equivalentTerminals,
  preview,
  terminalPartition,
} from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const note = (id: string, position: Point): DraftingObject => ({
  id,
  kind: "text",
  anchor: { kind: "free", position },
  locked: false,
  zIndex: 0,
  alignment: "middle",
  rotation: 0,
  content: { runs: [{ kind: "text", value: "clock" }] },
});
function fixture(collides = false) {
  const d = circuit(
    { a: "resistor", b: "resistor" },
    { signal: ["a.2", "b.1"], ink: [] },
  );
  d.instances[0]!.placement = placement(0, 400);
  d.instances[1]!.placement = placement(600, 400);
  const x = collides ? 600 : 800;
  d.junctions = [
    { id: "start", netId: "ink", position: { x, y: 380 } },
    { id: "end", netId: "ink", position: { x: x + 80, y: 440 } },
  ];
  d.routes = [
    createRoutePath({
      id: "conductor",
      netId: "ink",
      start: { kind: "junction", junctionId: "start" },
      end: { kind: "junction", junctionId: "end" },
      bends: [{ x, y: 440 }],
      modes: ["manual", "manual"],
    }),
  ];
  d.drafting = { objects: [note("caption", { x: x + 50, y: 420 })] };
  return d;
}
function apply(d: ReturnType<typeof fixture>) {
  const plan = planAutoLayout(d, resolver);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const tx = preview(d, resolver, plan.edits);
  if (!tx.ok) throw Error(JSON.stringify(tx.diagnostics));
  expect(terminalPartition(tx.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  expect(equivalentTerminals(d, tx.document, resolver)).toBe(true);
  return { plan, final: tx.document };
}

it("keeps a block diagram's isolated bent conductor and caption without joining terminal Nets", () => {
  const d = fixture();
  for (const instance of d.instances) instance.symbolId = "voltage-amplifier";
  d.nets[0]!.terminals = [
    { instanceId: "a", pinName: "OUT" },
    { instanceId: "b", pinName: "IN" },
  ];
  const before = structuredClone(d);
  const { plan, final } = apply(d);
  expect(final.routes.some((r) => r.id === "conductor")).toBe(true);
  const owner = draftingGroups(final, resolver).find((g) =>
    g.objects.some((o) => o.id === "caption"),
  )!.owner;
  expect(owner).toMatchObject({ net: "[]" });
  const original = resolveDocumentRoutingGeometry(d, resolver).routes.get(
    "conductor",
  )!.centerline;
  const moved = resolveDocumentRoutingGeometry(final, resolver).routes.get(
    "conductor",
  )!.centerline;
  const delta = {
    x: moved[0]!.x - original[0]!.x,
    y: moved[0]!.y - original[0]!.y,
  };
  expect(moved).toEqual(
    original.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })),
  );
  expect(delta).not.toEqual({ x: 0, y: 0 });
  expect(apply(d).plan).toEqual(plan);
  expect(d).toEqual(before);
});

it("drops a terminal-free conductor whose translated segment crosses a symbol", () => {
  const { final } = apply(fixture(true));
  expect(final.routes.some((r) => r.id === "conductor")).toBe(false);
});

it("reseats a stranded instance caption beside its original owner", () => {
  const d = fixture();
  d.routes = [];
  d.junctions = [];
  d.drafting = { objects: [note("caption", { x: 640, y: 400 })] };
  const original = draftingGroups(d, resolver)[0]!.owner;
  expect(original).toMatchObject({ kind: "instance", id: "b" });
  const { final } = apply(d);
  expect(draftingGroups(final, resolver)[0]!.owner).toMatchObject({
    kind: "instance",
    id: "b",
  });
  expect(
    resolveVisualAnchor(final, resolver, final.drafting!.objects[0]!.anchor)
      .position,
  ).not.toEqual({ x: 640, y: 400 });
});

it("continues beyond a blocked local seat and keeps the stranded caption's owner", async () => {
  const { followDraftingGroups } =
    await import("../src/follow-drafting-groups.js");
  const { recoverDraftingOwners } =
    await import("../src/recover-drafting-owners.js");
  const d = circuit({ a: "resistor" }, {});
  d.instances[0]!.placement = placement(0, 0);
  d.drafting = {
    objects: [
      note("stranded", { x: 60, y: 0 }),
      {
        id: "fixed-box",
        kind: "rectangle",
        locked: true,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 480, y: 400 } },
        center: { x: 480, y: 400 },
        width: 100,
        height: 120,
        rotation: 0,
        lineStyle: "solid",
      },
    ],
  };
  const groups = draftingGroups(d, resolver);
  expect(groups[0]!.owner).toMatchObject({ kind: "instance", id: "a" });
  const base = {
    edits: [
      {
        kind: "move_instance" as const,
        instanceId: "a",
        position: { x: 400, y: 400 },
      },
    ],
    groups: [],
    diagnostics: [],
  };
  const placed = preview(d, resolver, base.edits);
  if (!placed.ok) throw Error(JSON.stringify(placed.diagnostics));
  expect(draftingGroups(placed.document, resolver)[0]!.owner).toBeUndefined();
  const local = followDraftingGroups(
    d,
    resolver,
    base,
    structuredClone(base),
    groups,
  );
  expect(local.edits).toEqual(base.edits);
  const result = recoverDraftingOwners(d, resolver, base);
  const final = preview(d, resolver, result.edits);
  if (!final.ok) throw Error(JSON.stringify(final.diagnostics));
  expect(draftingGroups(final.document, resolver)[0]!.owner).toMatchObject({
    kind: "instance",
    id: "a",
  });
  expect(
    final.document.drafting!.objects.find((o) => o.id === "fixed-box"),
  ).toEqual(d.drafting.objects[1]);
  expect(terminalPartition(final.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  expect(recoverDraftingOwners(d, resolver, base)).toEqual(result);
});

it("does not reactivate a route anchor that would move locked drafting", () => {
  const d = fixture();
  const locked = {
    ...note("fixed-route-caption", { x: 770, y: 392 }),
    locked: true,
    anchor: {
      kind: "route" as const,
      routeId: "conductor",
      legId: d.routes[0]!.legs[0]!.id,
      t: 0.2,
      normalOffset: 30,
      direction: "forward" as const,
      orientation: "horizontal" as const,
      fallbackPosition: { x: 770, y: 392 },
    },
  };
  d.drafting!.objects.push(locked);
  const at = resolveVisualAnchor(d, resolver, locked.anchor).position;
  const { final } = apply(d);
  const retained = final.drafting!.objects.find((o) => o.id === locked.id)!;
  expect(retained).toEqual(locked);
  expect(
    resolveVisualAnchor(final, resolver, retained.anchor).position,
  ).toEqual(at);
  expect(final.routes.some((r) => r.id === "conductor")).toBe(false);
});

it("scoped ownership includes unselected touching ink and its locks", () => {
  const d = circuit({ a: "resistor" }, {});
  d.instances[0]!.placement = placement(600, 400);
  d.drafting = {
    objects: [
      note("selected", { x: 645, y: 400 }),
      note("neighbor", { x: 650, y: 400 }),
    ],
  };
  const selected = new Set(["selected"]);
  const groups = draftingGroups(d, resolver, selected);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.objects.map((o) => o.id)).toEqual(["selected", "neighbor"]);
  expect(groups[0]!.owner).toMatchObject({ kind: "instance", id: "a" });
  d.drafting.objects[1]!.locked = true;
  expect(draftingGroups(d, resolver, selected)).toEqual([]);
});
