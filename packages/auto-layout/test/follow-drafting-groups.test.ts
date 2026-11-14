import {
  resolveEndpointPoint,
  resolveVisualAnchor,
  visibleInstanceBounds,
} from "@icm/derived";
import { createRoutePath, type DraftingObject, type Point } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planAutoLayout } from "../src/index.js";
import {
  draftingDisplacements,
  draftingGroups,
} from "../src/drafting-groups.js";
import {
  boxesIntersect,
  draftingBounds,
  enclosingBox,
  placement,
} from "../src/geometry.js";
import { preview, terminalPartition } from "../src/transaction.js";
import { planningTiming } from "../src/timing.js";
import { draftingTranslation } from "../src/drafting-search.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const note = (
  id: string,
  position: Point,
): Extract<DraftingObject, { kind: "text" }> => ({
  id,
  kind: "text",
  anchor: { kind: "free", position },
  locked: false,
  zIndex: 0,
  alignment: "middle",
  rotation: 0,
  content: { runs: [{ kind: "text", value: "note" }] },
});
function fixture() {
  const d = circuit({ a: "resistor", b: "resistor" }, { wire: ["a.2", "b.1"] });
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(600, 400);
  return d;
}
function apply(d: ReturnType<typeof fixture>) {
  const result = planAutoLayout(d, resolver);
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const tx = preview(d, resolver, result.edits);
  if (!tx.ok) throw Error(JSON.stringify(tx.diagnostics));
  expect(terminalPartition(tx.document, resolver)).toBe(
    terminalPartition(d, resolver),
  );
  return { result, final: tx.document };
}
const point = (d: ReturnType<typeof fixture>, id: string) =>
  resolveVisualAnchor(
    d,
    resolver,
    d.drafting!.objects.find((o) => o.id === id)!.anchor,
  ).position;

it("R150 moves a device note, preserves its content, and produces deterministic edits", () => {
  const d = fixture();
  d.drafting = { objects: [note("caption", { x: 645, y: 400 })] };
  const original = structuredClone(d);
  expect(draftingGroups(d, resolver)[0]!.owner).toMatchObject({
    kind: "instance",
    id: "b",
  });
  const { result, final } = apply(d);
  // The input note is near its old owner, but clear of the finished base's
  // devices. Reusing that base must still carry the note to its new owner.
  expect(planningTiming(result)!.phases.drafting).toBe(0);
  expect(point(final, "caption")).not.toEqual(point(d, "caption"));
  const oldPart = d.instances[1]!.placement!.position,
    newPart = final.instances[1]!.placement!.position;
  expect(
    Math.hypot(
      point(final, "caption").x - newPart.x - (645 - oldPart.x),
      point(final, "caption").y - newPart.y,
    ),
  ).toBeLessThanOrEqual(60);
  expect(final.drafting!.objects[0]).toMatchObject({
    content:
      d.drafting.objects[0]!.kind === "text"
        ? d.drafting.objects[0]!.content
        : undefined,
  });
  expect(apply(d).result).toEqual(result);
  expect(d).toEqual(original);
});

it("R150 moves a title and a separate caption as one block above the circuit", () => {
  const d = fixture();
  d.drafting = {
    objects: [
      note("title", { x: 300, y: -200 }),
      note("subtitle", { x: 300, y: -240 }),
    ],
  };
  expect(draftingGroups(d, resolver).every((g) => !g.owner)).toBe(true);
  const { result, final } = apply(d);
  // R150 reuses the base plan when remote ink never triggered R10. Seating
  // still follows the title, even though the second planner did not run.
  expect(planningTiming(result)!.phases.drafting).toBe(0);
  expect(point(final, "title").x).not.toBe(300);
  expect(point(final, "subtitle").y - point(final, "title").y).toBe(-40);
  expect(point(final, "subtitle").x).toBe(point(final, "title").x);
  expect(point(final, "title").y).toBeLessThan(enclosingBox(final, resolver).y);
});

