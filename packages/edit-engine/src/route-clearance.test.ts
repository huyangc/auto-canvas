import { describe, expect, it } from "vitest";
import {
  deriveNetConnectivityContext,
  resolveEndpointConnection,
} from "@icm/derived";
import {
  createEmptyDocument,
  freezeSnapshot,
  createRoutePath,
  type Point,
  type RouteEndpoint,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { compileWireDraft } from "./wire-draft.js";
import {
  orthogonalClearancePoints,
  createRouteClearance,
} from "./route-clearance.js";

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
      const [fast] = clearances(
        freezeSnapshot(structuredClone(document)),
        crossingCost,
      );
      const [, exhaustive] = clearances(document, crossingCost);
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

it("permits only an endpoint branch off a facing scalar Base Net contact", () => {
  const d = createEmptyDocument("direct", "Direct");
  d.instances = [0, 40].map((y, j) => ({
    id: String(j),
    symbolId: "resistor",
    placement: { position: { x: 0, y }, rotation: 0, mirror: "none" },
  }));
  const a = { kind: "terminal" as const, instanceId: "0", pinName: "2" },
    b = { instanceId: "1", pinName: "1" };
  d.nets = [{ id: "s", terminals: [a, b] }];
  const check = () =>
    createRouteClearance(
      d,
      resolver,
      deriveNetConnectivityContext(d, resolver),
      { netScope: "base", logicalIds: new Set(["s"]), endpointKeys: new Set() },
    );
  const start = { x: 0, y: 20 },
    side = { x: 40, y: 20 };
  expect(check().conflict([start, side], [a, undefined])).toBeFalsy();
  expect(check().conflict([side, start], [undefined, a])).toBeFalsy();
  expect(
    check().conflict([start, { x: 0, y: 40 }], [a, undefined]),
  ).toBeTruthy();
  expect(check().conflict([{ x: -40, y: 20 }, side], [])).toBeTruthy();
  d.nets = [
    { id: "s", terminals: [a] },
    { id: "foreign", terminals: [b] },
  ];
  d.connectivityEvidence = d.nets.map((net) => ({
    id: "claim-" + net.id,
    kind: "name-claim",
    netId: net.id,
    name: "sig",
    scope: "global",
    owner: { kind: "global-declaration", sourceNetId: net.id },
  }));
  expect(check().conflict([start, side], [a, undefined])).toBeTruthy();
});

it("matches trimmed orthogonal wire drafts including reversals and pin escapes", () => {
  const lattice = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: -10, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
  ];
  const geometry = (gridLanding: Point, escape: boolean) => ({
    gridLanding,
    contactPoint: escape
      ? { x: gridLanding.x + 0.25, y: gridLanding.y }
      : gridLanding,
    escapePath: [],
    outward: null,
  });
  for (const end of lattice)
    for (const first of lattice)
      for (const second of lattice)
        for (const cornerOrder of [
          "horizontal-first",
          "vertical-first",
        ] as const)
          for (const startEscape of [false, true])
            for (const endEscape of [false, true]) {
              const a = geometry(lattice[0]!, startEscape),
                b = geometry(end, endEscape);
              const waypoints = [first, second];
              const draft = compileWireDraft(
                { connection: a },
                { connection: b },
                waypoints.map((point) => ({
                  point,
                  cornerOrder,
                  routingMode: "orthogonal",
                })),
                "orthogonal",
                cornerOrder,
              );
              const start = draft.segmentModes[0] === "escape" ? 1 : 0;
              const trimEnd =
                draft.segmentModes.at(-1) === "escape" &&
                draft.points.length - 2 >= start;
              expect(
                orthogonalClearancePoints(a, b, waypoints, cornerOrder),
              ).toStrictEqual(
                draft.points.slice(start, trimEnd ? -1 : undefined),
              );
            }
});

it("preserves the first tied path and the cheapest blocked path diagnostic", () => {
  const document = createEmptyDocument("ties", "Ties");
  document.presentation.grid = 10;
  freezeSnapshot(document);
  const context = deriveNetConnectivityContext(document, resolver);
  const start = { x: 0, y: 0 },
    end = { x: 100, y: 100 };
  for (const exhaustive of [false, true]) {
    const own = {
      logicalIds: new Set<string>(),
      endpointKeys: new Set<string>(),
      exhaustive,
    };
    expect(
      createRouteClearance(document, resolver, context, own).path(start, end),
    ).toMatchObject({
      cornerOrder: "horizontal-first",
      waypoints: [],
      points: [start, { x: 100, y: 0 }, end],
    });
    const why = createRouteClearance(document, resolver, context, {
      ...own,
      blockedPoints: [start],
    }).path(start, end);
    expect(why).toBe(
      "no clear path from (0, 0) to (100, 100): the direct one touches another Net's wire end at (0, 0) between (0, 0) and (100, 0). Move the parts apart, give a trunk, or name the Net at each end with a Net Label on a short stub",
    );
  }
});

