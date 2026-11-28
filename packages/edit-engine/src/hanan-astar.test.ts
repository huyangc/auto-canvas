import { expect, it } from "vitest";
import { deriveNetConnectivityContext } from "@icm/derived";
import {
  createEmptyDocument,
  createRoutePath,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { createRouteClearance } from "./route-clearance.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const start = { x: -160, y: 0 },
  end = { x: 160, y: 0 };
function clearance(
  doc: SchematicDocument,
  pathSearch?: "pattern" | "hanan-fallback",
) {
  return createRouteClearance(
    doc,
    resolver,
    deriveNetConnectivityContext(doc, resolver),
    {
      logicalIds: new Set(),
      endpointKeys: new Set(),
      crossingCost: 1000,
      ...(pathSearch ? { pathSearch } : {}),
    },
  );
}

it("weaves between offset walls beyond the pattern detour limit", () => {
  const doc = createEmptyDocument("maze", "Maze");
  doc.presentation.grid = 10;
  for (const x of [-60, 60])
    for (let y = x < 0 ? -220 : -20; y <= (x < 0 ? 20 : 220); y += 20)
      doc.instances.push({
        id: `wall-${x}-${y}`,
        symbolId: "resistor",
        placement: { position: { x, y }, rotation: 0, mirror: "none" },
      });
  const baseline = clearance(doc).path(start, end);
  expect(baseline).toContain("no clear path");
  expect(clearance(doc, "pattern").path(start, end)).toEqual(baseline);
  const router = clearance(doc, "hanan-fallback"),
    path = router.path(start, end);
  expect(typeof path).toBe("object");
  if (typeof path === "string") throw Error(path);
  expect(path.waypoints.length).toBeGreaterThan(2);
  expect(router.conflict(path.points!, [])).toBeNull();
  expect(
    path.points!.every(
      (p, i, ps) => !i || ps[i - 1]!.x === p.x || ps[i - 1]!.y === p.y,
    ),
  ).toBe(true);
  expect(clearance(doc, "hanan-fallback").path(start, end)).toEqual(path);
});

it("chooses the perimeter when all pattern detours cross a foreign wire", () => {
  const doc = createEmptyDocument("cross", "Crossings");
  doc.presentation.grid = 10;
  doc.nets.push({ id: "foreign", terminals: [] });
  doc.junctions.push(
    ...[-120, 120].map((y) => ({
      id: "dot" + y,
      netId: "foreign",
      position: { x: 0, y },
    })),
  );
  doc.routes.push(
    createRoutePath({
      id: "barrier",
      netId: "foreign",
      start: { kind: "junction", junctionId: "dot-120" },
      end: { kind: "junction", junctionId: "dot120" },
      bends: [],
      modes: ["manual"],
    }),
  );
  const plain = clearance(doc).path(start, end),
    path = clearance(doc, "hanan-fallback").path(start, end);
  if (typeof plain === "string" || typeof path === "string")
    throw Error("expected two paths");
  expect(plain.points).toEqual([start, end]);
  expect(path.cost!).toBeLessThan(plain.cost!);
  expect(path.points!.some((p) => Math.abs(p.y) > 120)).toBe(true);
  expect(clearance(doc).conflict(path.points!, [])).toBeNull();
});
