import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { createPlacementEstimator } from "../src/estimate.js";
import { placement } from "../src/geometry.js";
import { assignColumns, searchColumns } from "../src/layered.js";
import { classifyNets } from "../src/net-roles.js";
import type { RecognizedGroup } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const fixture = () => {
  const document = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos" },
    { one: ["a.D", "d.D"], two: ["b.S", "c.D"] },
  );
  const order = [
    ["a", "b"],
    ["c", "d"],
  ].map((ids, row) =>
    ids.map((id) => ({ id, members: [id], row, distance: 0 })),
  );
  const rows = {
    nodes: order.flat(),
    placements: new Map(
      order.flatMap((row) =>
        row.map((n) => [n.id, placement(0, n.row * 240)] as const),
      ),
    ),
  };
  const roles = classifyNets(document, resolver);
  return { document, order, rows, roles };
};
it("removes a known crossing in a two-row placement without mutating its inputs", () => {
  const { document, order, rows, roles } = fixture();
  const before = structuredClone({ document, order, rows });
  const initial = assignColumns(
    document,
    document.instances,
    resolver,
    roles,
    [],
    order,
    rows,
  );
  const estimate = createPlacementEstimator(
    document.instances,
    resolver,
    roles,
  );
  expect(estimate(initial).crossings).toBeGreaterThan(0);
  const search = () =>
    searchColumns(
      document,
      document.instances,
      resolver,
      roles,
      [],
      order,
      rows,
    );
  const result = search();
  expect(estimate(result).crossings).toBe(0);
  expect(search()).toEqual(result);
  expect({ document, order, rows }).toEqual(before);
  for (const p of result.values()) {
    expect(p.position.x % document.presentation.grid).toBe(0);
    expect(p.position.y % document.presentation.grid).toBe(0);
  }
});
it("keeps fixed placements and group templates whole while searching", () => {
  const { document, order, rows, roles } = fixture();
  const group: RecognizedGroup = {
    id: "pair",
    kind: "current-mirror",
    members: ["c", "d"],
  };
  order[1] = [
    { id: group.id, members: [...group.members], row: 1, distance: 0 },
  ];
  rows.nodes = order.flat();
  const initial = assignColumns(
    document,
    document.instances,
    resolver,
    roles,
    [group],
    order,
    rows,
  );
  const result = searchColumns(
    document,
    document.instances,
    resolver,
    roles,
    [group],
    order,
    rows,
    new Set(["a"]),
  );
  expect(result.get("a")).toEqual(initial.get("a"));
  expect(result.get("c")!.position).not.toEqual(initial.get("c")!.position);
  const delta = (map: typeof result) => ({
    x: map.get("c")!.position.x - map.get("d")!.position.x,
    y: map.get("c")!.position.y - map.get("d")!.position.y,
  });
  expect(delta(result)).toEqual(delta(initial));
  for (const id of group.members) {
    expect(result.get(id)!.mirror).toBe(initial.get(id)!.mirror);
    expect(result.get(id)!.rotation).toBe(initial.get(id)!.rotation);
  }
});
it("reuses search results without leaking a caller's stage translation into later replays", () => {
  const { document, order, rows, roles } = fixture();
  const cache = new Map();
  const search = () =>
    searchColumns(
      document,
      document.instances,
      resolver,
      roles,
      [],
      order,
      rows,
      new Set(),
      cache,
    );
  const first = search();
  const original = structuredClone(first);
  for (const p of first.values()) p.position.x += 400;
  expect(search()).toEqual(original);
  const changedRows = structuredClone(rows);
  for (const p of changedRows.placements.values()) p.position.y += 120;
  const shifted = searchColumns(
    document,
    document.instances,
    resolver,
    roles,
    [],
    order,
    changedRows,
    new Set(),
    cache,
  );
  for (const [id, p] of shifted)
    expect(p.position.y).toBe(original.get(id)!.position.y + 120);
  expect(search()).toEqual(original);
});
