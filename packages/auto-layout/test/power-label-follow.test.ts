import { resolveEndpointPoint } from "@icm/derived";
import type { Annotation, RouteBranch, SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
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
) => {
  document.instances.find((i) => i.id === id)!.placement = {
    position: { x, y },
    rotation: 0,
    mirror: "none",
  };
};
/** A straight wire between two pins on one row. */
const wire = (
  document: SchematicDocument,
  id: string,
  netId: string,
  from: [string, string],
  to: [string, string],
): RouteBranch => {
  const point = (instanceId: string, pinName: string) =>
    resolveEndpointPoint(document, resolver, {
      kind: "terminal",
      instanceId,
      pinName,
    })!;
  expect(point(...from).y).toBe(point(...to).y);
  return {
    id,
    netId,
    start: { kind: "terminal", instanceId: from[0], pinName: from[1] },
    legs: [
      {
        id: `${id}-leg`,
        mode: "manual",
        to: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: to[0], pinName: to[1] },
        },
      },
    ],
  };
};

/**
 * Rail `vdd` from r1.1 to r2.1 along `railY` (x 100 to 300); with
 * `foreignY`, Net `sig` runs from s1.1 to s2.1 along it (x 80 to 320).
 */
function rail(railY: number, foreignY?: number): SchematicDocument {
  const document = circuit(
    { r1: "resistor", r2: "resistor", s1: "resistor", s2: "resistor" },
    { vdd: ["r1.1", "r2.1"], sig: ["s1.1", "s2.1"] },
  );
  place(document, "r1", 100, railY + 20);
  place(document, "r2", 300, railY + 20);
  const sigY = foreignY ?? railY + 400;
  place(document, "s1", 80, sigY + 20);
  place(document, "s2", 320, sigY + 20);
  document.routes.push(
    wire(document, "w-vdd", "vdd", ["r1", "1"], ["r2", "1"]),
    wire(document, "w-sig", "sig", ["s1", "1"], ["s2", "1"]),
  );
  return document;
}

/**
 * A power label drawn as text naming `netId` (no power symbol): its name
 * claim is a power marker the label owns, in `domain`.
 */
function powerLabel(
  document: SchematicDocument,
  anchor: Annotation["anchor"],
  domain: "vdd" | "ground" = "vdd",
  kind: "power-label" | "net-label" = "power-label",
) {
  const label: Annotation = {
    id: "supply",
    kind,
    netId: "vdd",
    binding: { kind: "net-name", netId: "vdd" },
    anchor,
    alignment: "start",
    rotation: 0,
    locked: false,
  };
  document.annotations.push(label);
  document.connectivityEvidence.push({
    id: "claim-supply",
    kind: "name-claim",
    name: domain === "vdd" ? "VDD" : "GND",
    netId: "vdd",
    scope: "local",
    ...(kind === "power-label"
      ? {
          owner: { kind: "power-marker" as const, objectId: label.id },
          powerDomain: domain,
        }
      : { owner: { kind: "net-label" as const, annotationId: label.id } }),
  });
  return label;
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
const inkOf = (document: SchematicDocument, id: string) => {
  const { context } = createLabelOwnership(document, resolver);
  return context.measure(document.annotations.find((a) => a.id === id)!)
    .inkBounds;
};

it("reads a power label a grid clear of its rail's end as the rail's", () => {
  // Drawn as a rail's name usually is: a grid past the rail's end, on its row.
  const at = { kind: "free" as const, position: { x: 310, y: 105 } };
  const source = rail(100);
  powerLabel(source, at);
  expect(labelOwnership(source, resolver)).toEqual([]);
  // A Net label stands on its wire: there it reads as standing apart.
  const netLabel = rail(100);
  powerLabel(netLabel, at, "vdd", "net-label");
  expect(labelOwnership(netLabel, resolver)).toMatchObject([
    { annotationId: "supply", reason: "own-far" },
  ]);
});

it("does not read a power marker's caption as text naming its rail", () => {
  const document = rail(100);
  document.instances.push({ id: "m", symbolId: "vdd-port", placement: null });
  document.nets
    .find((n) => n.id === "vdd")!
    .terminals.push({ instanceId: "m", pinName: "P" });
  place(document, "m", 600, 400);
  // Far from every wire, on the marker that names the rail.
  powerLabel(document, {
    kind: "object",
    objectId: "m",
    localOffset: { x: 0, y: -10 },
    fallbackPosition: { x: 600, y: 390 },
  });
  expect(labelOwnership(document, resolver)).toEqual([]);
});

it("moves a power label off a foreign wire, to its rail's other side", () => {
  const source = rail(100);
  // Above the rail, where R15 seats a power label.
  powerLabel(source, {
    kind: "route",
    routeId: "w-vdd",
    legId: "w-vdd-leg",
    t: 0.5,
    normalOffset: -10,
    direction: "forward",
    orientation: "horizontal",
    fallbackPosition: { x: 200, y: 90 },
  });
  expect(labelOwnership(source, resolver)).toEqual([]);
  // The layout runs another Net's wire one grid above the rail, through the
  // text.
  const layout = layoutEdits(source, rail(100, 90));
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok && labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "supply", reason: "foreign-closer", foreignNetId: "sig" },
  ]);
  const { added, final } = follow(source, layout);
  expect(added).toHaveLength(1);
  expect(final.annotations[0]!.anchor).toMatchObject({
    kind: "route",
    routeId: "w-vdd",
  });
  expect(labelOwnership(final, resolver)).toEqual([]);
  // Below the rail: never between the rail and the nearer foreign wire.
  expect(inkOf(final, "supply").y).toBeGreaterThan(100);
});