it("R150 retains its second pass when unowned ink causes an R10 translation", () => {
  const d = fixture();
  d.drafting = { objects: [note("obstacle", { x: 80, y: 0 })] };
  expect(draftingGroups(d, resolver).every((g) => !g.owner)).toBe(true);
  const { result } = apply(d);
  expect(planningTiming(result)!.phases.drafting).toBeGreaterThan(0);
  // A translated run must not leave an observation active for the next call.
  d.drafting.objects = [note("title", { x: 300, y: -200 })];
  const next = apply(d).result;
  expect(planningTiming(next)!.phases.drafting).toBe(0);
  expect(apply(structuredClone(d)).result).toEqual(next);
});

it.each([
  { x: 160, accepted: true },
  { x: 80, accepted: false },
])(
  "R150 searches once and keeps the compared seats (accepted=$accepted)",
  ({ x, accepted }) => {
    const d = fixture();
    d.drafting = { objects: [note("obstacle", { x, y: 0 })] };
    const fixedInk = structuredClone(d);
    fixedInk.drafting!.objects[0]!.locked = true;
    const base = apply(fixedInk);
    const shift = draftingTranslation(base.result);
    expect(shift).toBeGreaterThan(0);

    const { result, final } = apply(d);
    expect(planningTiming(result)!.phaseCalls).toMatchObject({
      annealer: 1,
      relocation: 1,
      ports: 1,
      rails: 1,
      gaps: 1,
      drafting: 1,
      draftingFallback: 0,
    });
    expect(final.instances.map((i) => i.placement)).toEqual(
      base.final.instances.map((i) => ({
        ...i.placement!,
        position: {
          x: i.placement!.position.x,
          y: i.placement!.position.y - (accepted ? shift : 0),
        },
      })),
    );
    expect(apply(d).result).toEqual(result);
  },
);

it("R150 keeps unowned and locked ink fixed when undoing R10", () => {
  const d = fixture();
  d.drafting = {
    objects: [
      note("obstacle", { x: 160, y: 0 }),
      note("remote", { x: 1000, y: -1000 }),
      { ...note("locked", { x: 1200, y: -1000 }), locked: true },
    ],
  };
  expect(draftingGroups(d, resolver).every((g) => !g.owner)).toBe(true);
  const fixedInk = structuredClone(d);
  for (const object of fixedInk.drafting!.objects) object.locked = true;
  const base = apply(fixedInk);
  const shift = draftingTranslation(base.result);
  expect(shift).toBeGreaterThan(0);
  const { result, final } = apply(d);
  expect(planningTiming(result)!.phaseCalls).toMatchObject({
    annealer: 1,
    drafting: 1,
    draftingFallback: 0,
  });
  expect(final.instances.map((i) => i.placement!.position)).toEqual(
    base.final.instances.map((i) => ({
      x: i.placement!.position.x,
      y: i.placement!.position.y - shift,
    })),
  );
  expect(final.drafting).toEqual(d.drafting);
});

it("R150 follows an owned caption while fixed ink keeps the R10 base placements", () => {
  const d = fixture();
  d.drafting = {
    objects: [
      note("obstacle", { x: 80, y: 0 }),
      note("caption", { x: 645, y: 400 }),
      {
        id: "box",
        kind: "rectangle",
        anchor: { kind: "free", position: { x: 645, y: 394 } },
        center: { x: 645, y: 394 },
        width: 60,
        height: 30,
        rotation: 0,
        lineStyle: "solid",
        locked: false,
        zIndex: 0,
      },
      { ...note("locked", { x: 1000, y: -1000 }), locked: true },
    ],
  };
  const fixedInk = structuredClone(d);
  for (const object of fixedInk.drafting!.objects) object.locked = true;
  const base = apply(fixedInk);
  expect(draftingTranslation(base.result)).toBeGreaterThan(0);
  const { result, final } = apply(d);
  expect(final.instances).toEqual(base.final.instances);
  expect(final.routes).toEqual(base.final.routes);
  expect(final.junctions).toEqual(base.final.junctions);
  expect(point(final, "caption")).not.toEqual(point(d, "caption"));
  expect(point(final, "box")).toEqual({
    x: point(final, "caption").x,
    y: point(final, "caption").y - 6,
  });
  for (const id of ["obstacle", "locked"])
    expect(final.drafting!.objects.find((o) => o.id === id)).toEqual(
      d.drafting.objects.find((o) => o.id === id),
    );
  expect(apply(d).result).toEqual(result);
});

