import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createRoutePath, type SchematicDocument } from "@icm/model";
import { visibleInstanceBounds } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import * as compaction from "../src/compact.js";
import { planAutoLayout } from "../src/auto-layout.js";
import {
  enclosingBox,
  pinPoints,
  placement,
  withPlacements,
} from "../src/geometry.js";
import { emptyChoices } from "../src/layout-choices.js";
import { routedScore } from "../src/refine.js";
import { preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function horizontal() {
  const document = circuit(
    { left: "resistor", right: "resistor" },
    { signal: ["left.1", "right.1"] },
  );
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(300, 0);
  document.routes.push(
    createRoutePath({
      id: "wire",
      netId: "signal",
      start: { kind: "terminal", instanceId: "left", pinName: "1" },
      end: { kind: "terminal", instanceId: "right", pinName: "1" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}
const compact = (d: SchematicDocument, rigid: string[][] = []) =>
  compaction.compactPlacements(d, resolver, rigid);

it("R97 removes grid-floored empty columns, preserving y, order and the left edge deterministically", () => {
  const document = horizontal();
  document.presentation.grid = 20;
  const boxes = visibleInstanceBounds(document, resolver).map((b) => b.bounds);
  const width =
    Math.floor((boxes[1]!.x - boxes[0]!.x - boxes[0]!.width - 40) / 20) * 20;
  expect(width).toBeGreaterThan(0);
  const result = compact(document)!;
  expect(result).toEqual(compact(document));
  expect(result.get("left")).toEqual(document.instances[0]!.placement);
  expect(result.get("right")!.position.x).toBe(300 - width);
  for (const instance of document.instances) {
    expect(result.get(instance.id)!.position.y).toBe(
      instance.placement!.position.y,
    );
    expect(result.get(instance.id)!.rotation).toBe(
      instance.placement!.rotation,
    );
    expect(result.get(instance.id)!.mirror).toBe(instance.placement!.mirror);
  }
  const after = withPlacements(document, result);
  expect(enclosingBox(after, resolver).x).toBe(
    enclosingBox(document, resolver).x,
  );
  expect(result.get("left")!.position.x).toBeLessThan(
    result.get("right")!.position.x,
  );
  expect(enclosingBox(after, resolver).width).toBeCloseTo(
    enclosingBox(document, resolver).width - width,
  );
});

it.each(["vertical wire", "junction", "rigid unit"])(
  "R97 keeps columns occupied by a %s",
  (kind) => {
    const document = horizontal();
    const plain = compact(document)!.get("right")!.position.x;
    if (kind === "rigid unit") {
      expect(compact(document, [["left", "right"]])).toBeUndefined();
      return;
    }
    if (kind === "junction")
      document.junctions.push({
        id: "mid",
        netId: "signal",
        position: { x: 150, y: 200 },
        role: "branch",
      });
    else {
      // A vertical internal segment occupies a column even without a Junction.
      document.routes[0] = createRoutePath({
        id: "wire",
        netId: "signal",
        start: { kind: "terminal", instanceId: "left", pinName: "1" },
        end: { kind: "terminal", instanceId: "right", pinName: "1" },
        bends: [
          { x: 150, y: -40 },
          { x: 150, y: -100 },
          { x: 300, y: -100 },
        ],
        modes: ["manual", "manual", "manual", "manual"],
      });
    }
    expect(compact(document)!.get("right")!.position.x).toBeGreaterThanOrEqual(
      plain + 20,
    );
  },
);

it("R97 keeps edge Cell Pins 80 units from the device box", () => {
  const document = horizontal();
  const box = enclosingBox(document, resolver);
  document.instances.push(
    { id: "input", symbolId: "port", placement: placement(box.x - 80, 0) },
    {
      id: "output",
      symbolId: "port-filled",
      placement: placement(box.x + box.width + 80, 0, "horizontal"),
    },
  );
  const after = withPlacements(document, compact(document)!);
  const devices = enclosingBox(
    {
      ...after,
      instances: after.instances.filter((i) =>
        ["left", "right"].includes(i.id),
      ),
    },
    resolver,
  );
  expect(
    after.instances.find((i) => i.id === "input")!.placement!.position.x,
  ).toBe(devices.x - 80);
  expect(
    after.instances.find((i) => i.id === "output")!.placement!.position.x,
  ).toBe(devices.x + devices.width + 80);
});

it("R97 keeps an internal local Cell Pin's full horizontal 80-unit seat", () => {
  const document = horizontal();
  document.instances[0]!.placement = placement(0, 0, "none", 90);
  const host = pinPoints(document, resolver).find(
    (p) => p.instanceId === "left" && p.pinName === "1",
  )!.point;
  // Choose the outward horizontal exit, inside the overall device box.
  const x = host.x > 0 ? host.x + 80 : host.x - 80;
  document.instances[1]!.placement = placement(x > 0 ? 400 : -400, 120);
  document.instances.push({
    id: "local",
    symbolId: "port",
    placement: placement(x, host.y),
  });
  document.routes = [
    createRoutePath({
      id: "seat",
      netId: "signal",
      start: { kind: "terminal", instanceId: "left", pinName: "1" },
      end: { kind: "terminal", instanceId: "local", pinName: "P" },
      bends: [],
      modes: ["manual"],
    }),
  ];
  const result = compact(document)!;
  expect(result).toBeDefined();
  const pins = pinPoints(withPlacements(document, result), resolver);
  expect(
    Math.abs(
      pins.find((p) => p.instanceId === "local")!.point.x -
        pins.find((p) => p.instanceId === "left" && p.pinName === "1")!.point.x,
    ),
  ).toBe(80);
});

it("R97 returns nothing when there are no instance bounds or no empty columns", () => {
  expect(compact(circuit({}, {}))).toBeUndefined();
  const document = horizontal();
  document.instances[1]!.placement = placement(40, 0);
  expect(compact(document)).toBeUndefined();
});

it("R97 compacts the routed finalist only for a strict score decrease and repeats without moves", () => {
  const document = circuit(
    { a: "opamp", b: "opamp", c: "opamp", d: "opamp" },
    {
      n0: ["a.IN+", "a.IN-", "b.OUT"],
      n1: ["a.OUT", "b.IN-", "c.IN+", "c.OUT"],
      n4: ["b.IN+", "c.IN-", "d.OUT"],
      n2: ["d.IN+"],
      n3: ["d.IN-"],
    },
  );
  const spy = vi.spyOn(compaction, "compactPlacements");
  try {
    const result = planAutoLayout(document, resolver, {
      search: { seed: 1, evaluations: 0 },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const finalist = spy.mock.calls[0]![0];
    const applied = preview(document, resolver, result.edits);
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error("Compaction transaction refused");
    const score = (final: SchematicDocument) =>
      routedScore({ final, result, choices: emptyChoices() }, resolver);
    expect(enclosingBox(applied.document, resolver).width).toBeLessThan(
      enclosingBox(finalist, resolver).width,
    );
    expect(score(applied.document)).toBeLessThan(score(finalist));
    const repeated = planAutoLayout(applied.document, resolver, {
      search: { seed: 1, evaluations: 0 },
    });
    expect(repeated.diagnostics).toEqual([]);
    expect(
      repeated.edits.filter((e) =>
        ["move_instance", "rotate_instance", "mirror_instance"].includes(
          e.kind,
        ),
      ),
    ).toEqual([]);
  } finally {
    spy.mockRestore();
  }
}, 30000);

// Captured from an isolated build of 88eab98 with these exact synthetic inputs.
it.each([
  ["fixed", "6ee4f7826e96021fb2ae13cfa080e53408f9a5333f88ab8d0ff4b364ecc7dd13"],
  [
    "partition",
    "1f396348663a470e235f58fd0398529ba824e3bc96f9a595624d834f6d541456",
  ],
])(
  "R97 skips %s layouts, retaining byte-identical base edits",
  (kind, hash) => {
    const document = circuit(
      { a: "resistor", b: "resistor" },
      { signal: ["a.1", "b.1"] },
    );
    document.instances.forEach((instance, index) => {
      instance.placement = placement(index * 300, 0);
    });
    const spy = vi.spyOn(compaction, "compactPlacements");
    try {
      const result = planAutoLayout(
        document,
        resolver,
        kind === "fixed"
          ? {
              search: { seed: 1, evaluations: 0 },
              fixedInstanceIds: new Set(["a"]),
            }
          : {
              search: { seed: 1, evaluations: 0 },
              partition: { blocks: [{ id: "block", members: ["a", "b"] }] },
            },
      );
      expect(result.diagnostics).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
      expect(
        createHash("sha256").update(JSON.stringify(result.edits)).digest("hex"),
      ).toBe(hash);
    } finally {
      spy.mockRestore();
    }
  },
);
