import {
  resolveDocumentRoutingGeometry,
  resolveVisualAnchor,
  visibleInstanceBounds,
} from "@icm/derived";
import {
  createRoutePath,
  deriveStableId,
  type DraftingObject,
  type Point,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { documentObjectIds } from "@icm/edit-engine";
import { recoverDraftingOwners } from "../src/recover-drafting-owners.js";
import { draftingGroups } from "../src/drafting-groups.js";
import { pinPoints, placement } from "../src/geometry.js";
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
  const carried = final.routes.find((r) =>
    final.nets.some((n) => n.id === r.netId && !n.terminals.length),
  )!;
  expect(carried).toBeDefined();
  const inputIds = documentObjectIds(d);
  for (const id of documentObjectIds({
    ...final,
    instances: [],
    nets: [],
    drafting: { objects: [] },
    annotations: [],
  }))
    expect(inputIds.has(id)).toBe(false);
  const owner = draftingGroups(final, resolver).find((g) =>
    g.objects.some((o) => o.id === "caption"),
  )!.owner;
  expect(owner).toMatchObject({ net: "[]" });
  const original = resolveDocumentRoutingGeometry(d, resolver).routes.get(
    "conductor",
  )!.centerline;
  const moved = resolveDocumentRoutingGeometry(final, resolver).routes.get(
    carried.id,
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
  const d = fixture(true);
  const { final } = apply(d);
  const sourcePart = visibleInstanceBounds(d, resolver).find(
    (p) => p.id === "b",
  )!.bounds;
  const targetPart = visibleInstanceBounds(final, resolver).find(
    (p) => p.id === "b",
  )!.bounds;
  const x = d.junctions[0]!.position.x + targetPart.x - sourcePart.x;
  const y = d.junctions[0]!.position.y + targetPart.y - sourcePart.y;
  // The required rigid translation crosses b's body; rejection is geometric.
  expect(x).toBeGreaterThanOrEqual(targetPart.x);
  expect(x).toBeLessThanOrEqual(targetPart.x + targetPart.width);
  expect(y).toBeLessThan(targetPart.y + targetPart.height);
  expect(y + 60).toBeGreaterThan(targetPart.y);
  expect(
    final.routes.some((r) =>
      final.nets.some((n) => n.id === r.netId && !n.terminals.length),
    ),
  ).toBe(false);
});

it("reseats a small caption left outside its owner radius by ordinary R150", () => {
  const d = fixture();
  d.routes = [];
  d.junctions = [];
  const caption = note("caption", { x: 605, y: 365 });
  if (caption.kind === "text")
    caption.content = { runs: [{ kind: "text", value: "x" }] };
  d.drafting = { objects: [caption] };
  expect(draftingGroups(d, resolver)[0]!.owner).toMatchObject({
    kind: "instance",
    id: "b",
  });
  // Verified against main 8cdec30: this exact synthetic caption ends unowned.
  const { final } = apply(d);
  expect(draftingGroups(final, resolver)[0]!.owner).toMatchObject({
    kind: "instance",
    id: "b",
  });
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
  let checks = 0;
  expect(recoverDraftingOwners(d, resolver, base, () => ++checks >= 20)).toBe(
    base,
  );
  expect(checks).toBeGreaterThanOrEqual(20);
});