it("refreshes pin geometry after editing a placement inside a shallow-frozen document", () => {
  const document = Object.freeze(fixture());
  const start = { x: 100, y: 0 },
    end = { x: 101, y: 0 };
  expect(clearances(document)[0].conflict([start, end], [])).toContain("B");
  document.instances[1]!.placement!.position.x += 300;
  expect(clearances(document)[0].conflict([start, end], [])).toBeNull();
});

it("reports the cheaper detour when both tiers are blocked", () => {
  const document = createEmptyDocument("detour-reason", "Detour diagnostic");
  document.presentation.grid = 10;
  document.nets.push({ id: "foreign", terminals: [] });
  document.junctions.push(
    { id: "a", netId: "foreign", position: { x: 50, y: -5 } },
    { id: "b", netId: "foreign", position: { x: 50, y: 25 } },
  );
  document.routes.push(
    createRoutePath({
      id: "wire",
      netId: "foreign",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    }),
  );
  freezeSnapshot(document);
  const start = { x: 0, y: 0 },
    end = { x: 100, y: 20 };
  const context = deriveNetConnectivityContext(document, resolver);
  for (const exhaustive of [true, false]) {
    const clearance = createRouteClearance(document, resolver, context, {
      exhaustive,
      crossingCost: 200,
      logicalIds: new Set(),
      endpointKeys: new Set(),
      blockedPoints: [start],
    });
    // The column along the foreign wire has no proper crossing penalty.
    // It sorts before the plain Ls, then fails on that wire at its turn.
    expect(clearance.path(start, end)).toBe(
      "no clear path from (0, 0) to (100, 20): the direct one touches Route wire of a different Net (foreign) at (50, 0). Move the parts apart, give a trunk, or name the Net at each end with a Net Label on a short stub",
    );
  }
});

it("keeps non-finite custom symbol bounds out of the sorted spatial index", () => {
  const resistor = builtInSymbols.find((symbol) => symbol.id === "resistor")!;
  const malformed = {
    ...resistor,
    id: "malformed-path",
    primitives: [{ kind: "path" as const, data: "M 0 0 L 10" }],
  };
  const customResolver = new InMemorySymbolResolver([
    ...builtInSymbols,
    malformed,
  ]);
  const document = createEmptyDocument("nan-bounds", "NaN bounds");
  document.instances = [
    {
      id: "far",
      symbolId: "resistor",
      placement: { position: { x: 1000, y: 0 }, rotation: 0, mirror: "none" },
    },
    {
      id: "bad",
      symbolId: "malformed-path",
      placement: { position: { x: 500, y: 0 }, rotation: 90, mirror: "none" },
    },
    {
      id: "near",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    },
  ];
  const context = deriveNetConnectivityContext(document, customResolver);
  const path = [
    { x: -100, y: 0 },
    { x: 100, y: 0 },
  ];
  const indexed = createRouteClearance(document, customResolver, context, {
    logicalIds: new Set(),
    endpointKeys: new Set(),
    exhaustive: false,
  }).conflict(path, []);
  const exhaustive = createRouteClearance(document, customResolver, context, {
    logicalIds: new Set(),
    endpointKeys: new Set(),
    exhaustive: true,
  }).conflict(path, []);
  expect(indexed).toBe(exhaustive);
  expect(indexed).toContain("passes through near");
});

it("isolates cached snapshot endpoint connections from caller endpoint mutations", () => {
  const document = createEmptyDocument("endpoint-copy", "Endpoint copy");
  document.presentation.grid = 10;
  document.instances.push({
    id: "r1",
    symbolId: "resistor",
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
  });
  freezeSnapshot(document);
  const context = deriveNetConnectivityContext(document, resolver);
  const mutableEndpoint = {
    kind: "terminal" as const,
    instanceId: "r1",
    pinName: "1",
    memberId: "m0",
  };
  const pinKey = "terminal:r1:1";
  const clearance1 = createRouteClearance(document, resolver, context, {
    logicalIds: new Set(),
    endpointKeys: new Set([pinKey]),
  });
  const start = resolveEndpointConnection(
    document,
    resolver,
    mutableEndpoint,
    context,
  )!.gridLanding;
  const outwardPath = [start, { x: start.x, y: start.y - 40 }];
  expect(clearance1.conflict(outwardPath, [mutableEndpoint])).toBeNull();

  // Mutating the caller's endpoint object must not poison the shared snapshot cache.
  mutableEndpoint.instanceId = "other";

  const clearance2 = createRouteClearance(document, resolver, context, {
    logicalIds: new Set(),
    endpointKeys: new Set([pinKey]),
  });
  expect(
    clearance2.conflict(outwardPath, [
      { kind: "terminal", instanceId: "r1", pinName: "1", memberId: "m0" },
    ]),
  ).toBeNull();
});
