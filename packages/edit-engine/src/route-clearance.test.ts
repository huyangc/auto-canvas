import { describe, expect, it } from "vitest";
import {
  deriveNetConnectivityContext,
  resolveEndpointConnection,
} from "@icm/derived";
import {
  createEmptyDocument,
  createRoutePath,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { createRouteClearance } from "./route-clearance.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture() {
  const document = createEmptyDocument("clearance", "Clearance sweep");
  document.presentation.grid = 10;
  document.instances = [
    {
      id: "A",
      symbolId: "opamp",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    },
    {
      id: "B",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 0 }, rotation: 90, mirror: "none" },
    },
    {
      id: "C",
      symbolId: "resistor",
      placement: { position: { x: 200, y: 0 }, rotation: 180, mirror: "none" },
    },
    {
      id: "D",
      symbolId: "opamp",
      placement: {
        position: { x: 0, y: 120 },
        rotation: 270,
        mirror: "horizontal",
      },
    },
    {
      id: "E",
      symbolId: "voltage-source",
      placement: {
        position: { x: 103, y: 123 },
        rotation: 0,
        mirror: "vertical",
      },
    },
    {
      id: "F",
      symbolId: "ground",
      placement: { position: { x: 200, y: 120 }, rotation: 0, mirror: "none" },
    },
  ];
  for (const [index, points] of [
    [
      { x: -60, y: -60 },
      { x: 260, y: -60 },
      { x: 260, y: 60 },
    ],
    [
      { x: -60, y: 180 },
      { x: 260, y: 180 },
      { x: 260, y: 100 },
    ],
  ].entries()) {
    const netId = `foreign-${index}`;
    document.nets.push({ id: netId, terminals: [] });
    document.junctions.push(
      { id: `${netId}-start`, netId, position: points[0]! },
      { id: `${netId}-end`, netId, position: points[2]! },
    );
    document.routes.push(
      createRoutePath({
        id: netId,
        netId,
        start: { kind: "junction", junctionId: `${netId}-start` },
        end: { kind: "junction", junctionId: `${netId}-end` },
        bends: [points[1]!],
        modes: ["manual", "manual"],
      }),
    );
  }
  return document;
}
function clearances(document: SchematicDocument, crossingCost = 0) {
  const context = deriveNetConnectivityContext(document, resolver);
  const own = {
    logicalIds: new Set<string>(),
    endpointKeys: new Set<string>(),
    crossingCost,
  };
  return [
    createRouteClearance(document, resolver, context, own),
    createRouteClearance(document, resolver, context, {
      ...own,
      exhaustive: true,
    }),
  ] as const;
}
function terminals(document: SchematicDocument) {
  const context = deriveNetConnectivityContext(document, resolver);
  return document.instances.flatMap((instance) =>
    resolver.resolve(instance.symbolId)!.definition.pins.flatMap((pin) => {
      const endpoint: RouteEndpoint = {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      };
      const connection = resolveEndpointConnection(
        document,
        resolver,
        endpoint,
        context,
      );
      return connection ? [{ endpoint, point: connection.gridLanding }] : [];
    }),
  );
}

describe("clearance bounds preserve exhaustive results", () => {
  it("compares every lattice segment, two-bend paths, diagonals and own-pin exemptions", () => {
    const document = fixture();
    const [fast, exhaustive] = clearances(document);
    const pins = terminals(document);
    const messages = new Set<string>();
    const check = (
      points: Point[],
      ends: (RouteEndpoint | undefined)[] = [],
    ) => {
      const expected = exhaustive.conflict(points, ends);
      expect(
        fast.conflict(points, ends),
        JSON.stringify({ points, ends }),
      ).toBe(expected);
      if (expected) messages.add(expected);
    };
    const grid = document.presentation.grid;
    for (let y = -80; y <= 200; y += grid) {
      for (let x = -80; x <= 280; x += grid) {
        const from = { x, y };
        const starts = pins.filter(
          (pin) => pin.point.x === x && pin.point.y === y,
        );
        for (const axis of ["x", "y"] as const) {
          const limit = axis === "x" ? 280 : 200;
          for (let end = from[axis] + grid; end <= limit; end += grid) {
            const to = { ...from, [axis]: end };
            check([from, to]);
            check([to, from]);
            for (const pin of starts)
              check([from, to], [pin.endpoint, undefined]);
            for (const pin of pins.filter(
              (pin) => pin.point.x === to.x && pin.point.y === to.y,
            ))
              check([to, from], [pin.endpoint, undefined]);
          }
        }
      }
    }
    for (let index = 0; index < 320; index++) {
      const from = {
        x: -80 + (index % 37) * grid,
        y: -80 + (index % 29) * grid,
      };
      const to = {
        x: -80 + ((index * 7) % 37) * grid,
        y: -80 + ((index * 11) % 29) * grid,
      };
      const middle = -70 + ((index * 3) % 35) * grid;
      check([from, { x: middle, y: from.y }, { x: middle, y: to.y }, to]);
      if (from.x !== to.x && from.y !== to.y) check([from, to]);
    }
    // Also exercise off-grid pin landings directly in every direction.
    for (const pin of pins)
      for (const [dx, dy] of [
        [40, 0],
        [-40, 0],
        [0, 40],
        [0, -40],
      ])
        check(
          [pin.point, { x: pin.point.x + dx!, y: pin.point.y + dy! }],
          [pin.endpoint, undefined],
        );
    check([
      { x: 199, y: 131.046512 },
      { x: 201, y: 131.046512 },
    ]);
    check([
      { x: 210, y: 131.046512 },
      { x: 202.325581, y: 131.046512 },
    ]);
    for (const family of [
      /passes over pin/,
      /passes through/,
      /runs along/,
      /touches .* drawing/,
      /sits on|touches Route/,
    ])
      expect(
        [...messages].some((message) => family.test(message)),
        String(family),
      ).toBe(true);
  });

  it.each([0, 200])(
    "chooses identical paths with crossing cost %s",
    (crossingCost) => {
      const document = fixture();
      const [fast, exhaustive] = clearances(document, crossingCost);
      const pins = terminals(document);
      for (let index = 0; index < 36; index++) {
        const from = pins[index % pins.length]!.endpoint;
        const to =
          index % 2
            ? pins[(index + 5) % pins.length]!.endpoint
            : {
                x: -70 + (index % 9) * 40,
                y: -70 + Math.floor(index / 9) * 80,
              };
        expect(fast.path(from, to)).toEqual(exhaustive.path(from, to));
      }
    },
  );
});

