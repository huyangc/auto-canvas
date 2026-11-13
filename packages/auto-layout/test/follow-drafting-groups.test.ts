import { resolveVisualAnchor, visibleInstanceBounds } from "@icm/derived";
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
