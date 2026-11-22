import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { enclosingBox, placement, withPlacements } from "../src/geometry.js";
import { reflectionWorsensDirection } from "../src/netlist-reflection-veto.js";
import type { Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
type Facing = "east" | "west";

/** Whether turning two inverters from `before` to `after` is vetoed. */
function turns(
  before: readonly [Facing, Facing],
  after: readonly [Facing, Facing],
  cycle = false,
) {
  const d = circuit(
    { A: "inverter", B: "inverter" },
    cycle ? { ab: ["A.Y", "B.A"], ba: ["B.Y", "A.A"] } : {},
  );
  const draw = ([a, b]: readonly [Facing, Facing]) =>
    withPlacements(
      d,
      new Map([
        ["A", placement(-100, 0, a === "west" ? "horizontal" : "none")],
        ["B", placement(100, 0, b === "west" ? "horizontal" : "none")],
      ]),
    );
  return reflectionWorsensDirection(draw(before), draw(after), resolver);
}

it("vetoes a free block newly facing left, whatever another block gains", () => {
  expect(turns(["east", "west"], ["west", "west"])).toBe(true);
  expect(turns(["east", "west"], ["west", "east"])).toBe(true);
});

it("accepts a block that already faced left or turns right", () => {
  expect(turns(["west", "west"], ["west", "east"])).toBe(false);
});

it("accepts a turned member of a block cycle", () => {
  expect(turns(["east", "east"], ["west", "west"], true)).toBe(false);
});

const directions = { input: "input", output: "output" } as const;
type Kind = keyof typeof directions | "unclassified" | "rail";

/** Whether moving ports between x offsets from the devices' centre, given in
 * grid steps, is vetoed. The centre lies off the grid. */
function moves(...ports: (readonly [Kind, number, number])[]) {
  const d = circuit(
    {
      R1: "resistor",
      R2: "resistor",
      ...Object.fromEntries(ports.map((_, k) => [`p${k}`, "port"])),
      ...(ports.some(([kind]) => kind === "rail")
        ? { supply: "vdd-port" }
        : {}),
    },
    Object.fromEntries(
      ports.map(([kind], k) => [
        `n${k}`,
        [`p${k}.P`, ...(kind === "rail" ? ["supply.P"] : [])],
      ]),
    ),
  );
  d.netlist = {
    name: "dut",
    formalParameters: [],
    terminals: ports.flatMap(([kind], k) =>
      kind === "input" || kind === "output"
        ? [
            {
              id: `t${k}`,
              name: `t${k}`,
              netId: `n${k}`,
              direction: directions[kind],
              interfaceInstanceIds: [`p${k}`],
            },
          ]
        : [],
    ),
  };
  const grid = d.presentation.grid;
  const devices = new Map<string, Placement>([
    ["R1", placement(-20 * grid, 0)],
    ["R2", placement(21 * grid, 0)],
  ]);
  const body = withPlacements(d, devices);
  const box = enclosingBox(
    { ...body, instances: body.instances.filter((i) => devices.has(i.id)) },
    resolver,
  );
  const cx = box.x + box.width / 2;
  const draw = (at: 1 | 2) =>
    withPlacements(
      d,
      new Map([
        ...devices,
        ["supply", placement(cx, -100)] as const,
        ...ports.map(
          (port, k) =>
            [`p${k}`, placement(cx + port[at] * grid, 100 + 40 * k)] as const,
        ),
      ]),
    );
  return reflectionWorsensDirection(draw(1), draw(2), resolver);
}

it.each([
  ["unclassified", -5, 5],
  ["unclassified", 0, 5],
  ["input", -5, 5],
  ["output", 5, -5],
  ["input", 0, 1],
  ["output", 0, -1],
] as const)("vetoes an %s port moving from %s to %s steps", (...port) => {
  expect(moves(port)).toBe(true);
});

it("vetoes one worse port whatever another port gains", () => {
  expect(moves(["input", 5, -5], ["input", -5, 5])).toBe(true);
});

it.each([
  ["input", 5, 8],
  ["unclassified", 1, 5],
  ["output", -5, -8],
  ["input", 5, -5],
  ["rail", -5, 5],
  ["input", -5, 0.9],
  ["output", 5, -0.9],
] as const)("accepts a %s port moving from %s to %s steps", (...port) => {
  expect(moves(port)).toBe(false);
});