it("preserves literal outline, stroke endpoint, route end and tolerance boundary results", () => {
  const document = createEmptyDocument("boundaries", "Boundaries");
  document.instances = [
    {
      id: "G",
      symbolId: "ground",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    },
  ];
  const [fast, exhaustive] = clearances(document);
  const cases: { points: Point[]; expected: string | null }[] = [
    {
      points: [
        { x: 6.395349, y: 1 },
        { x: 6.395349, y: 4 },
      ],
      expected: null,
    },
    {
      points: [
        { x: 10, y: 11.046512 },
        { x: 2.325581, y: 11.046512 },
      ],
      expected:
        "touches G's drawing between (10, 11.046512) and (2.325581, 11.046512)",
    },
    {
      points: [
        { x: -1, y: 11.046512 },
        { x: 1, y: 11.046512 },
      ],
      expected:
        "runs along G's drawing between (-1, 11.046512) and (1, 11.046512)",
    },
    // Below the bottom stroke: TOLERANCE / 2 and 2 * TOLERANCE.
    {
      points: [
        { x: -1, y: 11.047012 },
        { x: 1, y: 11.047012 },
      ],
      expected:
        "runs along G's drawing between (-1, 11.047012) and (1, 11.047012)",
    },
    {
      points: [
        { x: -1, y: 11.048512 },
        { x: 1, y: 11.048512 },
      ],
      expected: null,
    },
    // The cross/dot tolerance of a tiny segment reaches well beyond its box.
    {
      points: [
        { x: 100, y: -10 },
        { x: 100.000000000001, y: -10 },
      ],
      expected:
        "passes over pin G.0, which is on no Net, at (0, -10) between (100, -10) and (100.000000000001, -10)",
    },
  ];
  for (const { points, expected } of cases) {
    expect(exhaustive.conflict(points, [])).toBe(expected);
    expect(fast.conflict(points, [])).toBe(expected);
  }
  for (const clearance of clearances(fixture()))
    expect(
      clearance.conflict(
        [
          { x: -60, y: -60 },
          { x: -70, y: -70 },
        ],
        [],
      ),
    ).toBe(
      "touches Route foreign-0 of a different Net (foreign-0) at (-60, -60)",
    );
});

it("retains foreign Route scans when either side has a sub-unit segment", () => {
  const document = createEmptyDocument("short-route", "Short route");
  document.nets.push({ id: "foreign", terminals: [] });
  document.junctions.push(
    { id: "start", netId: "foreign", position: { x: 100, y: 0 } },
    { id: "end", netId: "foreign", position: { x: 100.000000000001, y: 0 } },
  );
  document.routes.push(
    createRoutePath({
      id: "short",
      netId: "foreign",
      start: { kind: "junction", junctionId: "start" },
      end: { kind: "junction", junctionId: "end" },
      bends: [],
      modes: ["manual"],
    }),
  );
  for (const clearance of clearances(document))
    expect(
      clearance.conflict(
        [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
        ],
        [],
      ),
    ).toBe("touches Route short of a different Net (foreign) at (0, 0)");
  document.junctions[1]!.position = { x: 100, y: 10 };
  for (const clearance of clearances(document))
    expect(
      clearance.conflict(
        [
          { x: 0, y: 0 },
          { x: 0.000000000001, y: 0 },
        ],
        [],
      ),
    ).toBe(
      "touches Route short of a different Net (foreign) at (100, 0) between (0, 0) and (1e-12, 0)",
    );
});