it("names a supply rail from above and a ground rail from below", () => {
  for (const [domain, above] of [
    ["vdd", true],
    ["ground", false],
  ] as const) {
    const source = rail(100);
    // A grid past the rail's end.
    powerLabel(source, { kind: "free", position: { x: 310, y: 105 } }, domain);
    // The layout moves the rail 200 units down; the text stays behind.
    const layout = layoutEdits(source, rail(300));
    const stayed = preview(source, resolver, layout.edits);
    expect(
      stayed.ok && labelOwnership(stayed.document, resolver),
    ).toMatchObject([{ annotationId: "supply", reason: "own-far" }]);
    const { added, final } = follow(source, layout);
    expect(added).toHaveLength(1);
    expect(labelOwnership(final, resolver)).toEqual([]);
    const ink = inkOf(final, "supply");
    if (above) expect(ink.y + ink.height).toBeLessThan(300);
    else expect(ink.y).toBeGreaterThan(300);
  }
});

it("writes a seat against the leg the plan draws, not the rejoined one", () => {
  // Rail `vdd` joins c.1, r.1, x.1 and z.2.
  const rails = () =>
    circuit(
      { c: "resistor", r: "resistor", x: "resistor", z: "resistor" },
      { vdd: ["c.1", "r.1", "x.1", "z.2"] },
    );
  const source = rails();
  place(source, "c", 300, 120);
  place(source, "r", 100, 120);
  place(source, "x", 200, 120);
  place(source, "z", 200, 40);
  source.routes.push(
    wire(source, "s1", "vdd", ["c", "1"], ["x", "1"]),
    wire(source, "s2", "vdd", ["x", "1"], ["r", "1"]),
  );
  // Before the rail's left end, r.1.
  powerLabel(source, { kind: "free", position: { x: 60, y: 105 } });
  expect(labelOwnership(source, resolver)).toEqual([]);
  const target = rails();
  place(target, "c", 510, 80);
  place(target, "r", 300, 80);
  place(target, "x", 400, 70);
  place(target, "z", 400, -10);
  // The plan draws `w` from c.1 up to y 50 and across to r.1, over x.1, and
  // `w2` from x.1 up to z.2.
  const w: RouteBranch = {
    id: "w",
    netId: "vdd",
    start: { kind: "terminal", instanceId: "c", pinName: "1" },
    legs: [
      {
        id: "w-up",
        mode: "manual",
        to: { kind: "bend", bendId: "w-b1", position: { x: 510, y: 50 } },
      },
      {
        id: "w-across",
        mode: "manual",
        to: { kind: "bend", bendId: "w-b2", position: { x: 300, y: 50 } },
      },
      {
        id: "w-down",
        mode: "manual",
        to: {
          kind: "endpoint",
          endpoint: { kind: "terminal", instanceId: "r", pinName: "1" },
        },
      },
    ],
  };
  const layout: AutoLayoutResult = {
    edits: [
      { kind: "remove_route_geometry", routeId: "s1" },
      { kind: "remove_route_geometry", routeId: "s2" },
      ...target.instances.map((i) => ({
        kind: "move_instance" as const,
        instanceId: i.id,
        position: i.placement!.position,
      })),
      { kind: "set_route_path", route: w },
      {
        kind: "set_route_path",
        route: {
          id: "w2",
          netId: "vdd",
          start: { kind: "terminal", instanceId: "x", pinName: "1" },
          legs: [
            {
              id: "w2-leg",
              mode: "manual",
              to: {
                kind: "endpoint",
                endpoint: { kind: "terminal", instanceId: "z", pinName: "2" },
              },
            },
          ],
        },
      },
    ],
    groups: [],
    diagnostics: [],
  };
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok).toBe(true);
  if (!stayed.ok) return;
  // The transaction's end splits `w` at x.1 and redraws each part from its
  // lower point key: the finished `w` runs r.1 → (300, 50) → x.1, so "w-up"
  // is now r.1's riser and "w-down", drawn as r.1's riser, the leg along
  // y 50; x.1 → (510, 50) → c.1 is a new Route.
  const rejoined = stayed.document.routes.find((r) => r.id === "w")!;
  expect(rejoined.start).toMatchObject({ instanceId: "r", pinName: "1" });
  expect(rejoined.legs.map((l) => l.id)).toEqual(["w-up", "w-down"]);
  expect(labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "supply", reason: "own-far" },
  ]);
  const { added, final } = follow(source, layout);
  expect(added).toHaveLength(1);
  // Above the finished "w-down", as judged on the finished drawing.
  expect(labelOwnership(final, resolver)).toEqual([]);
  const ink = inkOf(final, "supply");
  expect(ink.y + ink.height).toBeLessThan(50);
  expect(ink.x + ink.width).toBeLessThan(400);
  // Written against the drawn leg along y 50, "w-across".
  expect(added[0]).toMatchObject({
    annotation: { anchor: { routeId: "w", legId: "w-across" } },
  });
});

