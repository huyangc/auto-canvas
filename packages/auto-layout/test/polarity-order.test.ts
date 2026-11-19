import { describe, expect, it } from "vitest";
import { executeTransaction } from "@icm/edit-engine";
import {
  transformPoint,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import {
  builtInSymbols,
  InMemorySymbolResolver,
  SymbolDefinitionSchema,
} from "@icm/symbols";
import { defaultLayoutSearch, planAutoLayout } from "../src/auto-layout.js";
import {
  enforceOrder,
  keepsOrder,
  orderedPose,
  reverses,
} from "../src/polarity-order.js";
import type { Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

const pose = (
  rotation: Placement["rotation"],
  mirror: Placement["mirror"],
): Placement => ({ position: { x: 0, y: 0 }, rotation, mirror });

const part = (id: string, symbolId: string): Instance => ({
  id,
  symbolId,
  placement: null,
});

/** The op-amp's artwork: IN+ above IN- at y=10/-10, OUT leaving east. */
const opamp = part("X1", "opamp");
const resistor = part("R1", "resistor");

/**
 * A directed block whose only ordered poses leave the output north: from a
 * reversed pose exiting south, the rule has no ordered pose to offer.
 */
const northOpamp = SymbolDefinitionSchema.parse({
  schemaVersion: 1,
  id: "north-amp",
  name: "North amplifier",
  viewBox: { x: -40, y: -30, width: 80, height: 40 },
  pins: [
    {
      name: "IN+",
      role: "non-inverting-input",
      at: { x: -40, y: -10 },
      direction: "west",
      presentation: { visibility: "visible" },
    },
    {
      name: "IN-",
      role: "inverting-input",
      at: { x: -40, y: 10 },
      direction: "west",
      presentation: { visibility: "visible" },
    },
    {
      name: "OUT",
      role: "output",
      at: { x: 0, y: -30 },
      direction: "north",
      presentation: { visibility: "visible" },
    },
  ],
  primitives: [],
  variants: [{ id: "signal-pins", hiddenPinNames: [] }],
  defaultVariantId: "signal-pins",
});
const northResolver = new InMemorySymbolResolver([northOpamp]);
const north = part("X2", "north-amp");

const exit = (
  instance: Instance,
  r: InMemorySymbolResolver,
  p: Pick<Placement, "rotation" | "mirror">,
) => {
  const pin = r
    .resolve(instance.symbolId)!
    .definition.pins.find((q) => q.name === "OUT")!;
  const direction =
    pin.direction === "west"
      ? { x: -1, y: 0 }
      : pin.direction === "east"
        ? { x: 1, y: 0 }
        : pin.direction === "north"
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  return transformPoint(direction, { x: 0, y: 0 }, p);
};

describe("R169 input polarity", () => {
  it("finds a polarity pair on an op-amp and none on a resistor", () => {
    // A vertical reflection swaps + and -; identity and a horizontal mirror
    // keep the symbol's own order.
    expect(keepsOrder(opamp, resolver, pose(0, "none"))).toBe(true);
    expect(keepsOrder(opamp, resolver, pose(0, "horizontal"))).toBe(true);
    expect(keepsOrder(opamp, resolver, pose(0, "vertical"))).toBe(false);
    // A part whose symbol defines no +/IN+ and -/IN- pair never reverses.
    expect(keepsOrder(resistor, resolver, pose(180, "none"))).toBe(true);
    expect(
      reverses(resistor, resolver, pose(0, "none"), pose(0, "vertical")),
    ).toBe(false);
  });

  it("a vertical mirror reverses, a horizontal mirror does not", () => {
    const from = pose(0, "none");
    expect(reverses(opamp, resolver, from, pose(0, "vertical"))).toBe(true);
    expect(reverses(opamp, resolver, from, pose(0, "horizontal"))).toBe(false);
  });

  it("orderedPose keeps both the order and the exit direction", () => {
    // From a reversed pose whose output leaves east, a pose that restores the
    // input order and keeps the output east exists.
    const ordered = orderedPose(opamp, resolver, pose(0, "vertical"));
    expect(ordered).toBeDefined();
    expect(keepsOrder(opamp, resolver, ordered!)).toBe(true);
    expect(exit(opamp, resolver, ordered!)).toEqual({ x: 1, y: 0 });
    // A block reversed and exiting south has only north-exiting ordered
    // poses: it is left as it is instead of losing its output direction.
    expect(
      orderedPose(north, northResolver, pose(180, "none")),
    ).toBeUndefined();
    // From a pose that already keeps both, the answer is that same shape.
    expect(keepsOrder(north, northResolver, pose(0, "none"))).toBe(true);
  });

  it("enforceOrder rewrites a reversed map and leaves an ordered one alone", () => {
    const instances = [opamp, resistor];
    const reversed = new Map<string, Placement>([
      ["X1", pose(0, "vertical")],
      ["R1", pose(0, "vertical")],
    ]);
    expect(enforceOrder(instances, resolver, reversed)).toBe(1);
    expect(keepsOrder(opamp, resolver, reversed.get("X1")!)).toBe(true);
    // A resistor's pose is not the planner's to change.
    expect(reversed.get("R1")).toEqual(pose(0, "vertical"));
    const ordered = new Map<string, Placement>([["X1", pose(0, "none")]]);
    expect(enforceOrder(instances, resolver, ordered)).toBe(0);
    expect(ordered.get("X1")).toEqual(pose(0, "none"));
  });

  it("a fixed instance keeps its pose", () => {
    // The caller's filter is what protects a user's device; this pins the
    // contract that filtering it out of `instances` leaves its map entry alone.
    const placements = new Map<string, Placement>([
      ["X1", pose(0, "vertical")],
    ]);
    expect(enforceOrder([], resolver, placements)).toBe(0);
    expect(keepsOrder(opamp, resolver, placements.get("X1")!)).toBe(false);
  });

  // Runs the default search: allow for a slow CI runner.
  it("a reversing draft ends in the ordered pose", () => {
    const d = lowPass();
    const result = planAutoLayout(d, resolver, {
      search: { seed: 1, evaluations: defaultLayoutSearch(d, {}).evaluations },
    });
    const t = executeTransaction(
      d,
      {
        transactionId: "t",
        documentId: d.id,
        expectedRevision: d.revision,
        actor: { kind: "agent", id: "test" },
        edits: result.edits,
      },
      { symbolResolver: resolver },
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const x1 = t.document.instances.find((i) => i.id === "X1")!;
    expect(keepsOrder(x1, resolver, x1.placement!)).toBe(true);
  }, 60_000);
});

/** A second-order low-pass section: the op-amp's output feeds back through C2. */
function lowPass(): SchematicDocument {
  const d = circuit(
    {
      R1: "resistor",
      R2: "resistor",
      R3: "resistor",
      C1: "capacitor",
      C2: "capacitor",
      X1: "opamp",
      G1: "ground",
      G2: "ground",
      in: "port",
    },
    {
      vin: ["R1.2", "in.P"],
      n1: ["C1.1", "R1.1", "R2.2", "R3.2"],
      n5: ["C2.2", "R3.1", "X1.IN-"],
      n8: ["C2.1", "R2.1", "X1.OUT"],
      ref: ["G2.0", "X1.IN+"],
      gnd: ["C1.2", "G1.0"],
    },
  );
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: d.instances
      .filter((i) => i.symbolId === "port")
      .map((i) => ({
        id: `terminal-${i.id}`,
        name: i.id,
        netId: d.nets.find((n) =>
          n.terminals.some((t) => t.instanceId === i.id),
        )!.id,
        direction: "input" as const,
        interfaceInstanceIds: [i.id],
      })),
  };
  return d;
}