function pinlessFixture() {
  const d = fixture();
  d.nets.push({ id: "pinless", terminals: [] });
  d.junctions = [
    { id: "start", netId: "pinless", position: { x: 645, y: 360 } },
    { id: "end", netId: "pinless", position: { x: 645, y: 440 } },
  ];
  d.routes = [
    createRoutePath({
      id: "pinless-wire",
      netId: "pinless",
      start: { kind: "junction", junctionId: "start" },
      end: { kind: "junction", junctionId: "end" },
      bends: [],
      modes: ["manual"],
    }),
  ];
  d.drafting = { objects: [note("caption", { x: 645, y: 400 })] };
  return d;
}

it("R150 follows the nearest source device when a pinless wire disappears", () => {
  const d = pinlessFixture();
  const groups = draftingGroups(d, resolver);
  expect(groups[0]!.owner).toMatchObject({ kind: "route", net: "[]" });
  const original = structuredClone(d);
  const { result, final } = apply(d);
  expect(final.nets.some((n) => n.id === "pinless")).toBe(false);
  const oldPart = visibleInstanceBounds(d, resolver).find((p) => p.id === "b")!;
  const newPart = visibleInstanceBounds(final, resolver).find(
    (p) => p.id === "b",
  )!;
  expect(
    draftingDisplacements(d, final, resolver, groups)!.get(groups[0]!),
  ).toEqual({
    x:
      newPart.bounds.x +
      newPart.bounds.width / 2 -
      oldPart.bounds.x -
      oldPart.bounds.width / 2,
    y:
      newPart.bounds.y +
      newPart.bounds.height / 2 -
      oldPart.bounds.y -
      oldPart.bounds.height / 2,
  });
  expect(point(final, "caption")).not.toEqual(point(d, "caption"));
  expect(draftingGroups(final, resolver)[0]!.owner).toBeDefined();
  expect(groups[0]!.owner).toMatchObject({ kind: "route", net: "[]" });
  expect(apply(d).result).toEqual(result);
  expect(d).toEqual(original);
});

it("R150 breaks equidistant pinless fallback ties by id, not source order", () => {
  const d = pinlessFixture();
  d.instances[0]!.placement = placement(690, 400);
  const groups = draftingGroups(d, resolver);
  const final = structuredClone(d);
  final.instances[0]!.placement = placement(790, 600);
  final.instances[1]!.placement = placement(400, 400);
  const displacement = () => draftingDisplacements(d, final, resolver, groups);
  expect(displacement()!.get(groups[0]!)).toEqual({ x: 100, y: 200 });
  d.instances.reverse();
  expect(displacement()!.get(groups[0]!)).toEqual({ x: 100, y: 200 });
  final.instances[0]!.placement = null;
  expect(displacement()).toBeUndefined();
  d.instances = [];
  expect(displacement()).toBeUndefined();
});

it.each(["object", "layoutGroup", "constraint"])(
  "R150 leaves a pinless caption fixed under a %s lock",
  (lock) => {
    const d = pinlessFixture();
    d.drafting!.objects.push(note("touching", { x: 645, y: 400 }));
    if (lock === "object") d.drafting!.objects[0]!.locked = true;
    else if (lock === "layoutGroup")
      d.layoutGroups.push({
        id: "lock",
        kind: "custom",
        objectIds: ["caption"],
        locked: true,
      });
    else
      d.constraints.push({
        id: "lock",
        kind: "align-x",
        objectIds: ["caption", "touching"],
        locked: true,
      });
    expect(draftingGroups(d, resolver)).toEqual([]);
    expect(apply(d).final.drafting).toEqual(d.drafting);
  },
);