it("keeps locked drafting fixed without reusing its missing route id", () => {
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
  expect(
    final.routes.some((r) =>
      final.nets.some((n) => n.id === r.netId && !n.terminals.length),
    ),
  ).toBe(true);
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

it.each(["route", "junction"] as const)(
  "explicitly reanchors movable drafting to fresh carried %s ids",
  (kind) => {
    const d = fixture();
    d.drafting!.objects[0]!.anchor =
      kind === "junction"
        ? {
            kind: "object",
            objectId: "start",
            localOffset: { x: 50, y: 40 },
            fallbackPosition: { x: 850, y: 420 },
          }
        : {
            kind: "route",
            routeId: "conductor",
            legId: d.routes[0]!.legs[1]!.id,
            t: 0.6,
            normalOffset: -20,
            direction: "forward",
            orientation: "horizontal",
            fallbackPosition: { x: 848, y: 420 },
          };
    const { plan, final } = apply(d);
    const carried = final.routes.find((r) =>
      final.nets.some((n) => n.id === r.netId && !n.terminals.length),
    )!;
    expect(carried).toBeDefined();
    expect(plan.edits).toContainEqual(
      expect.objectContaining({
        kind: "upsert_drafting_object",
        object: expect.objectContaining({
          id: "caption",
          anchor: expect.objectContaining(
            kind === "route"
              ? {
                  kind: "route",
                  routeId: carried.id,
                  legId: carried.legs[1]!.id,
                }
              : {
                  kind: "object",
                  objectId: deriveStableId(
                    "auto-layout-carried-junction",
                    "start",
                    "0",
                  ),
                },
          ),
        }),
      }),
    );
    expect(draftingGroups(final, resolver)[0]!.owner).toMatchObject({
      net: "[]",
    });
  },
);

it.each([
  { search: { seed: 1, evaluations: 0 } },
  { quality: "optimized" as const },
  { partition: { blocks: [] } },
])(
  "does not recover free conductors outside plain nonzero-budget planning: %j",
  (options) => {
    const d = fixture();
    const plan = planAutoLayout(d, resolver, options);
    const final = preview(d, resolver, plan.edits);
    if (!final.ok) throw Error(JSON.stringify(final.diagnostics));
    expect(
      final.document.routes.some((r) =>
        final.document.nets.some(
          (n) => n.id === r.netId && !n.terminals.length,
        ),
      ),
    ).toBe(false);
  },
);

it("returns the ordinary result when cancelled inside conductor recovery", () => {
  const d = fixture();
  const base = planAutoLayout(d, resolver, {
    search: { seed: 1, evaluations: 0 },
  });
  let checks = 0;
  expect(recoverDraftingOwners(d, resolver, base, () => ++checks >= 3)).toBe(
    base,
  );
  expect(checks).toBeGreaterThanOrEqual(3);
});

it.each(["pin", "junction", "wire"] as const)(
  "rejects a carried conductor touching a terminal-Net %s",
  (contact) => {
    const d = fixture();
    // The ordinary result keeps b fixed, so the carried segment would be
    // x=800, y=380..440. Author the terminal conductor across that segment.
    const base = {
      edits: [
        { kind: "remove_route_geometry" as const, routeId: "conductor" },
        ...d.junctions.map((j) => ({
          kind: "remove_junction" as const,
          junctionId: j.id,
        })),
      ] as import("@icm/edit-engine").SchematicEdit[],
      groups: [],
      diagnostics: [],
    };
    if (contact === "pin") {
      const pin = pinPoints(d, resolver).find(
        (p) => p.instanceId === "a" && p.pinName === "2",
      )!;
      base.edits.push({
        kind: "move_instance",
        instanceId: "a",
        position: {
          x: 800 - pin.point.x,
          y: 400 + 380 - pin.point.y,
        },
      });
    } else {
      const point = { x: contact === "junction" ? 800 : 820, y: 410 };
      base.edits.push({
        kind: "add_junction",
        junctionId: "terminal-end",
        netId: "signal",
        position: point,
      });
      base.edits.push({
        kind: "set_route_path",
        route: createRoutePath({
          id: "terminal-wire",
          netId: "signal",
          start: { kind: "terminal", instanceId: "a", pinName: "2" },
          end: { kind: "junction", junctionId: "terminal-end" },
          bends: [{ x: 780, y: 410 }],
          modes: ["manual", "manual"],
        }),
      });
    }
    const placed = preview(d, resolver, base.edits);
    if (!placed.ok) throw Error(JSON.stringify(placed.diagnostics));
    if (contact === "pin") {
      expect(pinPoints(placed.document, resolver)).toContainEqual(
        expect.objectContaining({
          instanceId: "a",
          pinName: "2",
          point: { x: 800, y: 380 },
        }),
      );
    } else {
      const terminalRoute = placed.document.routes.find(
        (r) => r.id === "terminal-wire",
      )!;
      expect(
        placed.document.nets.find((n) => n.id === terminalRoute.netId)!
          .terminals.length,
      ).toBeGreaterThan(0);
      const segments = resolveDocumentRoutingGeometry(
        placed.document,
        resolver,
      ).routes.get(terminalRoute.id)!.segments;
      expect(segments).toContainEqual(
        expect.objectContaining({
          from: { x: 780, y: 410 },
          to: { x: contact === "junction" ? 800 : 820, y: 410 },
        }),
      );
    }
    expect(recoverDraftingOwners(d, resolver, base)).toEqual(base);
  },
);

it("salts carried identities against removed input object ids", () => {
  const d = fixture();
  const reserved = deriveStableId(
    "auto-layout-carried-route",
    "conductor",
    "0",
  );
  d.drafting!.objects.push({
    ...note(reserved, { x: -2000, y: -2000 }),
    locked: true,
  });
  const { final } = apply(d);
  const carried = final.routes.find((r) =>
    final.nets.some((n) => n.id === r.netId && !n.terminals.length),
  )!;
  expect(carried).toBeDefined();
  expect(carried.id).not.toBe(reserved);
  expect(documentObjectIds(d).has(carried.id)).toBe(false);
});

it("keeps an improving carried Net when another isolated Net fails scoring", () => {
  const d = fixture();
  d.nets.unshift({ id: "unhelpful", terminals: [] });
  d.junctions.push(
    {
      id: "unhelpful-start",
      netId: "unhelpful",
      position: { x: 1200, y: 600 },
    },
    { id: "unhelpful-end", netId: "unhelpful", position: { x: 1300, y: 600 } },
  );
  d.routes.push(
    createRoutePath({
      id: "unhelpful-route",
      netId: "unhelpful",
      start: { kind: "junction", junctionId: "unhelpful-start" },
      end: { kind: "junction", junctionId: "unhelpful-end" },
      bends: [],
      modes: ["manual"],
    }),
  );
  const { final } = apply(d);
  expect(
    final.routes.some(
      (r) =>
        r.id ===
        deriveStableId("auto-layout-carried-route", "unhelpful-route", "0"),
    ),
  ).toBe(false);
  expect(
    final.routes.some(
      (r) =>
        r.id === deriveStableId("auto-layout-carried-route", "conductor", "0"),
    ),
  ).toBe(true);
  expect(draftingGroups(final, resolver)[0]!.owner).toMatchObject({
    net: "[]",
  });
});

it.each(["junction", "horizontal route", "vertical route"] as const)(
  "preserves the clearance seat of touching captions anchored to a %s",
  (kind) => {
    const d = fixture();
    d.drafting!.objects[0]!.anchor = {
      kind: "object",
      objectId: "start",
      localOffset: { x: 50, y: 40 },
      fallbackPosition: { x: 850, y: 420 },
    };
    if (kind !== "junction")
      d.drafting!.objects[0]!.anchor = {
        kind: "route",
        routeId: "conductor",
        legId: d.routes[0]!.legs[kind === "horizontal route" ? 1 : 0]!.id,
        t: kind === "horizontal route" ? 0.625 : 2 / 3,
        normalOffset: kind === "horizontal route" ? -20 : -50,
        direction: "forward",
        orientation: "horizontal",
        fallbackPosition: { x: 850, y: 420 },
      };
    d.drafting!.objects.push(note("peer", { x: 880, y: 420 }), {
      ...note("obstacle", { x: 308, y: 394 }),
      locked: true,
    });
    expect(draftingGroups(d, resolver)[0]!.objects.map((o) => o.id)).toEqual([
      "caption",
      "peer",
    ]);
    const { final } = apply(d);
    const captions = final
      .drafting!.objects.slice(0, 2)
      .map((o) => resolveVisualAnchor(final, resolver, o.anchor).position);
    // R150 seats both captions ten units below their owner's rigid translation.
    // Reattaching the first caption must keep that clearance offset.
    expect(captions).toEqual([
      { x: 310, y: 420 },
      { x: 340, y: 420 },
    ]);
    const restored = final.drafting!.objects[0]!.anchor;
    expect(restored.kind).toBe(kind === "junction" ? "object" : "route");
    expect(resolveVisualAnchor(final, resolver, restored).resolved).toBe(true);
    expect(final.drafting!.objects[2]).toEqual(d.drafting!.objects[2]);
    expect(
      final.routes.some((r) =>
        final.nets.some((n) => n.id === r.netId && !n.terminals.length),
      ),
    ).toBe(true);
  },
);

it("keeps a mixed-anchor arrow rigid at its clearance seat", () => {
  const d = fixture();
  const from = {
    kind: "route" as const,
    routeId: "conductor",
    legId: d.routes[0]!.legs[1]!.id,
    t: 0.625,
    normalOffset: -20,
    direction: "forward" as const,
    orientation: "horizontal" as const,
    fallbackPosition: { x: 850, y: 420 },
  };
  d.drafting!.objects.push(
    note("peer", { x: 880, y: 420 }),
    {
      id: "pointer",
      kind: "arrow",
      locked: false,
      zIndex: 0,
      anchor: from,
      from,
      to: { kind: "free", position: { x: 880, y: 420 } },
    },
    { ...note("obstacle", { x: 308, y: 394 }), locked: true },
  );
  const { final } = apply(d);
  const arrow = final.drafting!.objects.find((o) => o.id === "pointer")!;
  if (arrow.kind !== "arrow") throw Error("missing arrow");
  expect(resolveVisualAnchor(final, resolver, arrow.from).position).toEqual({
    x: 310,
    y: 420,
  });
  expect(resolveVisualAnchor(final, resolver, arrow.to).position).toEqual({
    x: 340,
    y: 420,
  });
  expect(resolveVisualAnchor(final, resolver, arrow.anchor).position).toEqual({
    x: 310,
    y: 420,
  });
  expect(arrow.from.kind).toBe("route");
});