/**
 * rail(100) with its name a grid past the rail's end; the layout moves the
 * rail to y 300 and redraws it as `nw`, r1.1 to r2.1 with a collinear bend at
 * x `bend`. The engine stores `nw` normalised: one leg, with one leg id.
 */
function collinearBend(bend: number) {
  const source = rail(100);
  powerLabel(source, { kind: "free", position: { x: 310, y: 105 } });
  const target = rail(300);
  const layout: AutoLayoutResult = {
    edits: [
      { kind: "remove_route_geometry", routeId: "w-vdd" },
      { kind: "remove_route_geometry", routeId: "w-sig" },
      ...target.instances.map((i) => ({
        kind: "move_instance" as const,
        instanceId: i.id,
        position: i.placement!.position,
      })),
      {
        kind: "set_route_path",
        route: {
          id: "nw",
          netId: "vdd",
          start: { kind: "terminal", instanceId: "r1", pinName: "1" },
          legs: [
            {
              id: "nw-a",
              mode: "manual",
              to: {
                kind: "bend",
                bendId: "nw-b1",
                position: { x: bend, y: 300 },
              },
            },
            {
              id: "nw-b",
              mode: "manual",
              to: {
                kind: "endpoint",
                endpoint: { kind: "terminal", instanceId: "r2", pinName: "1" },
              },
            },
          ],
        },
      },
      { kind: "set_route_path", route: target.routes[1]! },
    ],
    groups: [],
    diagnostics: [],
  };
  const stayed = preview(source, resolver, layout.edits);
  expect(stayed.ok && labelOwnership(stayed.document, resolver)).toMatchObject([
    { annotationId: "supply", reason: "own-far" },
  ]);
  return { source, layout };
}

for (const [bend, how] of [
  [290, "reads its t on another segment"],
  [120, "names a leg the stored Route lacks"],
] as const)
  it(`leaves the plan unchanged when a written seat ${how}`, () => {
    const { source, layout } = collinearBend(bend);
    const edits = structuredClone(layout.edits);
    // No label may be drawn elsewhere than it was judged: the step returns
    // the plan as it was.
    expect(follow(source, layout).added).toEqual([]);
    expect(layout.edits).toEqual(edits);
  });

it("reads a power label anchored to a part that is not a power marker", () => {
  // Rail along y 100, another Net's wire one grid above it.
  const document = rail(100, 90);
  // Anchored to resistor r1, its text over the other Net's wire.
  powerLabel(document, {
    kind: "object",
    objectId: "r1",
    localOffset: { x: 50, y: -30 },
    fallbackPosition: { x: 150, y: 90 },
  });
  expect(labelOwnership(document, resolver)).toMatchObject([
    { annotationId: "supply", reason: "foreign-closer", foreignNetId: "sig" },
  ]);
  // A claim r1 owns on another Net does not make the text its caption.
  document.connectivityEvidence.push({
    id: "claim-r1-sig",
    kind: "name-claim",
    name: "VSIG",
    netId: "sig",
    scope: "local",
    owner: { kind: "power-marker", objectId: "r1" },
    powerDomain: "vdd",
  });
  expect(labelOwnership(document, resolver)).toMatchObject([
    { annotationId: "supply", reason: "foreign-closer", foreignNetId: "sig" },
  ]);
  document.connectivityEvidence.pop();
  // Once r1 owns the rail's power-marker claim, the text is its caption.
  document.connectivityEvidence.push({
    id: "claim-r1",
    kind: "name-claim",
    name: "VDD",
    netId: "vdd",
    scope: "local",
    owner: { kind: "power-marker", objectId: "r1" },
    powerDomain: "vdd",
  });
  expect(labelOwnership(document, resolver)).toEqual([]);
});