it("R150 keeps an arrow and touching text together beside their wire", () => {
  const d = fixture();
  d.instances[0]!.placement = placement(0, 0, "none", 90);
  d.instances[1]!.placement = placement(600, 0, "none", 90);
  d.routes = [
    createRoutePath({
      id: "old-wire",
      netId: "wire",
      start: { kind: "terminal", instanceId: "a", pinName: "2" },
      end: { kind: "terminal", instanceId: "b", pinName: "1" },
      bends: [],
      modes: ["manual"],
    }),
  ];
  const from = { kind: "free" as const, position: { x: 300, y: -40 } };
  d.drafting = {
    objects: [
      note("caption", { x: 300, y: -38 }),
      {
        id: "pointer",
        kind: "arrow",
        locked: false,
        zIndex: 0,
        anchor: from,
        from,
        to: { kind: "free", position: { x: 300, y: -8 } },
      },
    ],
  };
  const groups = draftingGroups(d, resolver);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.owner).toMatchObject({ kind: "route" });
  const { final } = apply(d);
  const arrow = final.drafting!.objects.find((o) => o.id === "pointer")!;
  if (arrow.kind !== "arrow") throw Error("missing arrow");
  const at = resolveVisualAnchor(final, resolver, arrow.from).position;
  expect(at.x).not.toBe(300);
  expect(point(final, "caption")).toEqual({ x: at.x, y: at.y + 2 });
  expect(resolveVisualAnchor(final, resolver, arrow.to).position).toEqual({
    x: at.x,
    y: at.y + 32,
  });
});

it("R150 leaves a locked note and its touching box unchanged", () => {
  const d = fixture();
  const locked = { ...note("locked", { x: 645, y: 400 }), locked: true };
  d.drafting = {
    objects: [
      locked,
      {
        id: "box",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: locked.anchor,
        center: { x: 645, y: 394 },
        width: 60,
        height: 30,
        rotation: 0,
        lineStyle: "solid",
      },
    ],
  };
  expect(draftingGroups(d, resolver)).toEqual([]);
  expect(apply(d).final.drafting).toEqual(d.drafting);
});

it("R150 seats a colliding note near its owner without covering a device", () => {
  const d = fixture();
  d.drafting = { objects: [note("caption", { x: 645, y: 400 })] };
  const { final } = apply(d);
  const groups = draftingGroups(d, resolver);
  const delta = draftingDisplacements(d, final, resolver, groups)!.get(
    groups[0]!,
  )!;
  const original = draftingBounds(d, resolver)[0]!.bounds;
  expect(
    visibleInstanceBounds(d, resolver).some((p) =>
      boxesIntersect(p.bounds, original),
    ),
  ).toBe(false);
  const preferred = {
    ...original,
    x: original.x + Math.round(delta.x),
    y: original.y + Math.round(delta.y),
  };
  expect(
    visibleInstanceBounds(final, resolver).some((p) =>
      boxesIntersect(p.bounds, preferred),
    ),
  ).toBe(true);
  expect(point(final, "caption")).not.toEqual(point(d, "caption"));
  const box = draftingBounds(final, resolver)[0]!.bounds;
  expect(
    visibleInstanceBounds(final, resolver).some((p) =>
      boxesIntersect(p.bounds, box),
    ),
  ).toBe(false);
});

it("R150 follows a pseudo-port when routing removes its single-pin wire", () => {
  const d = circuit({ a: "resistor" }, { input: ["a.1"] });
  d.instances[0]!.placement = placement(600, 400);
  d.junctions = [{ id: "end", netId: "input", position: { x: 500, y: 380 } }];
  d.routes = [
    createRoutePath({
      id: "input-wire",
      netId: "input",
      start: { kind: "junction", junctionId: "end" },
      end: { kind: "terminal", instanceId: "a", pinName: "1" },
      bends: [],
      modes: ["manual"],
    }),
  ];
  d.drafting = {
    objects: [
      {
        id: "port",
        kind: "circle",
        anchor: { kind: "free", position: { x: 495, y: 380 } },
        center: { x: 495, y: 380 },
        radius: 5,
        lineStyle: "solid",
        locked: false,
        zIndex: 0,
      },
      note("caption", { x: 470, y: 380 }),
    ],
  };
  expect(draftingGroups(d, resolver)).toHaveLength(1);
  const { final, result } = apply(d);
  const pin = resolveEndpointPoint(final, resolver, {
    kind: "terminal",
    instanceId: "a",
    pinName: "1",
  })!;
  const groups = draftingGroups(d, resolver);
  // The authored wire end is gone; its Net has exactly one surviving pin.
  expect(final.routes).toEqual([]);
  expect(
    draftingDisplacements(d, final, resolver, groups)!.get(groups[0]!),
  ).toEqual({
    x: pin.x - 500,
    y: pin.y - 380,
  });
  expect(point(final, "port")).not.toEqual(point(d, "port"));
  expect(
    Math.hypot(point(final, "port").x - pin.x, point(final, "port").y - pin.y),
  ).toBeLessThanOrEqual(60);
  expect(point(final, "caption")).toEqual({
    x: point(final, "port").x - 25,
    y: point(final, "port").y,
  });
  expect(draftingGroups(final, resolver)[0]!.owner).toBeDefined();
  expect(apply(d).result).toEqual(result);
});

it("R150 follows a device note alongside a pinless junction's caption", () => {
  const d = fixture();
  d.nets.push({ id: "orphan", terminals: [] });
  d.junctions.push({
    id: "orphan-end",
    netId: "orphan",
    position: { x: 1000, y: 1000 },
  });
  d.drafting = {
    objects: [
      note("caption", { x: 645, y: 400 }),
      note("orphan-caption", { x: 1000, y: 990 }),
    ],
  };
  expect(draftingGroups(d, resolver)[1]!.owner).toMatchObject({
    kind: "junction",
    net: "[]",
  });
  const { final, result } = apply(d);
  expect(point(final, "caption")).not.toEqual(point(d, "caption"));
  expect(point(final, "orphan-caption")).toEqual({
    x: 1000 + final.instances[1]!.placement!.position.x - 600,
    y: 990 + final.instances[1]!.placement!.position.y - 400,
  });
  expect(
    draftingGroups(final, resolver).find((g) =>
      g.objects.some((o) => o.id === "caption"),
    )!.owner,
  ).toBeDefined();
  expect(apply(d).result).toEqual(result);
});

it("R150 keeps a touching pseudo-port on the same amplifier input after mirroring", () => {
  const d = circuit({ amp: "opamp" }, {});
  d.instances[0]!.placement = placement(600, 400, "vertical");
  const endpoint = {
    kind: "terminal" as const,
    instanceId: "amp",
    pinName: "IN+",
  };
  const oldPin = resolveEndpointPoint(d, resolver, endpoint)!;
  const center = { x: oldPin.x - 5, y: oldPin.y };
  d.drafting = {
    objects: [
      {
        id: "port",
        kind: "circle",
        anchor: { kind: "free", position: center },
        center,
        radius: 5,
        lineStyle: "solid",
        locked: false,
        zIndex: 0,
      },
      note("caption", { x: center.x - 25, y: center.y }),
    ],
  };
  const { final } = apply(d);
  const pin = resolveEndpointPoint(final, resolver, endpoint)!;
  const groups = draftingGroups(d, resolver);
  expect(
    draftingDisplacements(d, final, resolver, groups)!.get(groups[0]!),
  ).toEqual({ x: pin.x - oldPin.x, y: pin.y - oldPin.y });
  const otherPin = resolveEndpointPoint(final, resolver, {
    ...endpoint,
    pinName: "IN-",
  })!;
  const port = point(final, "port");
  expect(Math.hypot(port.x - pin.x, port.y - pin.y)).toBeLessThan(
    Math.hypot(port.x - otherPin.x, port.y - otherPin.y),
  );
});
